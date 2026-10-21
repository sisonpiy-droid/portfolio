# Piyush Sisondia — portfolio

A portfolio you can read in ten seconds or drive through. Live at **https://piyush-sisondia.vercel.app**.

The page leads with the content: a headline, **View projects**, **Download CV** (or **View CV**, see below), and shortcuts to Experience, Education, Skills and Contact. The drivable 3D village (Three.js) is an optional extra behind **Explore the 3D village**. Everything works without it.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (add -- --port 3600 to choose another)
npm test           # builds, then checks content, SEO and accessibility basics (10 tests)
npm run build      # production build into dist/
npm run check:links  # visits every external link in src/content.js (needs the network)
```

Node 20 or newer. The only runtime dependencies are `three` and `@vercel/analytics`; `vite` builds it.

## Change the content

Everything on the site is in [`src/content.js`](src/content.js): profile, experience, education, skills, projects.

- **A project** needs `title`, `tagline`, `category`, `period`, `problem`, `built[]`, `result[]` and `links[]`. Featured projects also have `role`, `stack[]` and `images[]` (the test suite enforces this).
- **Only claim what you can verify.** `result[]` is shown as "Verified outcomes", and `caveat` shows as "Not yet verified". The role lines for the three featured projects come from each repo's git history (single committer, Claude Code co-author trailers); reword them if you like.
- **Links:** add a `Code` link only if the repo is public and a `Live app` link only if the app works. `npm run check:links` tells you.
- **Screenshots:** put an optimised image in `public/projects/` and reference it in `images[]` with its width, height, alt text and caption.

## Add your CV

Copy your CV to **`public/cv.pdf`** and rebuild. The **Download CV** button appears automatically. Until the file exists, the build prints a warning and the button is **View CV**, which opens the whole portfolio as one page with **Print or save as PDF**. No file is ever invented, and no button points at a missing file.

## Search, sharing and accessibility

- `vite.config.js` bakes the title, description, canonical URL, Open Graph tags, `Person` structured data, the full CV text, `sitemap.xml` and `robots.txt` into the HTML at build time, all from `content.js`. Search engines see the content without running the 3D world.
- Keyboard: every control is reachable; cards are real dialogs with a labelled title, focus moves in and returns to the button that opened them, the page behind is `inert`, and **Esc** closes. Visible focus rings. `prefers-reduced-motion` switches off animation, the idle camera orbit, camera shake and the boost zoom.
- No JavaScript: the whole CV is shown in the page.

## When the 3D village cannot run

`src/fallback.js` turns the intro into the whole page, with every button still working, when WebGL is missing, the module fails to load, the 3D loop crashes three frames in a row, or the GPU context is lost. Add **`?3d=off`** to the address to get the same lite version on purpose.

## Performance

- The first download is about 11 kB of script. The 3D engine (~680 kB, 181 kB gzipped) loads afterwards as its own chunk.
- Phones and weak machines (touch screens, narrow windows, 4 or fewer cores or 4 GB or less memory) get a 1024 px shadow map, a 1.25x pixel-ratio cap and lighter anti-aliasing. Desktops get 2048 px shadows and up to 2x.
- If the frame rate stays under about 32 fps, the render resolution steps down (to a minimum of 0.75x). Bloom only runs at night, while boosting or near bright lights. Behind an open card on the intro screen the world draws every other frame.

## Deploy

The site is a static Vite build.

- **GitHub:** https://github.com/sisonpiy-droid/portfolio (`main`).
- **Vercel:** project `piyush-sisondia`, connected to that repo. **Every push to `main` deploys to production.** Build command `npm run build`, output `dist`. `vercel.json` adds security headers and image caching.
- **Analytics:** Vercel Web Analytics (page views only on the free plan). Turn it on in the project's Analytics tab.

First-time setup from scratch: `vercel link`, `vercel git connect`, then `git push`. Manual deploy: `vercel --prod`.

### Custom domain

1. Add the domain in the Vercel project's Domains tab and set the DNS records it shows.
2. Change `url` in `src/content.js` to the new address (it feeds the canonical URL, Open Graph, sitemap, robots and structured data).
3. Regenerate `public/og.jpg`: the preview card prints the old address.
4. Add the property in Google Search Console, submit `sitemap.xml` and request indexing.

## Layout

```
index.html            the page shell and the intro panel
vite.config.js        build-time SEO, pre-rendered CV, CV auto-detection, sitemap and robots
src/content.js        all the words
src/render.js         HTML for every place (shared by the page and the build)
src/sheet.js          the content dialog: focus, inert page, Esc (no 3D inside)
src/boot.js           wires content first, then loads the village
src/fallback.js       WebGL check and the no-3D layout
src/main.js           renderer, quality profile, input, camera, game loop
src/world.js          the 3D village
src/ui.js             HUD, minimap, menu, places while driving
src/sfx.js            synthesised sound effects
test/site.test.mjs    content, SEO and accessibility checks
scripts/check-links.mjs
```

## Known limits

- The village uses `three`'s full namespace, so its chunk is large. It never blocks the content.
- Keyboard users can read everything and open every card; driving itself needs a keyboard or the on-screen pad, as it is a game.
- Vercel Web Analytics on the free plan cannot report which project cards were opened.
