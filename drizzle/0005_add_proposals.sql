CREATE TYPE "public"."proposal_status" AS ENUM('open', 'passed', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."vote_choice" AS ENUM('for', 'against');--> statement-breakpoint
CREATE TABLE "proposal_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"voter_address" varchar(42) NOT NULL,
	"voter_user_id" uuid,
	"voter_name" text NOT NULL,
	"choice" "vote_choice" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount" numeric(78, 0),
	"token_id" uuid,
	"currency" varchar(16),
	"created_by_user_id" uuid,
	"created_by_address" varchar(42) NOT NULL,
	"votes_required" integer NOT NULL,
	"signer_count_at_creation" integer NOT NULL,
	"status" "proposal_status" DEFAULT 'open' NOT NULL,
	"opens_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"settled_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_votes" ADD CONSTRAINT "proposal_votes_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_votes" ADD CONSTRAINT "proposal_votes_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_settled_batch_id_batch_payrolls_id_fk" FOREIGN KEY ("settled_batch_id") REFERENCES "public"."batch_payrolls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_votes_proposal_voter_key" ON "proposal_votes" USING btree ("proposal_id","voter_address");--> statement-breakpoint
CREATE INDEX "proposal_votes_proposal_idx" ON "proposal_votes" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposals_org_status_idx" ON "proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "proposals_org_created_idx" ON "proposals" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "proposals_closes_at_idx" ON "proposals" USING btree ("closes_at");