// The text is already in the HTML (see vite.config.js); this loads the 3D village (three.js is most of the download).
import './style.css';
import { inject } from '@vercel/analytics';

inject(); // Vercel Web Analytics: visits, referrers, countries, devices
import('./main.js');
