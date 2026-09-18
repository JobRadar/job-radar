ALTER TABLE "search_keywords" ALTER COLUMN "keyword" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "search_keywords" ADD COLUMN "professional_roles" jsonb;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "applicants_count" integer;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "applicants_count_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;