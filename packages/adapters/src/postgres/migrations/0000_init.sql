CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"scene_count" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text,
	"status" text NOT NULL,
	"progress" double precision NOT NULL,
	"output_path" text,
	"srt_path" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "render_jobs_status_check" CHECK ("render_jobs"."status" in ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "sfx_library" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"path" text NOT NULL,
	"duration_ms" integer,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_updated_at_idx" ON "projects" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "render_jobs_status_created_at_idx" ON "render_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "render_jobs_project_id_idx" ON "render_jobs" USING btree ("project_id");