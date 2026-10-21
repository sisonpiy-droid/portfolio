// The portfolio must never depend on the 3D village. When it cannot run (no WebGL, a crash, a lost GPU
// context), this turns the intro panel into the whole page, with every button still working.
let shown = false;

// a lite version for anyone who wants it: add ?3d=off to the address
export const liteRequested = new URLSearchParams(location.search).get('3d') === 'off';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function noWorld(message) {
  if (shown) return;
  shown = true;
  document.body.classList.remove('driving');
  document.body.classList.add('no3d', 'ready');
  const note = document.querySelector('#loadtext');
  if (note) note.textContent = message;
}
