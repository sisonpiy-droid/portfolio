// Paints the intro text straight away, then loads the 3D village (three.js is most of the download).
import './style.css';
import { inject } from '@vercel/analytics';
import { profile } from './content.js';

const $ = (s) => document.querySelector(s);
document.title = `${profile.name} · Portfolio`;
$('#brand').textContent = $('.hudbrand').textContent = profile.name;
for (const m of document.querySelectorAll('.mono')) m.textContent = profile.name.trim()[0]?.toUpperCase() ?? '•';
$('#headline').textContent = profile.headline;
$('#intro').textContent = profile.intro;

inject(); // Vercel Web Analytics: visits, referrers, countries, devices
import('./main.js');
