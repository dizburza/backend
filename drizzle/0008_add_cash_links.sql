CREATE TYPE "public"."cash_link_status" AS ENUM('open', 'claiming', 'claimed', 'cancelled', 'reclaimed');--> statement-breakpoint
CREATE TABLE "cash_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_address" varchar(42) NOT NULL,
	"sender_address" varchar(42) NOT NULL,
	"sender_user_id" uuid,
	"amount" numeric(78, 0) NOT NULL,
	"fee_amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"token_id" uuid,
	"description" text,
	"status" "cash_link_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claiming_until" timestamp with time zone,
	"claimed_by_address" varchar(42),
	"claimed_by_user_id" uuid,
	"create_tx_hash" varchar(66),
	"settle_tx_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cash_links" ADD CONSTRAINT "cash_links_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_links" ADD CONSTRAINT "cash_links_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_links" ADD CONSTRAINT "cash_links_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_links_claim_address_key" ON "cash_links" USING btree ("claim_address");--> statement-breakpoint
CREATE INDEX "cash_links_sender_idx" ON "cash_links" USING btree ("sender_address","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cash_links_sweep_idx" ON "cash_links" USING btree ("status","expires_at");