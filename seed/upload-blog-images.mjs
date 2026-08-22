// Uploads the seeded posts' cover images into the blog-images bucket and repoints
// each row at the public URL.
//
// The seed stored site-relative paths like /blogs/blog-cafes-v1.avif, which the
// marketing site can serve out of its own public/ but the dashboard cannot —
// there the thumbnail 404s against the dashboard's own origin. After this the
// covers are real URLs and a post no longer depends on files shipped in sv-web.
//
//   node --env-file=.env.local seed/upload-blog-images.mjs
//
// Override the source folder with BLOG_IMAGE_DIR if sv-web lives elsewhere.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE_URL = (
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
)?.replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.BLOG_IMAGE_BUCKET ?? "blog-images";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const imageDir =
  process.env.BLOG_IMAGE_DIR ??
  join(here, "..", "..", "..", "work-websites", "sv-web", "public", "blogs");

const auth = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...auth, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const posts = await rest("/blogs?select=id,slug,cover_image_url");

// Two posts share a cover, so upload each file once and reuse the URL.
const localPaths = [
  ...new Set(
    posts
      .map((p) => p.cover_image_url)
      .filter((url) => typeof url === "string" && url.startsWith("/blogs/"))
  ),
];

if (localPaths.length === 0) {
  console.log("No rows still point at /blogs/. Nothing to do.");
  process.exit(0);
}

console.log(`Uploading ${localPaths.length} images -> ${BUCKET}\n`);

const publicUrlFor = new Map();

for (const path of localPaths) {
  const name = basename(path);
  const file = join(imageDir, name);

  if (!existsSync(file)) {
    console.error(`  MISSING  ${name}  (looked in ${imageDir})`);
    continue;
  }

  const bytes = readFileSync(file);

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`,
    {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "image/avif",
        "Cache-Control": "public, max-age=31536000, immutable",
        // Makes the script re-runnable instead of 409ing on a second pass.
        "x-upsert": "true",
      },
      body: bytes,
    }
  );

  if (!response.ok) {
    console.error(`  FAILED   ${name}  ${response.status} ${await response.text()}`);
    continue;
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`;
  publicUrlFor.set(path, url);
  console.log(`  uploaded ${name}  ${(bytes.length / 1024).toFixed(0)} KB`);
}

console.log("");

let repointed = 0;

for (const post of posts) {
  const url = publicUrlFor.get(post.cover_image_url);
  if (!url) continue;

  await rest(`/blogs?id=eq.${post.id}`, {
    method: "PATCH",
    body: JSON.stringify({ cover_image_url: url }),
  });

  repointed++;
  console.log(`  repointed ${post.slug}`);
}

console.log(`\nuploaded ${publicUrlFor.size}, repointed ${repointed} posts`);
