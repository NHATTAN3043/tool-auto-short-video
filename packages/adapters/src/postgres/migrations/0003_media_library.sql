CREATE TABLE "media_library" (
	"id" text PRIMARY KEY NOT NULL,
	"source_ref" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "media_library_source_ref_idx" ON "media_library" USING btree ("source_ref");