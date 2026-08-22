const express = require('express');
const router = express.Router();
const { supabase } = require('./supabase');
const { requireAdmin } = require('./authMiddleware');

/**
 * Blog API.
 *
 * The contract with the marketing site (sv-web) is that THIS FILE returns a
 * post already in the shape the site renders — `lib/blog.ts`'s `BlogPost` —
 * not a raw table row. The site's accessors then become a fetch and nothing
 * else, and no page, component, JSON-LD block or sitemap entry changes.
 *
 * Column names stay snake_case in Postgres; the mapper below is the only place
 * that knows about the translation. If a field is renamed on either side, it is
 * renamed here too and nowhere else.
 */

const CATEGORIES = ['Product Updates', 'Partnerships', 'Student Life', 'Campus'];
const LAYOUTS = ['cards', 'continuous'];

/* Explicit column lists, not `*`: a column added later for the dashboard's own
   use must not silently start appearing in the public API payload. */
const BLOG_COLUMNS = `
  id, slug, category, title, excerpt, published_date, reading_time_min,
  cover_image_url, cover_image_alt, featured, intro, chapter_layout,
  status, summary, tags, published_at, created_at, updated_at
`;

const SECTION_COLUMNS = `
  id, blog_id, sort_order, anchor_id, kicker, heading, content,
  nav_label, badge, blocks, section_image_url
`;

// -------------------- MAPPING --------------------

/**
 * One row of `blog_sections` -> one `BlogChapter`.
 *
 * `heading`/`content` keep their database names but surface as `title`/`body`,
 * which is what the renderer calls them. `badge` and `blocks` are omitted
 * rather than sent as null: the site's types have them optional, and an absent
 * `blocks` is the signal to fall back to `body`.
 */
function toChapter(row) {
  const chapter = {
    id: row.anchor_id,
    kicker: row.kicker,
    title: row.heading,
    body: row.content,
    navLabel: row.nav_label,
  };

  if (row.badge) chapter.badge = row.badge;
  if (Array.isArray(row.blocks) && row.blocks.length > 0) chapter.blocks = row.blocks;

  return chapter;
}

/**
 * One row of `blogs` (plus its sections) -> one `BlogPost`.
 *
 * `date` is `published_date`, a DATE column, which Postgres hands back as
 * `YYYY-MM-DD`. That exact format is load-bearing: the site does
 * `new Date(...date + "T00:00:00Z")`, so a timestamp here produces an Invalid
 * Date in the hero, in the JSON-LD and — fatally — in app/sitemap.ts, where it
 * throws during the build.
 */
function toBlogPost(row, sections) {
  const list = Array.isArray(sections) ? sections : [];

  return {
    slug: row.slug,
    category: row.category,
    title: row.title,
    excerpt: row.excerpt,
    date: row.published_date,
    readMinutes: row.reading_time_min,
    image: row.cover_image_url,
    imageAlt: row.cover_image_alt,
    featured: row.featured === true,
    intro: row.intro,
    chapterLayout: row.chapter_layout,
    chapters: list
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toChapter),
  };
}

// -------------------- VALIDATION --------------------

function isFilledString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * A block is one member of the site's `BlogBlock` union. An unknown `type`, or
 * a known type missing a field, would render as a hole in the article, so it is
 * rejected at the door rather than stored.
 */
function validateBlock(block, path) {
  if (!block || typeof block !== 'object') return path + ' must be an object';

  switch (block.type) {
    case 'paragraph':
      if (!isFilledString(block.text)) return path + '.text is required';
      return null;

    case 'checkList':
      if (!Array.isArray(block.items) || block.items.length === 0) {
        return path + '.items must be a non-empty array';
      }
      for (let i = 0; i < block.items.length; i++) {
        if (!isFilledString(block.items[i])) {
          return path + '.items[' + i + '] must be a non-empty string';
        }
      }
      return null;

    case 'tip':
      if (!isFilledString(block.title)) return path + '.title is required';
      if (!isFilledString(block.text)) return path + '.text is required';
      return null;

    case 'resource':
      if (!isFilledString(block.title)) return path + '.title is required';
      if (!isFilledString(block.description)) return path + '.description is required';
      if (!isFilledString(block.href)) return path + '.href is required';
      return null;

    default:
      return path + '.type must be one of paragraph, checkList, tip, resource';
  }
}

