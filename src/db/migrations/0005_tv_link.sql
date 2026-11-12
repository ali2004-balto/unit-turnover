ALTER TABLE "app_settings" ADD COLUMN "tv_link_token" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "tv_link_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tv_link_owner_id_people_id_fk" FOREIGN KEY ("tv_link_owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;