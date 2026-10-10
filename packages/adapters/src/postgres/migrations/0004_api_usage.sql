CREATE TABLE "api_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"operation" text NOT NULL,
	"project_id" text,
	"job_id" text,
	"status" text NOT NULL,
	"estimated_usd" double precision NOT NULL,
	"usd" double precision NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"characters" integer,
	"message" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_usage_status_check" CHECK ("api_usage"."status" in ('ok', 'failed', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "budget_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_usage_created_at_idx" ON "api_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_usage_project_id_idx" ON "api_usage" USING btree ("project_id");