function validatePost(body) {
  const required = ['title', 'excerpt', 'cover_image_url', 'cover_image_alt', 'intro'];

  for (const field of required) {
    if (!isFilledString(body[field])) return field + ' is required';
  }

  if (!CATEGORIES.includes(body.category)) {
    return 'category must be one of: ' + CATEGORIES.join(', ');
  }

  if (body.chapter_layout !== undefined && !LAYOUTS.includes(body.chapter_layout)) {
    return 'chapter_layout must be one of: ' + LAYOUTS.join(', ');
  }

  if (body.status !== undefined && !['draft', 'published'].includes(body.status)) {
    return "status must be 'draft' or 'published'";
  }

  /* The site prints `{n} MIN` in the Start-here tile and `PT{n}M` in the
     BlogPosting JSON-LD. Neither can render a null or a "4 min read" string. */
  if (!Number.isInteger(body.reading_time_min) || body.reading_time_min < 1) {
    return 'reading_time_min must be a positive integer';
  }

  /* Only a published post needs a date, but if one is supplied it must be
     date-only. See the note on `toBlogPost`. */
  if (body.published_date !== undefined && body.published_date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.published_date)) {
      return 'published_date must be an ISO date, YYYY-MM-DD';
    }
  } else if (body.status === 'published') {
    return 'published_date is required when status is published';
  }

  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    return 'At least one section is required';
  }

  const anchors = new Set();

  for (let i = 0; i < body.sections.length; i++) {
    const s = body.sections[i];
    const at = 'sections[' + i + ']';

    if (!isFilledString(s.heading)) return at + '.heading is required';
    if (!isFilledString(s.content)) return at + '.content is required';
    if (!isFilledString(s.nav_label)) return at + '.nav_label is required';
    if (!isFilledString(s.kicker)) return at + '.kicker is required';
    if (!Number.isInteger(s.sort_order)) {
      return at + '.sort_order is required and must be an integer';
    }

    /* anchor_id becomes a DOM id and a URL hash on the detail page. Two
       chapters sharing one means the sticky rail scrolls to the wrong place. */
    const anchor = isFilledString(s.anchor_id) ? s.anchor_id.trim() : 'chapter-' + (i + 1);
    if (anchors.has(anchor)) return at + '.anchor_id "' + anchor + '" is used twice';
    anchors.add(anchor);

    if (s.blocks !== undefined && s.blocks !== null) {
      if (!Array.isArray(s.blocks)) return at + '.blocks must be an array';
      for (let b = 0; b < s.blocks.length; b++) {
        const blockError = validateBlock(s.blocks[b], at + '.blocks[' + b + ']');
        if (blockError) return blockError;
      }
    }
  }

  return null;
}

// -------------------- WRITE HELPERS --------------------

function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function sectionRecords(blogId, sections) {
  return sections.map((s, i) => ({
    blog_id: blogId,
    sort_order: s.sort_order,
    anchor_id: isFilledString(s.anchor_id) ? s.anchor_id.trim() : 'chapter-' + (i + 1),
    kicker: s.kicker.trim(),
    heading: s.heading.trim(),
    content: s.content.trim(),
    nav_label: s.nav_label.trim(),
    badge: isFilledString(s.badge) ? s.badge.trim() : null,
    blocks: Array.isArray(s.blocks) && s.blocks.length > 0 ? s.blocks : null,
    section_image_url: isFilledString(s.section_image_url) ? s.section_image_url.trim() : null,
  }));
}

function blogRecordFrom(body) {
  return {
    title: body.title.trim(),
    category: body.category,
    excerpt: body.excerpt.trim(),
    cover_image_url: body.cover_image_url.trim(),
    cover_image_alt: body.cover_image_alt.trim(),
    intro: body.intro.trim(),
    chapter_layout: body.chapter_layout || 'cards',
    featured: body.featured === true,
    reading_time_min: body.reading_time_min,
    status: body.status || 'draft',
    published_date: body.published_date || null,
    summary: isFilledString(body.summary) ? body.summary.trim() : null,
    tags: Array.isArray(body.tags) && body.tags.length > 0 ? body.tags : null,
  };
}

/**
 * `featured` is unique among published posts at the database level, and a
 * unique-violation is a confusing thing to hand an editor. Clearing the old
 * masthead first turns error 23505 into the behaviour they actually meant: the
 * new post takes over the masthead.
 */
async function clearOtherFeatured(exceptId) {
  let query = supabase.from('blogs').update({ featured: false }).eq('featured', true);
  if (exceptId) query = query.neq('id', exceptId);
  const { error } = await query;
  if (error) throw error;
}

// -------------------- PUBLIC ROUTES --------------------

