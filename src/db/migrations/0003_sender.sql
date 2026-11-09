ALTER TYPE "public"."notification_status" ADD VALUE 'sending' BEFORE 'sent';--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "last_morning_run_on" date;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "deliveries" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "rendered" jsonb;--> statement-breakpoint
CREATE INDEX "notifications_created" ON "notifications" USING btree ("created_at");