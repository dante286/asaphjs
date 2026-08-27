ALTER TABLE "collections" DROP CONSTRAINT "collections_owner_slug_unique";--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_slug_unique" UNIQUE("slug");