/**
 * GET /api/blog — every published post, newest first, sections included.
 *
 * Sections come along rather than being withheld for the detail route: the
 * site's index, its "Relevant stories" rail and its sitemap all read the same
 * accessor, and one request beats N+1 for a post count that will stay small for
 * a long time. Revisit if the archive grows past a few hundred.
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blogs')
      .select(BLOG_COLUMNS + ', sections:blog_sections(' + SECTION_COLUMNS + ')')
      .eq('status', 'published')
      .order('published_date', { ascending: false });

    if (error) throw error;

    const posts = (data || []).map((row) => toBlogPost(row, row.sections));

    return res.json({ ok: true, posts });
  } catch (err) {
    console.error('Blog list error:', err);
    return res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

// GET /api/blog/:slug — one published post, sections included.
router.get('/:slug', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blogs')
      .select(BLOG_COLUMNS + ', sections:blog_sections(' + SECTION_COLUMNS + ')')
      .eq('slug', req.params.slug)
      .eq('status', 'published')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Blog post not found' });

    return res.json({ ok: true, post: toBlogPost(data, data.sections) });
  } catch (err) {
    console.error('Blog detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch blog post' });
  }
});

// -------------------- ADMIN ROUTES --------------------

// POST /api/blog — create a post with its sections.
router.post('/', requireAdmin, async (req, res) => {
  const validationError = validatePost(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const record = blogRecordFrom(req.body);
  record.slug = isFilledString(req.body.slug)
    ? req.body.slug.trim()
    : generateSlug(req.body.title);

  if (record.status === 'published') {
    record.published_at = new Date().toISOString();
  }

  try {
    if (record.featured && record.status === 'published') {
      await clearOtherFeatured(null);
    }

    const { data: inserted, error: blogError } = await supabase
      .from('blogs')
      .insert(record)
      .select('id, slug')
      .single();

    if (blogError) throw blogError;

    const { error: sectionsError } = await supabase
      .from('blog_sections')
      .insert(sectionRecords(inserted.id, req.body.sections));

    /* The post row is already in. Leaving it there with no sections would put a
       body-less article in front of readers, so the insert is unwound. */
    if (sectionsError) {
      await supabase.from('blogs').delete().eq('id', inserted.id);
      throw sectionsError;
    }

    return res.json({ ok: true, id: inserted.id, slug: inserted.slug });
  } catch (err) {
    console.error('Blog create error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That slug is already taken' });
    }
    return res.status(500).json({ error: 'Failed to create blog post' });
  }
});

/**
 * PUT /api/blog/:id — update a post and replace its sections.
 *
 * The slug only changes when one is explicitly supplied. It used to be
 * regenerated from the title on every update, which meant a retitle silently
 * moved a published post to a new URL with no redirect behind it — the one
 * thing sv-web's lib/blog.ts documents as forbidden, since the slug is the
 * post's permanent identifier.
 */
router.put('/:id', requireAdmin, async (req, res) => {
  const validationError = validatePost(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const blogId = req.params.id;
  const update = blogRecordFrom(req.body);

  if (isFilledString(req.body.slug)) update.slug = req.body.slug.trim();
  update.updated_at = new Date().toISOString();

  try {
    const { data: existing, error: existingError } = await supabase
      .from('blogs')
      .select('id, published_at')
      .eq('id', blogId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ error: 'Blog post not found' });

    /* First publish stamps the timestamp; a later edit must not move it. */
    if (update.status === 'published' && !existing.published_at) {
      update.published_at = new Date().toISOString();
    }

    if (update.featured && update.status === 'published') {
      await clearOtherFeatured(blogId);
    }

    const { error: blogError } = await supabase
      .from('blogs')
      .update(update)
      .eq('id', blogId);

    if (blogError) throw blogError;

    /* Replace rather than diff: chapter order, anchors and blocks are edited as
       one list, and reconciling them row by row buys nothing at this size. */
    const { error: deleteError } = await supabase
      .from('blog_sections')
      .delete()
      .eq('blog_id', blogId);

    if (deleteError) throw deleteError;

    const { error: sectionsError } = await supabase
      .from('blog_sections')
      .insert(sectionRecords(blogId, req.body.sections));

    if (sectionsError) throw sectionsError;

    return res.json({ ok: true, id: blogId });
  } catch (err) {
    console.error('Blog update error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That slug is already taken' });
    }
    return res.status(500).json({ error: 'Failed to update blog post' });
  }
});

// DELETE /api/blog/:id — delete a post (sections cascade-delete).
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('blogs')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    return res.json({ ok: true });
  } catch (err) {
    console.error('Blog delete error:', err);
    return res.status(500).json({ error: 'Failed to delete blog post' });
  }
});

module.exports = router;
