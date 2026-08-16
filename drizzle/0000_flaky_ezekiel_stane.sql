CREATE TYPE "public"."audit_action" AS ENUM('ADD', 'UPDATE', 'REMOVE');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('pending', 'approved', 'executed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."transaction_category" AS ENUM('salary', 'food', 'transport', 'utilities', 'entertainment', 'shopping', 'health', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('send', 'receive', 'payroll', 'qr_payment', 'bank_transfer', 'airtime', 'bills');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'employee', 'signer', 'admin');--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"nonce" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"raw" numeric(78, 0) DEFAULT '0' NOT NULL,
	"decimals" integer DEFAULT 6 NOT NULL,
	"block_number" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_payroll_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"signer_address" varchar(42) NOT NULL,
	"signer_name" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_payroll_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid,
	"wallet_address" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"employee_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_payrolls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_name" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_address" varchar(42) NOT NULL,
	"creator_address" varchar(42) NOT NULL,
	"total_amount" numeric(78, 0) NOT NULL,
	"status" "batch_status" DEFAULT 'pending' NOT NULL,
	"quorum_required" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"executed_by" varchar(42),
	"tx_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_user_id" uuid,
	"employee_username" varchar(40),
	"employee_wallet_address" varchar(42),
	"action" "audit_action" NOT NULL,
	"performed_by_user_id" uuid,
	"performed_by_username" varchar(40),
	"performed_by_wallet_address" varchar(42),
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_cursors" (
	"key" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"event_name" text NOT NULL,
	"last_indexed_block" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onchain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"webhook_id" text,
	"webhook_event_id" text,
	"chain_id" integer,
	"block_number" integer,
	"tx_hash" varchar(66),
	"log_index" integer,
	"address" varchar(42),
	"topic0" varchar(66),
	"topics" jsonb,
	"data" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"address" varchar(42) NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(60) NOT NULL,
	"contract_address" varchar(42) NOT NULL,
	"organization_hash" varchar(66) NOT NULL,
	"creator_address" varchar(42) NOT NULL,
	"business_email" text NOT NULL,
	"registration_number" text,
	"registration_type" text,
	"certificate_file_url" text,
	"certificate_file_name" text,
	"certificate_uploaded_at" timestamp with time zone,
	"quorum" integer NOT NULL,
	"industry" text,
	"size" text,
	"description" text,
	"payroll_currency" varchar(16) DEFAULT 'cNGN' NOT NULL,
	"default_payment_day" integer,
	"time_zone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_transactions" (
	"tx_hash" varchar(66) PRIMARY KEY NOT NULL,
	"submitted_by" varchar(42) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"type" "transaction_type" NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"amount" numeric(78, 0) NOT NULL,
	"currency" varchar(16) DEFAULT 'cNGN' NOT NULL,
	"fee" numeric(78, 0),
	"gas_used" numeric(78, 0),
	"description" text,
	"memo" text,
	"reference" varchar(64),
	"category" "transaction_category",
	"qr_code" text,
	"merchant_name" text,
	"batch_id" uuid,
	"batch_name" text,
	"organization_id" uuid,
	"block_number" integer,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"bank_account_number" text,
	"bank_name" text,
	"bank_account_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"username" varchar(40) NOT NULL,
	"surname" text NOT NULL,
	"firstname" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone_number" text,
	"avatar" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"organization_id" uuid,
	"organization_slug" varchar(60),
	"job_role" text,
	"salary" numeric(78, 0),
	"department" text,
	"joined_at" timestamp with time zone,
	"employee_id" text,
	"date_of_birth" timestamp with time zone,
	"address_line" text,
	"city" text,
	"country" text DEFAULT 'Nigeria',
	"currency" varchar(16) DEFAULT 'cNGN' NOT NULL,
	"notifications" boolean DEFAULT true NOT NULL,
	"language" varchar(8) DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"last_login_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_payroll_approvals" ADD CONSTRAINT "batch_payroll_approvals_batch_id_batch_payrolls_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_payrolls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_payroll_recipients" ADD CONSTRAINT "batch_payroll_recipients_batch_id_batch_payrolls_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_payrolls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_payroll_recipients" ADD CONSTRAINT "batch_payroll_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_payrolls" ADD CONSTRAINT "batch_payrolls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_audit_logs" ADD CONSTRAINT "employee_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_audit_logs" ADD CONSTRAINT "employee_audit_logs_employee_user_id_users_id_fk" FOREIGN KEY ("employee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_audit_logs" ADD CONSTRAINT "employee_audit_logs_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signers" ADD CONSTRAINT "organization_signers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_batch_id_batch_payrolls_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_payrolls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balances_fetched_at_idx" ON "balances" USING btree ("fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_payroll_approvals_batch_signer_key" ON "batch_payroll_approvals" USING btree ("batch_id","signer_address");--> statement-breakpoint
CREATE INDEX "batch_payroll_recipients_batch_idx" ON "batch_payroll_recipients" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_payrolls_name_key" ON "batch_payrolls" USING btree ("batch_name");--> statement-breakpoint
CREATE INDEX "batch_payrolls_org_status_idx" ON "batch_payrolls" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "employee_audit_logs_org_time_idx" ON "employee_audit_logs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "employee_audit_logs_employee_idx" ON "employee_audit_logs" USING btree ("employee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_events_key_key" ON "onchain_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "onchain_events_tx_idx" ON "onchain_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_signers_org_address_key" ON "organization_signers" USING btree ("organization_id","address");--> statement-breakpoint
CREATE INDEX "organization_signers_address_active_idx" ON "organization_signers" USING btree ("address","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_contract_address_key" ON "organizations" USING btree ("contract_address");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_hash_key" ON "organizations" USING btree ("organization_hash");--> statement-breakpoint
CREATE INDEX "organizations_creator_idx" ON "organizations" USING btree ("creator_address");--> statement-breakpoint
CREATE INDEX "pending_transactions_submitted_at_idx" ON "pending_transactions" USING btree ("submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_hash_log_key" ON "transactions" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "transactions_from_time_idx" ON "transactions" USING btree ("from_address","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_to_time_idx" ON "transactions" USING btree ("to_address","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_status_time_idx" ON "transactions" USING btree ("status","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_org_time_idx" ON "transactions" USING btree ("organization_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_reference_idx" ON "transactions" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "users_organization_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");