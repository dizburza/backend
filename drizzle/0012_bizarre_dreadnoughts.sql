CREATE TYPE "public"."signer_change_status" AS ENUM('pending', 'approved', 'executed', 'expired');--> statement-breakpoint
CREATE TABLE "signer_change_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signer_change_id" uuid NOT NULL,
	"signer_address" varchar(42) NOT NULL,
	"signer_name" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signer_change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_address" varchar(42) NOT NULL,
	"proposal_id" varchar(66) NOT NULL,
	"subject_address" varchar(42) NOT NULL,
	"subject_name" text NOT NULL,
	"is_removal" boolean DEFAULT false NOT NULL,
	"signer_epoch" integer NOT NULL,
	"created_by_address" varchar(42) NOT NULL,
	"quorum_required" integer NOT NULL,
	"status" "signer_change_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"executed_by" varchar(42),
	"tx_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signer_change_approvals" ADD CONSTRAINT "signer_change_approvals_signer_change_id_signer_change_proposals_id_fk" FOREIGN KEY ("signer_change_id") REFERENCES "public"."signer_change_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signer_change_proposals" ADD CONSTRAINT "signer_change_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signer_change_approvals_change_signer_key" ON "signer_change_approvals" USING btree ("signer_change_id","signer_address");--> statement-breakpoint
CREATE UNIQUE INDEX "signer_change_proposals_proposal_id_key" ON "signer_change_proposals" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "signer_change_proposals_org_status_idx" ON "signer_change_proposals" USING btree ("organization_id","status");