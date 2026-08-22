// Seeds blog-seed.json into /api/blog. Re-runnable: an existing slug is skipped, not duplicated.
//
//   ADMIN_API_KEY=xxx node seed/seed-blogs.mjs
//   ADMIN_API_KEY=xxx API_BASE=http://localhost:3000 node seed/seed-blogs.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE =
  process.env.API_BASE || "https://website-backend-production-fda7.up.railway.app";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY) {
  console.error("ADMIN_API_KEY is not set. It must match the value on the server.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const posts = JSON.parse(readFileSync(join(here, "blog-seed.json"), "utf8"));

console.log(`Seeding ${posts.length} posts -> ${API_BASE}/api/blog\n`);

let created = 0;
let skipped = 0;
let failed = 0;

for (const post of posts) {
  const response = await fetch(`${API_BASE}/api/blog`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": ADMIN_API_KEY },
    body: JSON.stringify(post),
  });

  const body = await response.json().catch(() => ({}));

  if (response.ok) {
    created++;
    console.log(`  created  ${post.slug}  (${post.sections.length} chapters)`);
  } else if (response.status === 409) {
    skipped++;
    console.log(`  exists   ${post.slug}`);
  } else {
    failed++;
    console.error(`  FAILED   ${post.slug}  ${response.status} ${body.error ?? ""}`);
  }
}

console.log(`\ncreated ${created}, skipped ${skipped}, failed ${failed}`);

const check = await fetch(`${API_BASE}/api/blog`);
const live = await check.json().catch(() => ({}));
console.log(`live published posts: ${live.posts?.length ?? "?"}`);

process.exit(failed > 0 ? 1 : 0);
