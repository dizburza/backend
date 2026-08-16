CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"name" text,
	"decimals" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_chain_address_key" ON "tokens" USING btree ("chain_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_single_default_key" ON "tokens" USING btree ("chain_id") WHERE is_default and is_active;--> statement-breakpoint
/*
  Balances are a cache, refreshed from the chain the first time an address is
  read. Emptying the table is cheaper and safer than inventing a token_id for
  rows whose token this migration has no way to know.
*/
DELETE FROM "balances";--> statement-breakpoint
ALTER TABLE "balances" DROP CONSTRAINT "balances_pkey";--> statement-breakpoint
ALTER TABLE "balances" ALTER COLUMN "decimals" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "balances" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "balances" ADD COLUMN "token_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balances_address_token_key" ON "balances" USING btree ("address","token_id");--> statement-breakpoint
/*
  Existing transactions keep their `currency` string, which is the record of
  what was actually paid. token_id stays null for them rather than being
  guessed, and the application fills it in on every row written from now on.
*/
ALTER TABLE "transactions" ADD COLUMN "token_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "transactions" SET "currency" = 'cNGN' WHERE "currency" IS NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "currency" DROP DEFAULT;
