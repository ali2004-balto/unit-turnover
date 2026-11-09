CREATE TYPE "public"."attachment_kind" AS ENUM('photo', 'file', 'link');--> statement-breakpoint
ALTER TYPE "public"."checklist_source" ADD VALUE 'inspection';--> statement-breakpoint
CREATE TABLE "access_links" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"step_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turnover_id" uuid NOT NULL,
	"step_id" uuid,
	"finding_id" uuid,
	"kind" "attachment_kind" NOT NULL,
	"storage_key" text,
	"file_name" text,
	"content_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"url" text,
	"caption" text,
	"full_quality" boolean DEFAULT false NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inspection_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turnover_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"room" text NOT NULL,
	"description" text NOT NULL,
	"needs_work" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_step_id_turnover_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."turnover_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_turnover_id_turnovers_id_fk" FOREIGN KEY ("turnover_id") REFERENCES "public"."turnovers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_step_id_turnover_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."turnover_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_finding_id_inspection_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."inspection_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_people_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_turnover_id_turnovers_id_fk" FOREIGN KEY ("turnover_id") REFERENCES "public"."turnovers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_step_id_turnover_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."turnover_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_links_person" ON "access_links" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_turnover" ON "attachments" USING btree ("turnover_id");--> statement-breakpoint
CREATE INDEX "attachments_step" ON "attachments" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "inspection_findings_step" ON "inspection_findings" USING btree ("step_id");