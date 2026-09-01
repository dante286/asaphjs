-- `collection_members.invited_by` had no ON DELETE action, which made account
-- deletion impossible for any owner who had ever sent an invite: deleting the
-- `user` row cascades to `collections` and on to these rows, but Postgres fires
-- both referential triggers on the same statement in constraint-name order, and
-- `collection_members_invited_by_...` sorts ahead of `collections_owner_id_...`
-- — so the check ran against rows that hadn't been cascaded away yet and raised
-- 23503. `set null` keeps the membership and drops only the provenance.
ALTER TABLE "collection_members" DROP CONSTRAINT "collection_members_invited_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
