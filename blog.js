const express = require('express');
const router = express.Router();
const { supabase } = require('./supabase');
const { requireAdmin } = require('./authMiddleware');

// -------------------- HELPERS --------------------

function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function validatePost(body) {
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return 'title is required';
  }
  if (!body.cover_image_url || typeof body.cover_image_url !== 'string' || !body.cover_image_url.trim()) {
    return 'cover_image_url is required';
  }
  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    return 'At least one section is required';
  }

  for (let i = 0; i < body.sections.length; i++) {
    const s = body.sections[i];
    if (!s.heading || typeof s.heading !== 'string' || !s.heading.trim()) {
      return `sections[${i}].heading is required`;
    }
    if (!s.content || typeof s.content !== 'string' || !s.content.trim()) {
      return `sections[${i}].content is required`;
    }
    if (s.sort_order === undefined || typeof s.sort_order !== 'number') {
      return `sections[${i}].sort_order is required and must be a number`;
    }
  }

  return null;
}

// -------------------- PUBLIC ROUTES --------------------

// GET /api/blog — List all published posts (no sections)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blogs')
      .select('id, title, slug, cover_image_url, summary, tags, reading_time_min, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error) throw error;

    return res.json({ ok: true, posts: data });
  } catch (err) {
    console.error('Blog list error:', err);
    return res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

// GET /api/blog/:slug — Get a single post with all sections
router.get('/:slug', async (req, res) => {
  try {
    const { data: post, error: postError } = await supabase
      .from('blogs')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('status', 'published')
      .single();

    if (postError || !post) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    const { data: sections, error: sectionsError } = await supabase
      .from('blog_sections')
      .select('id, sort_order, heading, content, section_image_url')
      .eq('blog_id', post.id)
      .order('sort_order', { ascending: true });

    if (sectionsError) throw sectionsError;

    return res.json({ ok: true, post: { ...post, sections } });
  } catch (err) {
    console.error('Blog detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch blog post' });
  }
});

// -------------------- ADMIN ROUTES --------------------

// POST /api/blog — Create a new blog post with sections
router.post('/', requireAdmin, async (req, res) => {
  const validationError = validatePost(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const slug = req.body.slug
    ? req.body.slug.trim()
    : generateSlug(req.body.title);

  const status = req.body.status || 'draft';

  const blogRecord = {
    title: req.body.title.trim(),
    slug,
    cover_image_url: req.body.cover_image_url.trim(),
    summary: req.body.summary?.trim() || null,
    status,
    tags: req.body.tags || null,
    reading_time_min: req.body.reading_time_min || null,
    published_at: status === 'published' ? new Date().toISOString() : null,
  };

  try {
    // Insert the blog post
    const { data: inserted, error: blogError } = await supabase
      .from('blogs')
      .insert(blogRecord)
      .select('id')
      .single();

    if (blogError) throw blogError;

    // Insert sections
    const sectionRecords = req.body.sections.map((s) => ({
      blog_id: inserted.id,
      sort_order: s.sort_order,
      heading: s.heading.trim(),
      content: s.content.trim(),
      section_image_url: s.section_image_url?.trim() || null,
    }));

    const { error: sectionsError } = await supabase
      .from('blog_sections')
      .insert(sectionRecords);

    if (sectionsError) throw sectionsError;

    return res.json({ ok: true, id: inserted.id, slug });
  } catch (err) {
    console.error('Blog create error:', err);
    return res.status(500).json({ error: 'Failed to create blog post' });
  }
});

// PUT /api/blog/:id — Update an existing post and replace its sections
router.put('/:id', requireAdmin, async (req, res) => {
  const validationError = validatePost(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const blogId = req.params.id;
  const status = req.body.status || 'draft';

  const blogUpdate = {
    title: req.body.title.trim(),
    slug: req.body.slug?.trim() || generateSlug(req.body.title),
    cover_image_url: req.body.cover_image_url.trim(),
    summary: req.body.summary?.trim() || null,
    status,
    tags: req.body.tags || null,
    reading_time_min: req.body.reading_time_min || null,
  };

  // Set published_at if publishing for the first time
  if (status === 'published') {
    const { data: existing } = await supabase
      .from('blogs')
      .select('published_at')
      .eq('id', blogId)
      .single();

    if (!existing?.published_at) {
      blogUpdate.published_at = new Date().toISOString();
    }
  }

  try {
    // Update the blog post
    const { error: blogError } = await supabase
      .from('blogs')
      .update(blogUpdate)
      .eq('id', blogId);

    if (blogError) throw blogError;

    // Delete old sections and insert new ones
    const { error: deleteError } = await supabase
      .from('blog_sections')
      .delete()
      .eq('blog_id', blogId);

    if (deleteError) throw deleteError;

    const sectionRecords = req.body.sections.map((s) => ({
      blog_id: blogId,
      sort_order: s.sort_order,
      heading: s.heading.trim(),
      content: s.content.trim(),
      section_image_url: s.section_image_url?.trim() || null,
    }));

    const { error: sectionsError } = await supabase
      .from('blog_sections')
      .insert(sectionRecords);

    if (sectionsError) throw sectionsError;

    return res.json({ ok: true, id: blogId });
  } catch (err) {
    console.error('Blog update error:', err);
    return res.status(500).json({ error: 'Failed to update blog post' });
  }
});

// DELETE /api/blog/:id — Delete a post (sections cascade-delete)
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
