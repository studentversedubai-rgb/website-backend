ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS category        text,
  ADD COLUMN IF NOT EXISTS excerpt         text,
  ADD COLUMN IF NOT EXISTS cover_image_alt text,
  ADD COLUMN IF NOT EXISTS intro           text,
  ADD COLUMN IF NOT EXISTS chapter_layout  text NOT NULL DEFAULT 'cards',
  ADD COLUMN IF NOT EXISTS featured        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_date  date,
  ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

UPDATE blogs SET category        = COALESCE(category, 'Product Updates');
UPDATE blogs SET excerpt         = COALESCE(excerpt, summary, '');
UPDATE blogs SET cover_image_alt = COALESCE(cover_image_alt, '');
UPDATE blogs SET intro           = COALESCE(intro, summary, '');
UPDATE blogs SET published_date  = COALESCE(published_date, published_at::date);
UPDATE blogs SET reading_time_min = COALESCE(reading_time_min, 1);

ALTER TABLE blogs
  ALTER COLUMN category         SET NOT NULL,
  ALTER COLUMN excerpt          SET NOT NULL,
  ALTER COLUMN cover_image_alt  SET NOT NULL,
  ALTER COLUMN intro            SET NOT NULL,
  ALTER COLUMN reading_time_min SET NOT NULL,
  ALTER COLUMN reading_time_min SET DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE blogs ADD CONSTRAINT blogs_category_chk
    CHECK (category IN ('Product Updates', 'Partnerships', 'Student Life', 'Campus'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE blogs ADD CONSTRAINT blogs_chapter_layout_chk
    CHECK (chapter_layout IN ('cards', 'continuous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE blogs ADD CONSTRAINT blogs_status_chk
    CHECK (status IN ('draft', 'published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE blogs ADD CONSTRAINT blogs_published_needs_date_chk
    CHECK (status <> 'published' OR published_date IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS blogs_slug_key ON blogs (slug);

CREATE UNIQUE INDEX IF NOT EXISTS blogs_one_featured
  ON blogs (featured) WHERE featured AND status = 'published';

CREATE INDEX IF NOT EXISTS blogs_published_idx
  ON blogs (status, published_date DESC);

ALTER TABLE blog_sections
  ADD COLUMN IF NOT EXISTS anchor_id text,
  ADD COLUMN IF NOT EXISTS kicker    text,
  ADD COLUMN IF NOT EXISTS nav_label text,
  ADD COLUMN IF NOT EXISTS badge     text,
  ADD COLUMN IF NOT EXISTS blocks    jsonb;

UPDATE blog_sections
   SET anchor_id = COALESCE(anchor_id, 'chapter-' || (sort_order + 1)),
       kicker    = COALESCE(kicker, 'Chapter ' || (sort_order + 1)),
       nav_label = COALESCE(nav_label, lpad((sort_order + 1)::text, 2, '0') || ' — ' || heading);

ALTER TABLE blog_sections
  ALTER COLUMN anchor_id SET NOT NULL,
  ALTER COLUMN kicker    SET NOT NULL,
  ALTER COLUMN nav_label SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS blog_sections_anchor_key
  ON blog_sections (blog_id, anchor_id);

CREATE INDEX IF NOT EXISTS blog_sections_blog_order_idx
  ON blog_sections (blog_id, sort_order);

DO $$ BEGIN
  ALTER TABLE blog_sections ADD CONSTRAINT blog_sections_blocks_is_array_chk
    CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
