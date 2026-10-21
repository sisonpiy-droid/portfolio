// Content and SEO integrity. `npm test` builds the site first, then checks the content and the built HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { profile, projects, skills } from '../src/content.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const html = read('dist/index.html');
const tag = (re) => html.match(re)?.[1];

test('projects: complete, unique, featured three first', () => {
  assert.equal(new Set(projects.map((p) => p.id)).size, projects.length, 'duplicate project id');
  for (const p of projects) {
    for (const k of ['title', 'tagline', 'category', 'period', 'problem']) assert.ok(p[k], `${p.id} is missing ${k}`);
    for (const k of ['built', 'result']) assert.ok(Array.isArray(p[k]) && p[k].length, `${p.id} is missing ${k}`);
    assert.ok(Array.isArray(p.links), `${p.id} needs a links array (empty is fine)`);
  }
  assert.deepEqual(projects.slice(0, 3).map((p) => p.id), ['vc-pipeline', 'aangan', 'kargo']);
  for (const p of projects.filter((x) => x.featured)) {
    for (const k of ['role', 'stack', 'images']) assert.ok(p[k]?.length, `featured project ${p.id} is missing ${k}`);
  }
});

test('project images exist and have alt text', () => {
  for (const p of projects) for (const im of p.images ?? []) {
    assert.ok(existsSync(new URL(`public${im.src}`, root)), `${im.src} is missing from public/`);
    assert.ok(im.alt && im.caption && im.w && im.h, `${im.src} needs alt, caption and size`);
  }
});

test('links: https only, and nothing private is published', () => {
  const urls = [profile.linkedin, profile.github, ...profile.elsewhere, ...projects.flatMap((p) => p.links.map((l) => l.url))];
  for (const u of urls) assert.match(u, /^https:\/\//, `${u} is not https`);
  const text = JSON.stringify({ profile, projects, skills });
  assert.doesNotMatch(text, /\+91|\b\d{10}\b/, 'a phone number is in the content');
});

test('CV button only exists when the PDF does', () => {
  const has = existsSync(new URL('public/cv.pdf', root));
  assert.equal(html.includes('href="/cv.pdf"'), has);
  assert.equal(html.includes('data-open="resume"'), !has);
});

test('metadata: title, description, canonical, Open Graph', () => {
  const title = tag(/<title>(.*?)<\/title>/);
  assert.ok(title.includes(profile.name) && title.length <= 70, `title: ${title}`);
  const desc = tag(/<meta name="description" content="(.*?)"/);
  assert.ok(desc.length >= 70 && desc.length <= 170, `description is ${desc.length} characters`);
  assert.equal(tag(/<link rel="canonical" href="(.*?)"/), `${profile.url}/`);
  assert.equal(tag(/property="og:url" content="(.*?)"/), `${profile.url}/`);
  const og = tag(/property="og:image" content="(.*?)"/);
  assert.ok(og.startsWith(profile.url) && existsSync(new URL(`dist${new URL(og).pathname}`, root)), 'og:image must be absolute and exist');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
});

test('structured data is a valid Person', () => {
  const ld = JSON.parse(tag(/application\/ld\+json">(.*?)<\/script>/s));
  assert.equal(ld['@type'], 'Person');
  assert.equal(ld.name, profile.name);
  assert.ok(ld.sameAs.includes(profile.linkedin) && ld.sameAs.includes(profile.github));
});

test('sitemap and robots point at the canonical address', () => {
  assert.ok(read('dist/sitemap.xml').includes(`<loc>${profile.url}/</loc>`));
  assert.ok(read('dist/robots.txt').includes(`Sitemap: ${profile.url}/sitemap.xml`));
  assert.doesNotMatch(read('dist/robots.txt'), /Disallow: \//);
});

test('semantics: one h1, a main landmark, alt on every image, labelled buttons', () => {
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(html, /<main id="panel">/);
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) assert.match(img, /\balt="/, `image without alt: ${img.slice(0, 80)}`);
  for (const b of html.match(/<button\b[^>]*>\s*<\/button>/g) ?? []) if (!/\bhidden\b/.test(b)) assert.fail(`empty button: ${b}`); // hidden ones are filled in at runtime
  for (const b of html.match(/<button\b[^>]*>[^<]*<svg[^>]*>.*?<\/svg>\s*<\/button>/gs) ?? []) assert.match(b, /aria-label=/, `icon button without a label: ${b.slice(0, 80)}`);
});

test('the pre-rendered CV contains the featured projects with every section', () => {
  for (const p of projects.slice(0, 3)) assert.ok(html.includes(p.title), `${p.title} missing from the HTML`);
  for (const h of ['Problem', 'Solution', 'Tech stack', 'My contribution', 'Verified outcomes']) assert.ok(html.includes(`<h3>${h}</h3>`), `${h} missing`);
});

test('local assets referenced by the page exist in the build', () => {
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const r of refs) assert.ok(existsSync(new URL(`dist${r}`, root)), `${r} is referenced but not built`);
});
