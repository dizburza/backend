CREATE TYPE "public"."membership_status" AS ENUM('invited', 'joined');--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" varchar(42) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organization_members" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "status" "membership_status" DEFAULT 'joined' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invites_token_key" ON "organization_invites" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invites_live_key" ON "organization_invites" USING btree ("organization_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_email_key" ON "organization_members" USING btree ("organization_id",lower("email")) WHERE email is not null and is_active;--> statement-breakpoint
CREATE INDEX "organization_members_org_status_idx" ON "organization_members" USING btree ("organization_id","status");