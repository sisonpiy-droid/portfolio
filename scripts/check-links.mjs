// Visits every external link in src/content.js and reports the ones that fail. Needs the network: `npm run check:links`.
// A private GitHub repo answers 404 to visitors, which is exactly what this is here to catch.
import { profile, projects } from '../src/content.js';

const links = new Map();
const add = (url, from) => links.set(url, [...(links.get(url) ?? []), from]);
add(profile.linkedin, 'profile'); add(profile.github, 'profile');
for (const u of profile.elsewhere) add(u, 'profile');
for (const p of projects) for (const l of p.links) add(l.url, p.id);

const skip = (u) => u.includes('linkedin.com'); // LinkedIn answers bots with 999 whatever the profile
let bad = 0;
await Promise.all([...links].map(async ([url, from]) => {
  if (skip(url)) return console.log(`skip  ${url}  (LinkedIn blocks automated checks; open it by hand)`);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (link check)' } });
    if (res.ok) return console.log(`ok    ${url}`);
    bad++; console.log(`FAIL  ${url}  HTTP ${res.status}  (${from.join(', ')})`);
  } catch (e) {
    bad++; console.log(`FAIL  ${url}  ${e.cause?.code ?? e.message}  (${from.join(', ')})`);
  }
}));
console.log(bad ? `\n${bad} link(s) need attention` : '\nAll links respond');
process.exit(bad ? 1 : 0);
