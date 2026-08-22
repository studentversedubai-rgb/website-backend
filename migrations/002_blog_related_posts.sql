-- 002 — curated "Relevant stories" + a guard on resource-card links.
--
-- Safe to run more than once. Run it against Supabase (SQL editor) before
-- deploying the matching blog.js / sv-dashboard / sv-web changes; the API only
-- starts selecting `related_slugs` once this column exists.

-- ── 1. Curated related posts ────────────────────────────────────────────────
-- Slugs, not ids. A slug is the post's permanent public identifier, so a tag
-- survives a re-seed and the marketing site can resolve it out of the list it
-- already holds. NULL means "not curated" and the site falls back to
-- newest-first; a non-empty array means the editor chose, and those win.
ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS related_slugs text[];

-- A post in its own Relevant rail is always a mistake, and it is cheap to make
-- impossible. A CHECK may reference other columns of the same row, so this one
-- reads `slug` directly.
DO $$ BEGIN
  ALTER TABLE blogs ADD CONSTRAINT blogs_related_not_self_chk
    CHECK (related_slugs IS NULL OR NOT (slug = ANY (related_slugs)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Empty arrays are normalised away by the API, but a hand-written UPDATE could
-- still leave one, and `related_slugs = '{}'` would read as "curated, nothing
-- to show" and blank the rail.
DO $$ BEGIN
  ALTER TABLE blogs ADD CONSTRAINT blogs_related_not_empty_chk
    CHECK (related_slugs IS NULL OR array_length(related_slugs, 1) >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE blogs SET related_slugs = NULL WHERE related_slugs = '{}';

-- ── 2. Resource-card links ──────────────────────────────────────────────────
-- Every resource block in every chapter was seeded pointing at /contact, which
-- is why "EXPLORE THIS RESOURCE" goes to the contact page on eight cards. The
-- links are editable in sv-dashboard now (Blocks -> Resource card -> Link to).
--
-- This lists what still needs a real destination. It changes nothing — run it,
-- then fix each card in the dashboard, or use the templated UPDATE below.
SELECT b.slug        AS post_slug,
       s.sort_order  AS chapter,
       block ->> 'title' AS card_title,
       block ->> 'href'  AS href
  FROM blogs b
  JOIN blog_sections s ON s.blog_id = b.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.blocks, '[]'::jsonb)) AS block
 WHERE block ->> 'type' = 'resource'
 ORDER BY b.slug, s.sort_order;

-- Retarget one card by its title, in place, without touching the other blocks
-- in the chapter. Fill in the three literals and run once per card.
--
-- UPDATE blog_sections s
--    SET blocks = (
--          SELECT jsonb_agg(
--                   CASE WHEN block ->> 'type' = 'resource'
--                         AND block ->> 'title' = 'CAMPUS PRINT HUB'
--                        THEN jsonb_set(block, '{href}', to_jsonb('/blogs/print-stationery-deals-exam-season'::text))
--                        ELSE block END
--                   ORDER BY ordinality)
--            FROM jsonb_array_elements(s.blocks) WITH ORDINALITY AS t(block, ordinality)
--        )
--   FROM blogs b
--  WHERE b.id = s.blog_id
--    AND b.slug = 'uae-student-budgets-2026'
--    AND s.blocks @> '[{"type":"resource","title":"CAMPUS PRINT HUB"}]'::jsonb;
