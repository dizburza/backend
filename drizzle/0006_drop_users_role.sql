-- What a person may do comes from organization_members. A role on the user was
-- read by authorization while nothing legitimate wrote it, so it refused real
-- owners and admitted anyone who passed a role at registration.
DROP INDEX "users_role_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."user_role";
