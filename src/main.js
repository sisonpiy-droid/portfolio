import * as THREE from 'three';
import './style.css';
import { profile, projects, skills, places } from './content.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createWorld, LIMIT, PLAZA_R } from './world.js';
import { createUI } from './ui.js';
import { sfx } from './sfx.js';

const $ = (s) => document.querySelector(s);
const panel = $('#panel'), stage = $('#stage');
const { clamp, lerp } = THREE.MathUtils;
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrapPi = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

/* ---------- renderer & camera ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
stage.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(32, 1, 3, 900); // a nearer clip plane would cost depth precision and make the ground flicker

/* ---------- state ---------- */
const site = { profile, projects, skills };
const world = createWorld(places, { name: profile.name });
const stops = world.stops;
// reflections for the car paint, glass and water come from a small studio environment
world.setEnvironment(new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture);
// bloom makes lamps, headlights and boost flames glow; it is skipped entirely in plain daylight
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(world.scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// heading h: forward = (sin h, cos h); slide is how far the car's travel direction lags its heading while drifting
const P = { ...world.start, speed: 0, steer: 0, gas: 0, hop: 0, boost: 0, drift: 0, slide: 0 };
const B = { meter: 1, locked: false }; // boost tank: drains while Shift is held, refills when released
let driving = false, userTarget = null, active = null, chaseOn = false, overviewOn = false, auto = null;

function startDriving() { driving = true; document.body.classList.add('driving'); sfx.init(); }
const actions = {
  route(s) { userTarget = s; startDriving(); ui.toast(`Route set to ${s.label}`); },
  autoTo(dest) {
    const wps = world.route(P, dest);
    if (!wps.length) return;
    startDriving();
    auto = { dest, wps, i: 0 };
    if (dest.kind === 'stop') userTarget = dest.stop;
  },
  autoStop() { auto = null; },
  sound: (on) => setSound(on),
  rain: (on) => world.setRain(on),
  sfx: (on) => sfx.setEnabled(on),
  repair: () => { world.repairLamps(); ui.toast('Street lights repaired'); },
};
const ui = createUI({ site, world, actions });

/* ---------- engine sound (opt-in, so no autoplay surprise) ---------- */
let audio = null;
function setSound(on) {
  if (on && !audio) {
    const ctx = new AudioContext(), osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), gain = ctx.createGain();
    osc.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 380; gain.gain.value = 0;
    osc.connect(lp).connect(gain).connect(ctx.destination);
    osc.start();
    audio = { ctx, osc, gain, lp };
  }
  if (audio) { audio.on = on; audio.gain.gain.setTargetAtTime(on ? 0.035 : 0, audio.ctx.currentTime, 0.1); audio.ctx.resume(); }
}

/* ---------- input ---------- */
const keys = new Set();
const held = (...c) => c.some((k) => keys.has(k));
const toggleChase = () => { chaseOn = !chaseOn; $('#cambtn').classList.toggle('on', chaseOn); };
const toggleOverview = () => { overviewOn = !overviewOn; $('#ovhint').classList.toggle('show', overviewOn); };
$('#start').addEventListener('click', (e) => { startDriving(); e.currentTarget.blur(); });
$('#browse').addEventListener('click', (e) => { ui.openResume(); e.currentTarget.blur(); });
$('#prompt').addEventListener('click', () => active && ui.openPlace(active));
$('#navcard').addEventListener('click', (e) => { if (!e.target.closest('#autostop')) ui.openMenu('places'); });
$('#autostop').addEventListener('click', () => (auto = null));
$('#mapbtn').addEventListener('click', () => ui.openMenu('places'));
$('#menubtn').addEventListener('click', () => ui.openMenu('settings'));
$('#autobtn').addEventListener('click', () => ui.openAuto());
$('#cambtn').addEventListener('click', (e) => { toggleChase(); e.currentTarget.blur(); });

