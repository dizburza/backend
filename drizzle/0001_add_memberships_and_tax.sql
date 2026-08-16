CREATE TYPE "public"."membership_role" AS ENUM('owner', 'signer', 'employee');--> statement-breakpoint
CREATE TYPE "public"."tax_status" AS ENUM('computed', 'remitted', 'failed');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"address" varchar(42) NOT NULL,
	"name" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"job_role" text,
	"salary" numeric(78, 0),
	"department" text,
	"employee_id" text,
	"salary_is_gross" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payroll_tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"wallet_address" varchar(42) NOT NULL,
	"gross_minor" numeric(78, 0) NOT NULL,
	"tax_minor" numeric(78, 0) NOT NULL,
	"net_minor" numeric(78, 0) NOT NULL,
	"regime_id" uuid,
	"tax_authority_id" uuid,
	"breakdown" jsonb,
	"status" "tax_status" DEFAULT 'computed' NOT NULL,
	"remittance_tx_hash" varchar(66),
	"remitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"state_code" varchar(16) NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"is_placeholder" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regime_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"lower_bound_minor" numeric(78, 0) NOT NULL,
	"upper_bound_minor" numeric(78, 0),
	"rate_percent" numeric(6, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_regimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"relief_fixed_minor" numeric(78, 0) DEFAULT '0' NOT NULL,
	"relief_percent_of_gross" numeric(6, 3) DEFAULT '0' NOT NULL,
	"relief_additional_percent_of_gross" numeric(6, 3) DEFAULT '0' NOT NULL,
	"minimum_tax_percent" numeric(6, 3) DEFAULT '0' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_signers" DROP CONSTRAINT "organization_signers_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "organization_signers_org_address_key";--> statement-breakpoint
DROP INDEX "organization_signers_address_active_idx";--> statement-breakpoint
DROP INDEX "users_organization_idx";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_identification_number" varchar(32);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "default_tax_state_code" varchar(16);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "salary_is_gross" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tax_state_code" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tax_identification_number" varchar(32);--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_lines" ADD CONSTRAINT "payroll_tax_lines_batch_id_batch_payrolls_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_payrolls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_lines" ADD CONSTRAINT "payroll_tax_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_lines" ADD CONSTRAINT "payroll_tax_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_lines" ADD CONSTRAINT "payroll_tax_lines_regime_id_tax_regimes_id_fk" FOREIGN KEY ("regime_id") REFERENCES "public"."tax_regimes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_lines" ADD CONSTRAINT "payroll_tax_lines_tax_authority_id_tax_authorities_id_fk" FOREIGN KEY ("tax_authority_id") REFERENCES "public"."tax_authorities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_bands" ADD CONSTRAINT "tax_bands_regime_id_tax_regimes_id_fk" FOREIGN KEY ("regime_id") REFERENCES "public"."tax_regimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_address_role_key" ON "organization_members" USING btree ("organization_id","address","role");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_single_employment_key" ON "organization_members" USING btree ("address") WHERE role = 'employee' and is_active;--> statement-breakpoint
CREATE INDEX "organization_members_address_active_idx" ON "organization_members" USING btree ("address","is_active");--> statement-breakpoint
CREATE INDEX "organization_members_org_role_idx" ON "organization_members" USING btree ("organization_id","role","is_active");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_tax_lines_batch_wallet_key" ON "payroll_tax_lines" USING btree ("batch_id","wallet_address");--> statement-breakpoint
CREATE INDEX "payroll_tax_lines_user_idx" ON "payroll_tax_lines" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payroll_tax_lines_org_idx" ON "payroll_tax_lines" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tax_authorities_state_key" ON "tax_authorities" USING btree ("state_code");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_bands_regime_position_key" ON "tax_bands" USING btree ("regime_id","position");--> statement-breakpoint
CREATE INDEX "tax_regimes_effective_idx" ON "tax_regimes" USING btree ("jurisdiction","effective_from");
--> statement-breakpoint
INSERT INTO "organization_members" ("organization_id","user_id","address","name","role","is_active","joined_at")
SELECT s."organization_id", u."id", s."address", s."name",
       CASE WHEN s."address" = o."creator_address" THEN 'owner'::membership_role ELSE 'signer'::membership_role END,
       s."is_active", s."added_at"
FROM "organization_signers" s
JOIN "organizations" o ON o."id" = s."organization_id"
LEFT JOIN "users" u ON u."wallet_address" = s."address"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "organization_members" ("organization_id","user_id","address","name","role","job_role","salary","department","employee_id","is_active","joined_at")
SELECT u."organization_id", u."id", u."wallet_address", u."full_name", 'employee'::membership_role,
       u."job_role", u."salary", u."department", u."employee_id", true, COALESCE(u."joined_at", now())
FROM "users" u
WHERE u."organization_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "organizations"
SET "registration_number" = NULLIF(UPPER(REGEXP_REPLACE("registration_number", '[^a-zA-Z0-9]', '', 'g')), '');--> statement-breakpoint
UPDATE "organizations" o
SET "registration_number" = NULL
WHERE o."registration_number" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "organizations" x
    WHERE x."registration_number" = o."registration_number" AND x."created_at" < o."created_at"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_registration_number_key" ON "organizations" USING btree ("registration_number");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_tin_key" ON "organizations" USING btree ("tax_identification_number");
