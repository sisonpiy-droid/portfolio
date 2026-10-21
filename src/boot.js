// The text is already in the HTML (see vite.config.js). This wires the content buttons straight away, then
// loads the 3D village (three.js is most of the download) as an optional extra.
import './style.css';
import { inject } from '@vercel/analytics';
import { profile, projects, skills } from './content.js';
import { renderers } from './render.js';
import { initSheet } from './sheet.js';
import { liteRequested, noWorld, webglAvailable } from './fallback.js';

initSheet(renderers({ profile, projects, skills }));
inject(); // Vercel Web Analytics: visits, referrers, countries, devices

if (liteRequested) noWorld('Lite version: the 3D village is off. Remove ?3d=off from the address to bring it back.');
else if (!webglAvailable()) noWorld('3D is not available on this device, so this is the portfolio without it.');
else import('./main.js').catch((e) => { console.error(e); noWorld('The 3D village could not load. Everything else works.'); });
