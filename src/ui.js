import { LIMIT } from './world.js';
import { esc, renderers } from './render.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('portfolio:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('portfolio:' + k, JSON.stringify(v)); } catch { /* private mode: progress just won't persist */ } },
};

export function createUI({ site, world, actions }) {
  const stops = world.stops;
  const found = new Set(store.get('found', []));
  const sheet = $('#sheet'), menu = $('#menu'), autoSheet = $('#auto'), toastEl = $('#toast'), promptEl = $('#prompt');
  let sheetOpen = false, menuOpen = false, toastTimer, currentAuto = null;

  const { contacts, projectHTML, aboutHTML, skillsHTML, galleryHTML, contactHTML, resumeHTML, ranked } = renderers(site);
  quickLinks();

  const placeHTML = (s) => ({ about: aboutHTML, projects: galleryHTML, skills: skillsHTML, contact: contactHTML })[s.kind]();
  function quickLinks() { // CV, email and LinkedIn straight from the intro panel
    const c = contacts();
    $('#quick').innerHTML = c.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('<span>·</span>');
    $('#quick').hidden = !c.length;
  }
  setTimeout(() => { // the loader is a nicety: the world is already built
    document.body.classList.add('ready');
    $('#loadtext').textContent = 'All set. Enjoy the drive!';
  }, 1500);

  /* ---------- progress ---------- */
  const dashHTML = () => stops.map((s) => `<i class="${found.has(s.label) ? 'f' : ''}"></i>`).join('');
  function refreshProgress() {
    $('#navdashes').innerHTML = $('#dashes').innerHTML = dashHTML();
    $('#found').textContent = `${found.size} of ${stops.length} places found`;
    for (const s of stops) { world.setFound(s, found.has(s.label)); s.tag.classList.toggle('found', found.has(s.label)); }
  }
  function markFound(s) {
    if (found.has(s.label)) return false;
    found.add(s.label);
    store.set('found', [...found]);
    refreshProgress();
    toast(found.size === stops.length ? `All ${stops.length} places found — nice drive!` : `${s.label} found · ${found.size} of ${stops.length}`);
    return true;
  }
  const isFound = (s) => found.has(s.label);

  /* ---------- tags ---------- */
  const tagsEl = $('#tags');
  stops.forEach((s, i) => {
    s.tag = document.createElement('div');
    s.tag.className = 'tag';
    s.tag.innerHTML = `<b>${i + 1}</b><span><small>${s.sub ?? ''}</small>${s.label}</span><i></i>`;
    s.dist = s.tag.lastChild;
    tagsEl.appendChild(s.tag);
  });
  refreshProgress();

  /* ---------- toast & prompt ---------- */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }
  function prompt(text) {
    promptEl.hidden = !text;
    if (text && promptEl.textContent !== text) promptEl.textContent = text;
  }

  /* ---------- sheet (a place, or everything) ---------- */
  function openSheet(html, cls = '') {
    sheet.className = cls;
    sheet.innerHTML = `<button class="x" aria-label="Close">×</button>${html}`;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    sheetOpen = true;
    document.body.classList.add('modal');
    sheet.querySelector('.x').focus();
  }
  const openPlace = (s) => openSheet(placeHTML(s));
  const openResume = () => openSheet(resumeHTML(), 'resume');
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('.x')) return close();
    const byId = (id) => site.projects.find((p) => p.id === id);
    const pick = e.target.closest('[data-project]'), next = e.target.closest('[data-next]'), go = e.target.closest('[data-go]');
    if (pick) openSheet(projectHTML(byId(pick.dataset.project)));
    else if (next) { const i = ranked.findIndex((p) => p.id === next.dataset.next); openSheet(projectHTML(ranked[(i + 1) % ranked.length])); }
    else if (go) openSheet(galleryHTML());
  });

  /* ---------- map (minimap + big map) ---------- */
  function drawMap(cv, { cx, cz, scale, P, target, big, rot }) {
    const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#d3e9bd';
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    if (rot != null) g.rotate(rot); // heading-up for the minimap
    g.scale(scale, scale);
    g.translate(-cx, -cz);
    g.lineJoin = 'round';
    const poly = (pts) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke(); };
    g.strokeStyle = '#9fd0f5';
    for (const r of world.shapes.water) {
      if (r.pts) { g.lineWidth = r.w; poly(r.pts); } else { g.fillStyle = '#9fd0f5'; g.beginPath(); g.arc(r.x, r.z, r.r, 0, Math.PI * 2); g.fill(); }
    }
    g.strokeStyle = '#9aa3b2'; g.lineWidth = 1.6; g.setLineDash([4, 3]);
    for (const r of world.shapes.rails) poly(r.pts);
    g.setLineDash([]);
    g.strokeStyle = '#fff';
    for (const r of world.shapes.roads) { g.lineWidth = r.w; poly(r.pts); }
    for (const d of world.shapes.discs) { g.fillStyle = d.color; g.beginPath(); g.arc(d.x, d.z, d.r, 0, Math.PI * 2); g.fill(); }
    for (const r of world.shapes.rects) {
      g.save(); g.translate(r.x, r.z); g.rotate(-r.yaw); g.fillStyle = r.color; g.fillRect(-r.w / 2, -r.d / 2, r.w, r.d); g.restore();
    }
    if (target) { // dashed route to the target
      g.setLineDash([6 / scale, 5 / scale]); g.strokeStyle = '#2f66d6'; g.lineWidth = 2.5 / scale;
      g.beginPath(); g.moveTo(P.x, P.z); g.lineTo(target.x, target.z); g.stroke(); g.setLineDash([]);
    }
    for (const s of stops) {
      g.fillStyle = isFound(s) ? '#2fb36b' : '#2f66d6'; g.strokeStyle = '#fff'; g.lineWidth = 2 / scale;
      g.beginPath(); g.arc(s.x, s.z, (big ? 6 : 4.5) / scale, 0, Math.PI * 2); g.fill(); g.stroke();
      if (big) {
        g.font = `800 ${13 / scale}px Manrope, system-ui, sans-serif`; g.textAlign = 'center';
        g.lineWidth = 4 / scale; g.strokeStyle = '#fff'; g.strokeText(s.label, s.x, s.z - 11 / scale);
        g.fillStyle = '#1b3263'; g.fillText(s.label, s.x, s.z - 11 / scale);
      }
    }
    g.save(); g.translate(P.x, P.z); g.rotate(-P.h); // the car, nose along its heading
    const k = 8 / scale;
    g.fillStyle = '#1b3263'; g.strokeStyle = '#fff'; g.lineWidth = 2 / scale;
    g.beginPath(); g.moveTo(0, k); g.lineTo(k * 0.7, -k * 0.8); g.lineTo(0, -k * 0.35); g.lineTo(-k * 0.7, -k * 0.8); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }

  /* ---------- menu ---------- */
  const tabs = menu.querySelectorAll('.tabs button'), panes = menu.querySelectorAll('.tab');
  function showTab(name) {
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    panes.forEach((p) => (p.hidden = p.dataset.tab !== name));
  }
  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function openMenu(tab = 'places') {
    $('#places').innerHTML = stops.map((s, i) => `<li><button data-i="${i}"><span><b>${s.label}</b><i>${s.sub ?? ''}</i></span><em class="pill ${isFound(s) ? 'f' : ''}">${isFound(s) ? 'Found' : 'Set route'}</em></button></li>`).join('');
    showTab(tab);
    menu.hidden = false;
    menuOpen = true;
    document.body.classList.add('modal');
    menu.querySelector('.x').focus();
  }
  $('#places').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    close();
    actions.route(stops[+b.dataset.i]);
  });
  menu.addEventListener('click', (e) => (e.target === menu || e.target.closest('.x')) && close());

  /* ---------- self-driving sheet (docked, does not pause the world) ---------- */
  const parkInfo = world.park;
  function openAuto() {
    const sameStop = (s) => currentAuto?.kind === 'stop' && currentAuto.stop === s;
    $('#autolist').innerHTML = stops.map((s, i) => `<li><button data-i="${i}"><span><b>${s.label}</b><i>${s.sub ?? ''}</i></span>${sameStop(s) ? '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>' : ''}</button></li>`).join('')
      + `<li><button data-i="park"><span><b>${parkInfo.label}</b><i>${parkInfo.free} of ${parkInfo.total} spaces free</i></span>${currentAuto?.kind === 'park' ? '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>' : '<em class="park">P</em>'}</button></li>`;
    autoSheet.hidden = false;
  }
  $('#autolist').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    autoSheet.hidden = true;
    actions.autoTo(b.dataset.i === 'park' ? { kind: 'park' } : { kind: 'stop', stop: stops[+b.dataset.i] });
  });
  autoSheet.querySelector('.x').addEventListener('click', () => (autoSheet.hidden = true));

  const night = store.get('night', false);
  $('#optNight').checked = night;
  const applyNight = (on) => { world.setNight(on); document.body.classList.toggle('night', on); store.set('night', on); };
  applyNight(night);
  $('#optNight').addEventListener('change', (e) => applyNight(e.target.checked));
  function toggleNight() { // the N key
    const on = !$('#optNight').checked;
    $('#optNight').checked = on;
    applyNight(on);
    toast(on ? 'Night' : 'Day');
  }
  $('#optSound').addEventListener('change', (e) => actions.sound(e.target.checked));
  $('#optRain').addEventListener('change', (e) => actions.rain(e.target.checked));
  const sfxOn = store.get('sfx', true);
  $('#optSfx').checked = sfxOn;
  actions.sfx(sfxOn);
  $('#optSfx').addEventListener('change', (e) => { store.set('sfx', e.target.checked); actions.sfx(e.target.checked); });
  $('#optRepair').addEventListener('click', () => actions.repair());
  $('#optReset').addEventListener('click', () => { found.clear(); store.set('found', []); refreshProgress(); toast('Progress reset'); });

  function close() {
    const was = sheetOpen || menuOpen || !autoSheet.hidden;
    sheet.hidden = menu.hidden = autoSheet.hidden = true;
    sheetOpen = menuOpen = false;
    document.body.classList.remove('modal');
    return was;
  }

  /* ---------- per-frame HUD ---------- */
  const mini = $('#minimap'), big = $('#bigmap'), north = $('#north'), navLabel = $('#navlabel'), navDist = $('#navdist'), navArrow = $('#navarrow');
  const boostEl = $('#boost'), boostFill = $('#boostfill'), navcard = $('#navcard');
  function frame({ P, target, active, driving, project, arrowAngle, boost, boostLocked, auto }) {
    currentAuto = auto;
    boostFill.style.transform = `scaleX(${boost})`;
    boostEl.classList.toggle('locked', boostLocked);
    for (const s of stops) {
      const d = Math.hypot(P.x - s.x, P.z - s.z), p = project(s.x, 0.5, s.z);
      s.tag.style.visibility = p.behind ? 'hidden' : 'visible'; // the chase camera can look away from a place
      s.tag.style.transform = `translate(${p.x}px, ${p.y - 38}px) translate(-50%, -100%)`;
      s.tag.classList.toggle('on', s === active);
      const txt = s === active ? '' : `${Math.round(d)} m`;
      if (s.dist.textContent !== txt) s.dist.textContent = txt;
    }
    const t = auto ? (auto.kind === 'park' ? parkInfo : auto.stop) : target;
    navcard.classList.toggle('auto', !!auto);
    if (t) {
      const label = t.label;
      if (navLabel.textContent !== label) navLabel.textContent = label;
      navDist.textContent = `${Math.round(Math.hypot(P.x - t.x, P.z - t.z))} m${auto ? ' · Self driving' : ''}`;
      navArrow.style.transform = `rotate(${arrowAngle}rad)`;
    }
    if (driving) {
      const rot = P.h - Math.PI;
      drawMap(mini, { cx: P.x, cz: P.z, scale: 2.2, P, target: t, rot });
      const r = mini.clientWidth / 2 - 14;
      north.style.transform = `translate(${Math.sin(rot) * r}px, ${-Math.cos(rot) * r}px)`; // N stays on the rim, pointing north
    }
    if (menuOpen && !menu.querySelector('.tab[data-tab=places]').hidden) {
      drawMap(big, { cx: 10, cz: 15, scale: Math.min(big.clientWidth, big.clientHeight) / (LIMIT * 2 + 24), P, target: t, big: true });
    }
  }

  return {
    openPlace, openResume, openMenu, openAuto, close, toast, prompt, markFound, isFound, frame, toggleNight,
    blocking: () => sheetOpen || menuOpen,
  };
}
