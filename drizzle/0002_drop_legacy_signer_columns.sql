DROP TABLE "organization_signers" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "organization_slug";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "job_role";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "salary";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "department";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "joined_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "employee_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "salary_is_gross";