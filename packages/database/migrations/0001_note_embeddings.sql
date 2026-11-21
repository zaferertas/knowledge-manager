CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "note_embeddings" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"content_revision" integer NOT NULL,
	"model_id" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_embeddings_revision_positive" CHECK ("note_embeddings"."content_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "note_embeddings" ADD CONSTRAINT "note_embeddings_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;