addEventListener('keydown', (e) => {
  sfx.init(); // the first key press is the gesture that lets the browser play sound
  if (e.target.closest?.('a, input, textarea')) return;
  if (e.code === 'KeyH' && !e.repeat) { sfx.horn(); world.honk(P); return; }
  if (e.code === 'KeyR' && !e.repeat && driving && !ui.blocking()) { // back on the road
    Object.assign(P, { x: world.start.x, z: world.start.z, h: world.start.h, speed: 0, slide: 0, drift: 0 });
    auto = null;
    ui.toast('Back on the road');
    return;
  }
  if (e.code === 'Escape') return void ui.close();
  if (e.code === 'KeyM') return void (ui.blocking() ? ui.close() : ui.openMenu('places'));
  if (e.code === 'KeyC' && !e.repeat) return void toggleChase();
  if (e.code === 'KeyO' && !e.repeat) return void toggleOverview();
  if (e.code === 'KeyN' && !e.repeat) return void ui.toggleNight();
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (ui.blocking()) return; // inside the menu or a card, Enter belongs to its buttons
    // in a place, Enter always opens it, even if a HUD button still has focus from a click
    if (driving && active) { e.preventDefault(); document.activeElement?.blur(); ui.openPlace(active); }
    else if (!driving && !e.target.closest?.('button')) startDriving();
    return;
  }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
for (const b of document.querySelectorAll('#pad button')) { // touch pad sends the same key codes
  const k = b.dataset.key;
  b.addEventListener('pointerdown', () => { if (!driving) startDriving(); keys.add(k); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => keys.delete(k));
}

/* ---------- driving ---------- */
let shake = 0, hitCool = 0;
function autopilot() { // aim at the next waypoint, slow down for bends and for the stop
  const last = auto.wps.length - 1;
  while (auto.i < last && Math.hypot(auto.wps[auto.i].x - P.x, auto.wps[auto.i].z - P.z) < 5) auto.i++;
  const w = auto.wps[auto.i], dx = w.x - P.x, dz = w.z - P.z, dist = Math.hypot(dx, dz);
  const err = wrapPi(Math.atan2(dx, dz) - P.h);
  let target = 9 - Math.min(5, Math.abs(err) * 5);
  if (auto.i === last) target = Math.min(target, 1.2 + dist * 0.8);
  if (auto.i === last && dist < (auto.dest.kind === 'park' ? 1 : 2)) { auto = null; return { gas: 0, steer: 0 }; }
  return { steer: clamp(err * 2.5, -1, 1), gas: P.speed < target - 0.5 ? 1 : P.speed > target + 1.5 ? -1 : 0 };
}
function drive(dt) {
  const on = driving && !ui.blocking();
  if (auto && held('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight', 'ShiftLeft', 'ShiftRight')) auto = null; // any input takes over
  const pilot = auto && on ? autopilot() : null;
  P.gas = pilot ? pilot.gas : on ? (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0) : 0;
  const steerIn = pilot ? pilot.steer : on ? (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0) : 0;
  P.steer += (steerIn - P.steer) * smooth(10, dt);

  // boost: Shift adds thrust and a higher top speed until the tank runs dry
  const wantBoost = on && held('ShiftLeft', 'ShiftRight') && !B.locked && P.speed > -1;
  if (wantBoost) { B.meter -= dt / 2.8; if (B.meter <= 0) { B.meter = 0; B.locked = true; } }
  else { B.meter = Math.min(1, B.meter + dt / 7); if (B.locked && B.meter > 0.25) B.locked = false; }
  P.boost += ((wantBoost ? 1 : 0) - P.boost) * smooth(8, dt);
  const vmax = 15 + 12 * P.boost;

  if (P.gas > 0 && P.speed >= vmax) { /* already at the limit */ }
  else if (P.gas) P.speed += P.gas * (Math.sign(P.speed) === -P.gas ? 36 : 16) * dt;
  else P.speed -= Math.sign(P.speed) * Math.min(Math.abs(P.speed), 12 * dt);
  if (wantBoost) P.speed += 30 * dt;
  if (P.speed > vmax) P.speed = vmax + (P.speed - vmax) * Math.exp(-2.5 * dt);
  P.speed = clamp(P.speed, -6, 28);

  // drift: hold Space while turning. The nose swings round faster than the car travels, so it slides sideways
  const wantDrift = on && !pilot && held('Space') && Math.abs(P.speed) > 5;
  P.drift += ((wantDrift ? 1 : 0) - P.drift) * smooth(9, dt);
  const slideTarget = -P.steer * 0.62 * P.drift * clamp(Math.abs(P.speed) / 14, 0, 1) * Math.sign(P.speed);
  P.slide += (slideTarget - P.slide) * smooth(wantDrift ? 7 : 10, dt);
  P.h += P.steer * 2 * (1 - 0.4 * clamp((Math.abs(P.speed) - 10) / 17, 0, 1)) * (1 + 0.8 * P.drift) * dt * clamp(P.speed / 6, -1, 1);
  P.speed -= P.speed * 0.3 * P.drift * dt; // sliding scrubs off some speed
  P.x += Math.sin(P.h + P.slide) * P.speed * dt;
  P.z += Math.cos(P.h + P.slide) * P.speed * dt;

  const push = (o) => {
    const dx = P.x - o.x, dz = P.z - o.z, d = Math.hypot(dx, dz), min = o.r + 1.1;
    if (d < min) {
      P.x = o.x + (dx / d) * min; P.z = o.z + (dz / d) * min;
      if (P.speed > 8) { shake = Math.max(shake, 0.5); if (!hitCool) { sfx.hit(); hitCool = 0.4; } }
      P.speed *= 0.85;
    }
  };
  world.obstacles.forEach(push);
  if (!auto) world.traffic.forEach(push); // self-driving minds the traffic, so it can pass through it
  const d = Math.hypot(P.x, P.z), edge = LIMIT - 1.6;
  if (d > edge) { P.x *= edge / d; P.z *= edge / d; P.speed *= 0.85; }
  if (audio?.on) {
    audio.osc.frequency.setTargetAtTime(48 + Math.abs(P.speed) * 9 + P.gas * 10, audio.ctx.currentTime, 0.08);
    audio.lp.frequency.setTargetAtTime(380 + P.boost * 900, audio.ctx.currentTime, 0.08);
  }
}

/* ---------- camera ---------- */
const focus = new THREE.Vector3(), origin = new THREE.Vector3(0, 0, 10), v = new THREE.Vector3();
const topPos = new THREE.Vector3(), chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3(), look = new THREE.Vector3();
let yaw = 0, intro = 1, speedZoom = 0, zoom = 1, offX = 0, offY = 0, wide = true, chase = 0, camH = P.h, ov = 0;
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  wide = innerWidth > 820;
  zoom = wide ? 1 : 1.45;
}
addEventListener('resize', resize);
const project = (x, y, z) => {
  v.set(x, y, z).project(camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, behind: v.z > 1 };
};

function updateCamera(dt) {
  if (!driving) yaw += dt * 0.1; // slow orbit on the intro screen
  else yaw += (Math.round(yaw / (Math.PI * 2)) * Math.PI * 2 - yaw) * smooth(2.5, dt);
  intro += ((driving ? 0 : 1) - intro) * smooth(2.2, dt);
  ov += ((overviewOn ? 1 : 0) - ov) * smooth(2.5, dt);
  speedZoom += (Math.min(1, Math.abs(P.speed) / 15) * 0.16 - speedZoom) * smooth(2, dt);
  focus.lerp(driving && !overviewOn ? v.set(P.x, 0, P.z) : origin, smooth(3, dt));
  const k = zoom * (1 + 0.95 * intro + speedZoom) * lerp(1, 2.3, ov);
  topPos.set(focus.x + Math.sin(yaw) * 36 * k, 56 * k, focus.z + Math.cos(yaw) * 36 * k); // tilted enough to see the sides of buildings

  // chase view: low and behind the car
  chase += ((driving && chaseOn && !overviewOn ? 1 : 0) - chase) * smooth(3, dt);
  const e = chase * chase * (3 - 2 * chase);
  camH += wrapPi(P.h - camH) * smooth(3.5, dt);
  const fx = Math.sin(camH), fz = Math.cos(camH), back = 12 + Math.max(0, P.speed) * 0.2;
  chasePos.set(P.x - fx * back, 5.4 + P.boost * 0.8, P.z - fz * back);
  chaseLook.set(P.x + fx * 8, 1.2, P.z + fz * 8);
  camera.position.lerpVectors(topPos, chasePos, e);
  look.lerpVectors(focus, chaseLook, e);

  shake = Math.max(shake * Math.exp(-5 * dt), P.boost * 0.22, P.drift * Math.abs(P.slide) * 0.3);
  if (shake > 0.01) camera.position.add(v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.9));
  camera.lookAt(look);
  camera.fov = lerp(36, 52, e) + 9 * P.boost;

  // while the intro panel is up, centre the world in the space beside it
  offX += ((wide && !driving ? panel.offsetWidth / 2 : 0) - offX) * smooth(4, dt);
  offY += ((!wide && !driving ? panel.offsetHeight / 2 : 0) - offY) * smooth(4, dt);
  camera.setViewOffset(innerWidth, innerHeight, -offX, -offY, innerWidth, innerHeight);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/* ---------- loop ---------- */
function nextTarget() {
  if (userTarget && !ui.isFound(userTarget)) return userTarget;
  userTarget = null;
  let best = null, bd = Infinity;
  for (const pass of [true, false]) { // unfound places first, then anything
    for (const s of stops) {
      const d = Math.hypot(P.x - s.x, P.z - s.z);
      if ((!pass || !ui.isFound(s)) && d < bd) { bd = d; best = s; }
    }
    if (best) return best;
  }
}

function tick(dt, now) {
  drive(dt);
  updateCamera(dt);
  active = driving ? stops.find((s) => Math.hypot(P.x - s.x, P.z - s.z) < PLAZA_R + 0.4) ?? null : null; // anywhere on the plaza counts
  if (active) ui.markFound(active);
  hitCool = Math.max(0, hitCool - dt);
  const ev = world.update(dt, now / 1000, P, active, focus);
  if (ev.broken) {
    shake = Math.max(shake, 0.9);
    sfx.lamp();
    const n = world.brokenLamps();
    ui.toast(n === 1 ? 'Oops — street light down!' : `Street lights down: ${n}`);
  }
  if (ev.cones) sfx.cone();
  sfx.drift(P.drift > 0.4 && Math.abs(P.slide) > 0.1 && Math.abs(P.speed) > 5 ? Math.min(1, Math.abs(P.slide) * 3) : 0); // tyres squeal while sliding
  sfx.boost(P.boost);

  const target = nextTarget();
  const a = project(P.x, 0, P.z), b = project(target.x, 0, target.z);
  let arrowAngle = Math.atan2(b.y - a.y, b.x - a.x);
  if (chase > 0.5) { // in the chase view the arrow is relative to the car's nose
    const dx = target.x - P.x, dz = target.z - P.z, ahead = dx * Math.sin(P.h) + dz * Math.cos(P.h), left = dx * Math.cos(P.h) - dz * Math.sin(P.h);
    arrowAngle = Math.atan2(-ahead, -left);
  }
  ui.frame({ P, target, active, driving, project, arrowAngle, boost: B.meter, boostLocked: B.locked, auto: auto?.dest ?? null });
  document.body.classList.toggle('tags-on', driving && !ui.blocking());
  document.body.classList.toggle('boosting', P.boost > 0.3);
  ui.prompt(driving && !ui.blocking() && active ? (matchMedia('(pointer: coarse)').matches ? `Tap to open ${active.label}` : `Press Enter to open ${active.label}`) : null);
  const glow = world.nightLevel() * 0.55 + P.boost * 0.4; // lamps glow at night, the car glows when boosting
  // only things brighter than the threshold glow: lamps and flames, not sunlit road paint
  bloom.threshold = lerp(lerp(1.7, 0.85, world.nightLevel()), 1.3, P.boost);
  if (glow > 0.03) { bloom.strength = glow; composer.render(); } else renderer.render(world.scene, camera);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  tick(dt, now);
  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);
