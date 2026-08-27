-- Data migration, ahead of the constraint swap in 0004. Slugs were unique per
-- owner, so two owners could each hold `movies`; going global has to resolve
-- those first or the new unique index can't be created.
--
-- The oldest collection keeps the bare slug — it's the one whose links have had
-- the longest to spread — and the rest take the same `-2`, `-3` suffixes
-- `uniqueSlug()` hands out in the app, so a slug minted by the backfill is
-- indistinguishable from one minted by a create or a rename. The inner loop
-- checks every candidate against the whole table rather than counting
-- duplicates, so a pre-existing `movies-2` is skipped instead of collided with.
DO $$
DECLARE
  duplicate record;
  candidate text;
  suffix int;
BEGIN
  FOR duplicate IN
    SELECT id, slug
    FROM (
      SELECT
        id,
        slug,
        row_number() OVER (PARTITION BY slug ORDER BY created_at, id) AS rn
      FROM collections
    ) ranked
    WHERE rn > 1
    ORDER BY slug, rn
  LOOP
    suffix := 1;
    LOOP
      suffix := suffix + 1;
      candidate := duplicate.slug || '-' || suffix;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM collections WHERE slug = candidate);
    END LOOP;

    UPDATE collections SET slug = candidate WHERE id = duplicate.id;
    RAISE NOTICE 'collections: % -> % (slug taken by an older collection)', duplicate.slug, candidate;
  END LOOP;
END $$;
