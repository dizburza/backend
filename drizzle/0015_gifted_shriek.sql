ALTER TABLE "payroll_tax_lines" ADD COLUMN "remittance_reference" text;--> statement-breakpoint
ALTER TABLE "payroll_tax_lines" ADD COLUMN "remitted_by" uuid;--> statement-breakpoint
ALTER TABLE "payroll_tax_lines" ADD CONSTRAINT "payroll_tax_lines_remitted_by_users_id_fk" FOREIGN KEY ("remitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;