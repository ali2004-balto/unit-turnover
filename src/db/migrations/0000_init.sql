CREATE TYPE "public"."checklist_source" AS ENUM('template', 'scope', 'send_back', 'manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."checklist_state" AS ENUM('open', 'done', 'to_confirm', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notify_channel" AS ENUM('sms', 'email', 'both', 'none');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'inspector', 'crew', 'cleaner', 'photographer', 'leasing');--> statement-breakpoint
CREATE TYPE "public"."step_kind" AS ENUM('inspection', 'scope', 'work', 'standard');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('not_started', 'scheduled', 'in_progress', 'blocked', 'done', 'na');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"due_soon_days" integer DEFAULT 3 NOT NULL,
	"default_target_days" integer DEFAULT 10,
	"quiet_hours_start" text DEFAULT '20:00' NOT NULL,
	"quiet_hours_end" text DEFAULT '07:00' NOT NULL,
	"digest_time" text DEFAULT '07:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single_row" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"text" text NOT NULL,
	"state" "checklist_state" DEFAULT 'open' NOT NULL,
	"source" "checklist_source" DEFAULT 'manual' NOT NULL,
	"source_item_id" uuid,
	"position" integer NOT NULL,
	"done_by_id" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"turnover_id" uuid NOT NULL,
	"step_id" uuid,
	"actor_id" uuid,
	"type" text NOT NULL,
	"from_status" "step_status",
	"to_status" "step_status",
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"turnover_id" uuid,
	"step_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"channel" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"roles" "role"[] DEFAULT '{}' NOT NULL,
	"company" text,
	"notify_channel" "notify_channel" DEFAULT 'sms' NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"turnover_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"access_notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_step_defaults" (
	"property_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "property_step_defaults_property_id_step_key_pk" PRIMARY KEY("property_id","step_key")
);
--> statement-breakpoint
CREATE TABLE "turnover_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turnover_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"parallel_with_previous" boolean DEFAULT false NOT NULL,
	"role" "role" NOT NULL,
	"kind" "step_kind" DEFAULT 'standard' NOT NULL,
	"allow_na" boolean DEFAULT true NOT NULL,
	"require_checklist" boolean DEFAULT false NOT NULL,
	"due_days" integer,
	"escalate_after_days" integer,
	"status" "step_status" DEFAULT 'not_started' NOT NULL,
	"assignee_id" uuid,
	"scheduled_on" date,
	"scheduled_time" text,
	"due_on" date,
	"activated_at" timestamp with time zone,
	"activation_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_on" date,
	"completed_at" timestamp with time zone,
	"reopened_on" date,
	"reopened_at" timestamp with time zone,
	"blocked_reason" text,
	"blocked_at" timestamp with time zone,
	"blocked_prev_status" "step_status",
	"rework_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turnovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"move_out_date" date,
	"target_ready_date" date,
	"template_id" uuid,
	"template_name" text NOT NULL,
	"notes" text,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"import_source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_template_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"parallel_with_previous" boolean DEFAULT false NOT NULL,
	"role" "role" NOT NULL,
	"kind" "step_kind" DEFAULT 'standard' NOT NULL,
	"allow_na" boolean DEFAULT true NOT NULL,
	"require_checklist" boolean DEFAULT false NOT NULL,
	"due_days" integer,
	"escalate_after_days" integer,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_step_id_turnover_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."turnover_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_done_by_id_people_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_turnover_id_turnovers_id_fk" FOREIGN KEY ("turnover_id") REFERENCES "public"."turnovers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_step_id_turnover_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."turnover_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_people_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_turnover_id_turnovers_id_fk" FOREIGN KEY ("turnover_id") REFERENCES "public"."turnovers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_step_id_turnover_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."turnover_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_requests" ADD CONSTRAINT "processed_requests_turnover_id_turnovers_id_fk" FOREIGN KEY ("turnover_id") REFERENCES "public"."turnovers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_step_defaults" ADD CONSTRAINT "property_step_defaults_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_step_defaults" ADD CONSTRAINT "property_step_defaults_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnover_steps" ADD CONSTRAINT "turnover_steps_turnover_id_turnovers_id_fk" FOREIGN KEY ("turnover_id") REFERENCES "public"."turnovers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnover_steps" ADD CONSTRAINT "turnover_steps_assignee_id_people_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_steps" ADD CONSTRAINT "workflow_template_steps_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_step" ON "checklist_items" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "events_turnover_at" ON "events" USING btree ("turnover_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_pending" ON "notifications" USING btree ("status","send_after");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_unique" ON "people" USING btree (lower("email")) WHERE "people"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "people_phone_unique" ON "people" USING btree ("phone") WHERE "people"."phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_name_unique" ON "properties" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "turnover_steps_key_unique" ON "turnover_steps" USING btree ("turnover_id","key");--> statement-breakpoint
CREATE INDEX "turnover_steps_assignee" ON "turnover_steps" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "turnovers_property_unit" ON "turnovers" USING btree ("property_id","unit");--> statement-breakpoint
CREATE UNIQUE INDEX "template_steps_key_unique" ON "workflow_template_steps" USING btree ("template_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "template_steps_position_unique" ON "workflow_template_steps" USING btree ("template_id","position");