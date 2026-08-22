// Seeds blog-seed.json straight into Supabase, bypassing the Express API.
//
// Use this when you have the service role key but not ADMIN_API_KEY; use
// seed-blogs.mjs when it is the other way round. Same result either way.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node seed/seed-blogs-supabase.mjs
//
// Talks to PostgREST over plain fetch rather than @supabase/supabase-js so it
// runs with no node_modules installed.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// NEXT_PUBLIC_ prefix accepted too, since the values usually get copied out of the dashboard's .env.local.
const SUPABASE_URL = (
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
)?.replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Reading a file? node --env-file=.env.local seed/seed-blogs-supabase.mjs");
  process.exit(1);
}

const rest = `${SUPABASE_URL}/rest/v1`;
const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function call(path, init = {}) {
  const response = await fetch(`${rest}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const here = dirname(fileURLToPath(import.meta.url));
const posts = JSON.parse(readFileSync(join(here, "blog-seed.json"), "utf8"));

console.log(`Seeding ${posts.length} posts -> ${SUPABASE_URL}\n`);

let created = 0;
let skipped = 0;
let failed = 0;

for (const post of posts) {
  try {
    const existing = await call(
      `/blogs?slug=eq.${encodeURIComponent(post.slug)}&select=id`
    );

    if (existing.length > 0) {
      skipped++;
      console.log(`  exists   ${post.slug}`);
      continue;
    }

    // Only one published post may be featured; a partial unique index enforces it.
    if (post.featured) {
      await call(`/blogs?featured=eq.true`, {
        method: "PATCH",
        body: JSON.stringify({ featured: false }),
      });
    }

    const { sections, ...blog } = post;

    const inserted = await call("/blogs", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        ...blog,
        // published_date is what the site reads; this timestamp is for ordering.
        published_at:
          blog.status === "published"
            ? new Date(`${blog.published_date}T00:00:00Z`).toISOString()
            : null,
      }),
    });

    const blogId = inserted[0].id;

    try {
      await call("/blog_sections", {
        method: "POST",
        body: JSON.stringify(sections.map((s) => ({ ...s, blog_id: blogId }))),
      });
    } catch (sectionError) {
      // A post with no body is worse than no post, so unwind rather than leave it.
      await call(`/blogs?id=eq.${blogId}`, { method: "DELETE" });
      throw sectionError;
    }

    created++;
    console.log(`  created  ${post.slug}  (${sections.length} chapters)`);
  } catch (error) {
    failed++;
    console.error(`  FAILED   ${post.slug}  ${error.message}`);
  }
}

console.log(`\ncreated ${created}, skipped ${skipped}, failed ${failed}`);
process.exit(failed > 0 ? 1 : 0);
