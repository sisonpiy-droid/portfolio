import { defineConfig } from 'vite';
import { profile, projects, skills } from './src/content.js';
import { esc, renderers } from './src/render.js';

const site = { profile, projects, skills };

// Search engines read the HTML, not the 3D world, so the name, the text, the whole CV and structured data
// are baked into index.html at build time, from the same content.js the page uses.
const url = profile.url;
const title = `${profile.name} — Founder's Office & Strategy | Portfolio`;
const description = `${profile.name}: founder's office operator in ${profile.location.split(',')[0]}. Founder of LoyalTap, ex-Meteor Venture and Bellwether, MESA School of Business. Portfolio and CV.`;
const [city, country] = profile.location.split(',').map((s) => s.trim());

const person = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: profile.name,
  url: `${url}/`,
  image: `${url}${profile.photo}`,
  jobTitle: profile.title,
  description: profile.summary,
  email: `mailto:${profile.email}`,
  address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: country },
  alumniOf: profile.education.map((e) => ({ '@type': 'EducationalOrganization', name: e.where })),
  knowsAbout: skills.map((s) => s.name),
  sameAs: [profile.linkedin, profile.github, ...profile.elsewhere].filter(Boolean),
};

const head = `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${url}/" />
  <meta property="og:type" content="profile" />
  <meta property="og:url" content="${url}/" />
  <meta property="og:site_name" content="${esc(profile.name)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${url}/og.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(`${profile.name}: ${profile.headline}`)}" />
  <meta property="og:locale" content="en_IN" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">${JSON.stringify(person).replace(/</g, '\\u003c')}</script>`;

const seo = {
  name: 'seo',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => [
      ['<!-- seo -->', head],
      ['<span id="brand"></span>', `<span id="brand">${esc(profile.name)}</span>`],
      ['<span class="hudbrand"></span>', `<span class="hudbrand">${esc(profile.name)}</span>`],
      ['<b class="mono"></b>', `<b class="mono">${esc(profile.name[0])}</b>`],
      ['></h1>', `><span class="sr">${esc(profile.name)}: </span>${esc(profile.headline)}</h1>`],
      ['<p id="intro" class="i" style="--i:2"></p>', `<p id="intro" class="i" style="--i:2">${esc(profile.intro)}</p>`],
      ['<p class="eyebrow i" style="--i:1"></p>', `<p class="eyebrow i" style="--i:1">${esc(profile.title)} · ${esc(profile.location)}</p>`],
      ['<!-- cv -->', `<a class="btn" href="${esc(profile.cv)}" target="_blank" rel="noopener">View CV</a>`],
      ['<p id="quick" class="quick i" style="--i:3"></p>', `<p id="quick" class="quick i" style="--i:3">${renderers(site).contacts().filter((l) => l.url !== profile.cv).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('<span aria-hidden="true">·</span>')}</p>`],
      // the CV the "Browse without driving" button opens, already in the page
      ['<section id="sheet" role="dialog" aria-modal="true" hidden></section>', `<section id="sheet" class="resume" role="dialog" aria-modal="true" hidden>${renderers(site).resumeHTML()}</section>`],
    ].reduce((out, [from, to]) => {
      if (!out.includes(from)) throw new Error(`seo: ${from} is missing from index.html`);
      return out.replaceAll(from, to);
    }, html),
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${url}/sitemap.xml\n` });
    this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${url}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n` });
  },
};

// the 3D engine is its own lazy chunk (~680 kB), loaded after the page is already usable, so the size warning is expected
export default defineConfig({ plugins: [seo], build: { chunkSizeWarningLimit: 750 } });
