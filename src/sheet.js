// The content sheet: a place, a case study, or the whole CV. It has no 3D in it, so it works while the
// village is still loading, and when the village never loads (no WebGL, an error, a very old phone).
const $ = (s) => document.querySelector(s);
const sheet = $('#sheet');
let open = false, opener = null;

// Dim the page behind a modal and take it out of the tab order and the accessibility tree.
export function lockPage(on) {
  if (on && !document.body.classList.contains('modal')) opener = document.activeElement;
  document.body.classList.toggle('modal', on);
  for (const el of document.querySelectorAll('#panel, #hud, #pad, #auto')) el.inert = on;
  if (!on && opener) { opener.focus?.({ preventScroll: true }); opener = null; }
}

export const isSheetOpen = () => open;

export function openSheet(html, cls = '', anchor = '') {
  sheet.className = cls;
  sheet.innerHTML = `<button class="x" aria-label="Close">×</button>${html}`;
  const title = sheet.querySelector('h2');
  if (title) { title.id = 'sheet-title'; sheet.setAttribute('aria-labelledby', 'sheet-title'); }
  sheet.hidden = false;
  open = true;
  lockPage(true);
  const target = anchor && sheet.querySelector(`#${anchor}`);
  if (target) target.scrollIntoView({ block: 'start' }); else sheet.scrollTop = 0;
  sheet.querySelector('.x').focus({ preventScroll: true });
}

export function closeSheet() {
  if (!open) return false;
  sheet.hidden = true;
  open = false;
  lockPage(false);
  return true;
}

// What each button in the intro panel opens. Called once with the renderers from render.js.
export function initSheet(r) {
  const targets = {
    projects: () => openSheet(r.galleryHTML()),
    resume: () => openSheet(r.resumeHTML(), 'resume'),
    about: () => openSheet(r.resumeHTML(), 'resume', 'sec-about'),
    experience: () => openSheet(r.resumeHTML(), 'resume', 'sec-experience'),
    education: () => openSheet(r.resumeHTML(), 'resume', 'sec-education'),
    skills: () => openSheet(r.resumeHTML(), 'resume', 'sec-skills'),
    contact: () => openSheet(r.resumeHTML(), 'resume', 'sec-contact'),
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open]');
    if (btn) { targets[btn.dataset.open]?.(); return; }
    if (!open || !sheet.contains(e.target)) return;
    if (e.target.closest('.x')) return void closeSheet();
    if (e.target.closest('[data-print]')) return void print();
    const byId = (id) => r.ranked.find((p) => p.id === id);
    const pick = e.target.closest('[data-project]'), next = e.target.closest('[data-next]');
    if (pick) openSheet(r.projectHTML(byId(pick.dataset.project)));
    else if (next) { const i = r.ranked.findIndex((p) => p.id === next.dataset.next); openSheet(r.projectHTML(r.ranked[(i + 1) % r.ranked.length])); }
    else if (e.target.closest('[data-go]')) openSheet(r.galleryHTML());
  });
  // Escape works from anywhere, including while a link or button inside the sheet has focus
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closeSheet(); });
}
