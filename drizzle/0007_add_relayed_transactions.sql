CREATE TYPE "public"."relay_status" AS ENUM('submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "relayed_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"target_address" varchar(42) NOT NULL,
	"selector" varchar(10) NOT NULL,
	"function_name" text,
	"tx_hash" varchar(66) NOT NULL,
	"status" "relay_status" DEFAULT 'submitted' NOT NULL,
	"gas_used" numeric(78, 0),
	"gas_price_wei" numeric(78, 0),
	"fee_wei" numeric(78, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "relayed_transactions" ADD CONSTRAINT "relayed_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relayed_transactions" ADD CONSTRAINT "relayed_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relayed_transactions_tx_hash_key" ON "relayed_transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "relayed_transactions_from_idx" ON "relayed_transactions" USING btree ("from_address","created_at");--> statement-breakpoint
CREATE INDEX "relayed_transactions_org_idx" ON "relayed_transactions" USING btree ("organization_id","status");