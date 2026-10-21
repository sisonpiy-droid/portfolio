import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const LIMIT = 108, STOP_D = 40, PLAZA_R = 6.2, RB_R = 12, ROAD_W = 6.4;
const SW = 1.2; // sidewalk width

// a lower, warmer sun than before: long soft shadows and a darker fill light give the scene its depth
const DAY = { fog: 0xd5eafa, skyTop: 0x4f9be8, hemiSky: 0xdfeeff, hemiGround: 0x9fb27c, hemi: 0.95, sun: 0xffe6bf, sunI: 2.5, mount: 0x9fb8d4 };
const NIGHT = { fog: 0x14254a, skyTop: 0x040a1a, hemiSky: 0x8fa6d8, hemiGround: 0x1b2a4a, hemi: 0.6, sun: 0x9db4ff, sunI: 0.34, mount: 0x1b2a4c };
const RAIN = { fog: 0x9aa6b4, skyTop: 0x7d8997 };
const GREENS = [0x7cc46a, 0x6ab85c, 0x8fd073];
const PETALS = [0xff7aa8, 0xffd24a, 0xffffff, 0xff8f4a, 0xb48cff];
const SHIRTS = [0xe85d4a, 0x2f66d6, 0xf5c542, 0x3fae7a, 0xb48cff, 0xffffff];
const GRASS = 0x84c25e, ASPHALT = 0x4e5666, WALKWAY = 0xd5d8df, ROAD_Y = 0.08, WALK_Y = 0.06, PLAZA_Y = 0.14;
const wrapAngle = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

const mats = new Map();
const lambert = (c) => mats.get(c) ?? (mats.set(c, new THREE.MeshLambertMaterial({ color: c, flatShading: true })), mats.get(c));
const glass = new THREE.MeshLambertMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.5 });
const dummy = new THREE.Object3D();
const lerp = THREE.MathUtils.lerp;
const V = (x, z) => new THREE.Vector3(x, 0, z);
const distSeg = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
};

export function createWorld(places, opts = {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(DAY.fog, 160, 420);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xbfd6ee, 1.7);
  const sun = new THREE.DirectionalLight(0xfff3dc, 1.6);
  const SUN_OFF = new THREE.Vector3(-44, 44, 40);
  // the sun's own axes, used to keep the moving shadow map locked to its texel grid
  const sunF = SUN_OFF.clone().negate().normalize();
  const sunR = new THREE.Vector3().crossVectors(sunF, new THREE.Vector3(0, 1, 0)).normalize();
  const sunU = new THREE.Vector3().crossVectors(sunR, sunF).normalize();
  sun.castShadow = true;
  const SHADOW = opts.shadowSize ?? 2048;
  sun.shadow.mapSize.set(SHADOW, SHADOW);
  Object.assign(sun.shadow.camera, { left: -52, right: 52, top: 52, bottom: -52, near: 1, far: 170 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target);

  const add = (geo, mat, x = 0, y = 0, z = 0, parent = scene, shadow = true) => {
    const m = new THREE.Mesh(geo, typeof mat === 'number' ? lambert(mat) : mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w, h, d, c, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), c, x, y, z, parent);
  const flat = (geo, c, y, x = 0, z = 0) => {
    const m = add(geo, c, x, y, z, scene, false);
    m.rotation.x = -Math.PI / 2;
    return m;
  };

  // canvas textures (redrawn once the web font is ready)
  const redraws = [];
  function tex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const go = () => { const g = c.getContext('2d'); g.clearRect(0, 0, w, h); draw(g, w, h); t.needsUpdate = true; };
    go();
    redraws.push(go);
    return t;
  }
  document.fonts?.load('800 48px Manrope').then(() => redraws.forEach((f) => f()));

  const shiny = new Set(); // materials that reflect the environment (car, glass, chrome, water); the plain ones stay as lit
  const shapes = { roads: [], discs: [], rects: [], water: [], rails: [] };
  const obstacles = []; // static circles the car cannot enter
  const blocked = [];   // keep-out zones for scattering (circles and segments)
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  /* ---------- sky, sun, moon, stars, mountains ---------- */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 bot; varying float h;',
      'void main() {',
      '  gl_FragColor = vec4(mix(bot, top, smoothstep(0.0, 0.5, h)), 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMat);
  sky.renderOrder = -2;
  scene.add(sky);
  const sunDir = SUN_OFF.clone().normalize();
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1b8, fog: false }));
  sunDisc.position.copy(sunDir).multiplyScalar(520);
  const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8efff, fog: false }));
  moonDisc.position.set(sunDir.x * -520, sunDir.y * 520, sunDir.z * -520);
  scene.add(sunDisc, moonDisc);
  const starPos = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    const a = rnd() * Math.PI * 2, e = 0.08 + rnd() * 1.4;
    starPos.set([Math.cos(a) * Math.cos(e) * 560, Math.sin(e) * 560, Math.sin(a) * Math.cos(e) * 560], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  scene.add(new THREE.Points(starGeo, starMat));
  const mountMat = new THREE.MeshLambertMaterial({ color: DAY.mount, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2, d = 300 + rnd() * 70, h = 40 + rnd() * 70;
    const m = new THREE.Mesh(new THREE.ConeGeometry(36 + rnd() * 36, h, 5), mountMat);
    m.position.set(Math.cos(a) * d, h / 2 - 3, Math.sin(a) * d);
    m.rotation.y = rnd() * 3;
    scene.add(m);
  }

  /* ---------- meadow ---------- */
  const grassTex = (() => { // the variation is painted once into the ground texture: nothing overlaps, so nothing can z-fight
    const S = 1024, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#84c25e';
    g.fillRect(0, 0, S, S);
    const px = (u) => (u / 880) * S; // world units -> pixels (the ground spans -440..440)
    for (let i = 0; i < 420; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 170, r = px(6 + rnd() * 18);
      const x = S / 2 + px(Math.cos(a) * d), y = S / 2 + px(Math.sin(a) * d);
      const col = ['116,179,80', '147,207,107', '125,187,88', '106,168,74'][(rnd() * 4) | 0];
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${col},.55)`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const noiseTex = (size, base, spread, count, repeat, color = true) => { // small speckle texture for surface grain
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < count; i++) {
      const v = Math.random() * 2 - 1;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v * spread})` : `rgba(0,0,0,${-v * spread})`;
      g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.repeat.set(repeat, repeat);
    return t;
  };
  flat(new THREE.CircleGeometry(440, 64), new THREE.MeshLambertMaterial({ map: grassTex, bumpMap: noiseTex(128, '#808080', 0.6, 1800, 120, false), bumpScale: 2.2 }), 0).receiveShadow = true;
  const asphaltMat = new THREE.MeshLambertMaterial({ map: noiseTex(256, '#4e5666', 0.2, 3600, 1) });

  // roof tiles and solar cells are painted textures, so the buildings read as buildings rather than boxes
  const roofTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e8e8e8' : '#ffffff'; g.fillRect(0, i * 8, 64, 8); g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, i * 8 + 7, 64, 1); }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect((i * 13) % 64, (i * 7) % 64, 3, 6); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(3, 4);
    return t;
  })();
  const facadeTex = (() => { // a wall with two framed windows; the wall colour is tinted per building
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < 128; y += 8) g.fillRect(0, y, 128, 1);
    for (const x of [18, 78]) {
      g.fillStyle = '#6f9a74'; g.fillRect(x - 14, 26, 10, 56); g.fillRect(x + 36, 26, 10, 56); // shutters
      g.fillStyle = 'rgba(0,0,0,.16)'; for (let y = 30; y < 80; y += 6) { g.fillRect(x - 14, y, 10, 1); g.fillRect(x + 36, y, 10, 1); }
      g.fillStyle = '#eef1f5'; g.fillRect(x - 4, 26, 40, 56); // frame
      const gl = g.createLinearGradient(0, 30, 0, 78); gl.addColorStop(0, '#a9cdee'); gl.addColorStop(1, '#5f8fbd');
      g.fillStyle = gl; g.fillRect(x, 30, 32, 48);
      g.fillStyle = '#eef1f5'; g.fillRect(x + 15, 30, 2, 48); g.fillRect(x, 52, 32, 2); // mullions
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - 6, 82, 44, 4); // sill
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const wallMats = new Map();
  const wallMat = (c) => wallMats.get(c) ?? (wallMats.set(c, new THREE.MeshLambertMaterial({ color: c, map: facadeTex, flatShading: true })), wallMats.get(c));
  const windowed = (w, h, d, color, y, parent, plainFront = false) => { // a box whose side walls have windows
    const wm = wallMat(color), pl = lambert(color);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wm, wm, pl, pl, wm, plainFront ? pl : wm]);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const roofMats = new Map();
  const roofMat = (c) => roofMats.get(c) ?? (roofMats.set(c, new THREE.MeshLambertMaterial({ color: c, map: roofTex, flatShading: true })), roofMats.get(c));
  const panelMat = new THREE.MeshStandardMaterial({
    metalness: 0.1, roughness: 0.35,
    map: (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#17336f'; g.fillRect(0, 0, 64, 128);
      g.strokeStyle = 'rgba(160,195,255,.55)'; g.lineWidth = 1.5;
      for (let x = 0; x <= 64; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
      for (let y = 0; y <= 128; y += 21.3) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
  });
  const hillMat = lambert(GRASS);
  for (let i = 0; i < 9; i++) { // low rolling hills on the horizon side
    const a = (i / 9) * Math.PI * 2 + rnd(), d = 135 + rnd() * 70, r = 28 + rnd() * 24;
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10), hillMat);
    h.scale.y = 0.2;
    h.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    h.receiveShadow = true;
    scene.add(h);
  }

  /* ---------- curves, ribbons, roads ---------- */
  function sampleCurve(pts, step = 2) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, z)), false, 'centripetal');
    const len = curve.getLength(), N = Math.max(2, Math.ceil(len / step)), s = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      s.push({ p, tan, n: new THREE.Vector3(-tan.z, 0, tan.x), d: t * len });
    }
    return { curve, len, s };
  }
  const at = (S, d) => S.s[Math.min(S.s.length - 1, Math.max(0, Math.round((d / S.len) * (S.s.length - 1))))];
  const yawOf = (q) => Math.atan2(q.tan.x, q.tan.z);
  function strip(S, off, width, y, material, uvScale = 8, from = 0, to = Infinity) {
    const list = S.s.filter((q) => q.d >= from && q.d <= to);
    const pos = [], nor = [], uv = [], idx = [];
    list.forEach((q, i) => {
      const cx = q.p.x + q.n.x * off, cz = q.p.z + q.n.z * off, hw = width / 2;
      pos.push(cx + q.n.x * hw, y, cz + q.n.z * hw, cx - q.n.x * hw, y, cz - q.n.z * hw);
      nor.push(0, 1, 0, 0, 1, 0);
      uv.push(q.d / uvScale, 0, q.d / uvScale, 1);
      if (i < list.length - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, typeof material === 'number' ? lambert(material) : material);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  // raised sidewalks with a real kerb face give the roads their depth
  const CURB_Y = 0.17, curbMat = new THREE.MeshLambertMaterial({ color: 0xc2c6ce, side: THREE.DoubleSide, flatShading: true });
  function wall(S, off, y0, y1, side, face, from = 0, to = Infinity) {
    const list = S.s.filter((q) => q.d >= from && q.d <= to), pos = [], nor = [], idx = [];
    list.forEach((q, i) => {
      const x = q.p.x + q.n.x * off, z = q.p.z + q.n.z * off;
      pos.push(x, y0, z, x, y1, z);
      nor.push(q.n.x * side * face, 0, q.n.z * side * face, q.n.x * side * face, 0, q.n.z * side * face);
      if (i < list.length - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, curbMat);
    m.receiveShadow = true;
    scene.add(m);
  }
  function sidewalks(S, w, from, to) {
    for (const e of [-1, 1]) {
      strip(S, e * (w / 2 + SW / 2), SW, CURB_Y, WALKWAY, 8, from, to);
      wall(S, e * (w / 2), ROAD_Y, CURB_Y, e, -1, from, to); // kerb facing the road
      wall(S, e * (w / 2 + SW), 0, CURB_Y, e, 1, from, to); // outer edge
    }
  }
  const keepOut = (S, r, every = 3) => {
    for (let i = 0; i < S.s.length - every; i += every) blocked.push({ ax: S.s[i].p.x, az: S.s[i].p.z, bx: S.s[i + every].p.x, bz: S.s[i + every].p.z, r });
  };
  const mapLine = (S, w) => shapes.roads.push({ pts: S.s.filter((_, i) => i % 4 === 0 || i === S.s.length - 1).map((q) => [q.p.x, q.p.z]), w });

  const dashes = [], zebraW = [], zebraY = [], giveWays = [], arms = [];
  function road(pts, { w = ROAD_W, kind, ang, zebra = true, dashFrom = 12, dashTo, walks = true } = {}) {
    const S = sampleCurve(pts);
    if (walks) sidewalks(S, w, 2.2, Infinity);
    strip(S, 0, w, ROAD_Y, asphaltMat);
    for (const e of [-1, 1]) strip(S, e * (w / 2 - 0.3), 0.12, ROAD_Y + 0.008, 0xffffff);
    for (let d = dashFrom; d < (dashTo ?? S.len - 4); d += 3.2) { const q = at(S, d); dashes.push({ x: q.p.x, z: q.p.z, yaw: yawOf(q) }); }
    if (zebra) for (let k = -2; k <= 2; k++) { const q = at(S, 5.5); (kind === 'entrance' ? zebraY : zebraW).push({ x: q.p.x + q.n.x * k * 1.05, z: q.p.z + q.n.z * k * 1.05, yaw: yawOf(q) }); }
    if (zebra) { const q = at(S, 9); giveWays.push({ x: q.p.x - q.n.x * 1.6, z: q.p.z - q.n.z * 1.6, yaw: yawOf(q) }); }
    keepOut(S, w / 2 + SW + 1);
    mapLine(S, w);
    const arm = { S, kind, ang, w };
    arms.push(arm);
    return arm;
  }
  const instanced = (geo, list, color) => {
    const im = new THREE.InstancedMesh(geo, lambert(color), list.length);
    list.forEach((p, i) => { dummy.position.set(p.x, ROAD_Y + 0.012, p.z); dummy.rotation.set(0, p.yaw, 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.receiveShadow = true;
    scene.add(im);
  };

  const n = places.length;
  const stops = places.map((p, i) => {
    // the places fan out round the north side, clear of the entrance and east roads
    const spread = Math.min(210, 50 * (n - 1)), a = ((250 + (n > 1 ? (i - (n - 1) / 2) * (spread / (n - 1)) : 0)) * Math.PI) / 180;
    return { ...p, i, a, c: Math.cos(a), s: Math.sin(a), yaw: Math.PI / 2 - a, x: Math.cos(a) * STOP_D, z: Math.sin(a) * STOP_D };
  });

  // roundabout in the middle, a fan of roads to the places, the entrance road from the south and a road east over the river
  add(new THREE.CylinderGeometry(RB_R + SW, RB_R + SW, WALK_Y, 56), WALKWAY, 0, WALK_Y / 2, 0, scene, false);
  add(new THREE.CylinderGeometry(RB_R, RB_R, ROAD_Y, 56), ASPHALT, 0, ROAD_Y / 2, 0, scene, false);
  for (const r of [RB_R - 0.3, 6.9]) flat(new THREE.RingGeometry(r - 0.06, r + 0.06, 64), 0xffffff, ROAD_Y + 0.008);
  shapes.discs.push({ x: 0, z: 0, r: RB_R, color: '#fff' });
  for (const s of stops) road([[s.c * (RB_R - 1), s.s * (RB_R - 1)], [s.x, s.z]], { kind: 'spoke', ang: s.a, dashTo: STOP_D - RB_R - 10 });
  const entrance = road([[0, RB_R - 1], [0, 36], [5, 58], [5, 84], [-3, 106], [-3, 150]], { kind: 'entrance', ang: Math.PI / 2 });
  const east = road([[11.5, 7], [30, 16], [52, 12], [75, 16], [86, 18]], { kind: 'east', ang: Math.atan2(7, 11.5), dashTo: 70, walks: false });
  blocked.push({ cx: 0, cz: 0, r: 16 });

  instanced(new THREE.BoxGeometry(0.22, 0.02, 1.5), dashes, 0xffffff);
  instanced(new THREE.BoxGeometry(0.55, 0.02, 3), zebraW, 0xffffff);
  instanced(new THREE.BoxGeometry(0.55, 0.02, 3), zebraY, 0xf2c230);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.8, 0, 1.1, 0.8, 0, 1.1, 0, 0, -1.1], 3));
  tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  instanced(tri, giveWays, 0xffffff);

  // a short branch off the entrance road into the car park
  const park = { x: -28, z: 48, w: 26, d: 16 };
  const branch = road([[2.5, 44], [-6, 44.5], [-15, 46]], { w: 6, zebra: false, dashFrom: 99 });
  box(park.w, 0.07, park.d, 0x586072, park.x, 0.035, park.z, scene).castShadow = false;
  shapes.rects.push({ x: park.x, z: park.z, w: park.w, d: park.d, yaw: 0, color: '#e3e8f1' });
  blocked.push({ ax: park.x - park.w / 2 - 2, az: park.z, bx: park.x + park.w / 2 + 2, bz: park.z, r: park.d / 2 + 3 });
  const bayLines = [];
  for (let k = 0; k <= 10; k++) for (const z of [43.4, 52.6]) bayLines.push({ x: -40.2 + k * 2.4, z, yaw: 0 });
  instanced(new THREE.BoxGeometry(0.1, 0.02, 4.6), bayLines, 0xffffff);

  /* ---------- river, banks, bridge ---------- */
  const waterTex = tex(256, 128, (g, w, h) => {
    g.fillStyle = '#3aa6e6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.2})`; g.lineWidth = 2; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.quadraticCurveTo(x + 14, y + 4, x + 30, y); g.stroke(); }
    g.fillStyle = 'rgba(20,90,170,.25)'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14);
  });
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  const waterMat = new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.16, metalness: 0 });
  shiny.add(waterMat);
  const RIVER_W = 12;
  const river = sampleCurve([[80, -170], [68, -95], [72, -45], [62, -8], [63, 30], [76, 75], [72, 170]], 3);
  strip(river, 0, RIVER_W + 4.4, 0.03, 0xe8dcb8);
  strip(river, 0, RIVER_W, 0.05, waterMat, 14);
  shapes.water.push({ pts: river.s.filter((_, i) => i % 5 === 0).map((q) => [q.p.x, q.p.z]), w: RIVER_W });
  keepOut(river, RIVER_W / 2 + 4, 2);

  // the bridge sits where the east road is closest to the river
  let bridgeAt = east.S.s[0];
  let best = Infinity;
  for (const q of east.S.s) for (const r of river.s) { const d = Math.hypot(q.p.x - r.p.x, q.p.z - r.p.z); if (d < best) { best = d; bridgeAt = q; } }
  const bc = bridgeAt.p, byaw = yawOf(bridgeAt), BL = 20;
  strip(east.S, 0, east.w + 1.6, 0.1, 0xb9bfc9, 8, bridgeAt.d - BL / 2, bridgeAt.d + BL / 2);
  strip(east.S, 0, east.w, 0.115, ASPHALT, 8, bridgeAt.d - BL / 2, bridgeAt.d + BL / 2);
  for (const side of [-1, 1]) for (let d = -BL / 2; d <= BL / 2; d += 2.5) {
    const q = at(east.S, bridgeAt.d + d), px = q.p.x + q.n.x * side * (east.w / 2 + 0.7), pz = q.p.z + q.n.z * side * (east.w / 2 + 0.7);
    box(0.5, 0.9, 2.6, 0xd7dbe3, px, 0.5, pz, scene).rotation.y = yawOf(q);
    obstacles.push({ x: px, z: pz, r: 0.9 });
  }
  for (const d of [-6, 0, 6]) { const q = at(east.S, bridgeAt.d + d); for (const side of [-1, 1]) box(0.8, 1.2, 0.8, 0x8a8f9a, q.p.x + q.n.x * side * 3.2, -0.3, q.p.z + q.n.z * side * 3.2, scene); }
  for (let i = 0; i < river.s.length; i += 2) { // the river itself is a wall of circles, except under the bridge
    const q = river.s[i];
    if (Math.hypot(q.p.x - bc.x, q.p.z - bc.z) > 13) obstacles.push({ x: q.p.x, z: q.p.z, r: RIVER_W / 2 + 0.3 });
  }
  sidewalks(east.S, east.w, 2.2, bridgeAt.d - BL / 2 - 1); // the east road has sidewalks either side of the bridge
  sidewalks(east.S, east.w, bridgeAt.d + BL / 2 + 1, Infinity);
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  for (const e of [-1, 1]) strip(river, e * (RIVER_W / 2 - 0.3), 0.6, 0.058, foamMat, 8); // white foam along both banks

  /* ---------- railway & train ---------- */
  const rail = sampleCurve([[102, -170], [94, -80], [92, 0], [94, 70], [102, 170]], 2);
  strip(rail, 0, 3.8, 0.04, 0x9d9da6);
  for (const o of [-0.72, 0.72]) strip(rail, o, 0.14, 0.13, 0x4a4f58);
  const sleepers = [];
  for (let d = 0; d < rail.len; d += 1.2) { const q = at(rail, d); sleepers.push({ x: q.p.x, z: q.p.z, yaw: yawOf(q) }); }
  const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.08, 0.3), lambert(0x6f5a46), sleepers.length);
  sleepers.forEach((s, i) => { dummy.position.set(s.x, 0.07, s.z); dummy.rotation.set(0, s.yaw, 0); dummy.updateMatrix(); sl.setMatrixAt(i, dummy.matrix); });
  scene.add(sl);
  shapes.rails.push({ pts: rail.s.filter((_, i) => i % 5 === 0).map((q) => [q.p.x, q.p.z]) });
  keepOut(rail, 5, 2);
  const train = [0xd9453a, 0xe9edf4, 0xe9edf4, 0xe9edf4].map((c, i) => {
    const g = new THREE.Group();
    box(2.6, 2.6, i ? 9 : 8, c, 0, 1.9, 0, g);
    box(2.64, 0.5, i ? 9.04 : 8.04, 0x2f66d6, 0, 1.2, 0, g);
    box(2.66, 0.9, i ? 8 : 5, 0x23324d, 0, 2.3, i ? 0 : -1, g);
    for (const x of [-0.9, 0.9]) for (const z of [-3, 3]) box(0.3, 0.6, 1.4, 0x1b2438, x, 0.5, z, g);
    scene.add(g);
    return g;
  });
  let trainU = 0.2;

  /* ---------- fountain roundabout ---------- */
  add(new THREE.CylinderGeometry(6.6, 6.8, 0.45, 48), 0xe9e4d8, 0, 0.225, 0);
  add(new THREE.CylinderGeometry(6.2, 6.2, 0.5, 48), 0x7fbf5a, 0, 0.25, 0);
  add(new THREE.CylinderGeometry(3.4, 3.6, 0.8, 32), 0xe9e4d8, 0, 0.5, 0);
  flat(new THREE.CircleGeometry(3.1, 32), new THREE.MeshLambertMaterial({ color: 0x66b6ee }), 0.88);
  add(new THREE.CylinderGeometry(0.3, 0.45, 1.5, 10), 0xe9e4d8, 0, 1.5, 0);
  add(new THREE.SphereGeometry(0.5, 12, 8), 0xe9e4d8, 0, 2.3, 0);
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; add(new THREE.IcosahedronGeometry(0.35, 0), PETALS[k % 5], Math.cos(a) * 5, 0.7, Math.sin(a) * 5, scene, false); }
  obstacles.push({ x: 0, z: 0, r: 6.8 });
  shapes.discs.push({ x: 0, z: 0, r: 6.6, color: '#bfe3a6' });
  const DROPS = 90, T = 1.15, drops = [];
  for (let i = 0; i < DROPS; i++) drops.push({ ph: rnd(), ang: rnd() * Math.PI * 2, r: 0.6 + rnd() * 2 });
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3));
  scene.add(new THREE.Points(dropGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.85 })));

  /* ---------- places ---------- */
  const signTex = (label, sub) => tex(512, 128, (g, w, h) => {
    g.fillStyle = '#fff'; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 26); g.fill();
    g.strokeStyle = '#2f66d6'; g.lineWidth = 6; g.stroke();
    g.textAlign = 'center'; g.fillStyle = '#1b3263'; g.font = '800 54px Manrope, system-ui, sans-serif';
    g.fillText(label, w / 2, sub ? 72 : 82);
    if (sub) { g.fillStyle = '#6b7fa6'; g.font = '700 24px Manrope, system-ui, sans-serif'; g.fillText(sub.toUpperCase(), w / 2, 106); }
  });
  const sign = (g, label, sub, y, z, w = 5.2) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTex(label, sub), transparent: true }));
    m.position.set(0, y, z);
    m.rotation.y = Math.PI; // faces the roundabout
    g.add(m);
  };
  const BUILDERS = [
    (g, p) => { // headquarters
      windowed(9, 4.6, 6.4, 0xf7f9fc, 2.3, g, true); box(9.3, 0.7, 6.7, 0x2f66d6, 0, 4.65, 0, g);
      box(2.6, 0.14, 1.3, 0x2b3550, 0, 2.5, -3.9, g); for (const x of [-1.2, 1.2]) box(0.1, 2.4, 0.1, 0x2b3550, x, 1.3, -4.4, g); // entrance canopy
      box(6.2, 2.4, 0.14, 0x8ec5f2, 0, 1.4, -3.22, g); box(1.4, 2, 0.16, 0x2f66d6, 0, 1, -3.28, g);
      box(2, 0.9, 2, 0xcfd8e6, 2.5, 5.45, 1, g);
      sign(g, p.label, p.sub, 3.55, -3.26);
    },
    (g, p) => { // glass gallery
      box(10, 0.3, 7, 0xddd5c6, 0, 0.15, 0, g);
      for (const [x, z] of [[-4.6, -3.1], [4.6, -3.1], [-4.6, 3.1], [4.6, 3.1]]) box(0.4, 3.4, 0.4, 0x8a6a48, x, 2, z, g);
      box(11, 0.5, 7.8, 0x6bb05a, 0, 3.95, 0, g);
      for (const [w, d, x, z] of [[9.2, 0.1, 0, 3.2], [0.1, 6.2, -4.6, 0], [0.1, 6.2, 4.6, 0]]) add(new THREE.BoxGeometry(w, 3.2, d), glass, x, 1.9, z, g, false);
      [0xff7aa8, 0xffd24a, 0x6aa8ff, 0x7be0a8].forEach((c, k) => box(1.4, 1.8, 0.08, c, -3.6 + k * 2.4, 1.9, 2.95, g));
      sign(g, p.label, p.sub, 3.2, -3.5);
    },
    (g, p) => { // studio with solar roof
      windowed(9, 4, 6, 0xf1e4cb, 2, g, true); box(9.4, 0.5, 6.4, 0x6bb05a, 0, 4.25, 0, g);
      for (const [w, d, x, z] of [[9.8, 0.3, 0, -3.35], [9.8, 0.3, 0, 3.35], [0.3, 6.7, -4.9, 0], [0.3, 6.7, 4.9, 0]]) box(w, 0.42, d, 0xffffff, x, 4.3, z, g); // white roof edge
      for (const x of [-2.9, 0, 2.9]) for (const z of [-1.1, 1.3]) { const s = box(2.4, 0.1, 1.7, panelMat, x, 4.95, z, g); s.rotation.x = -0.35; }
      for (const x of [-3, 3]) box(1.6, 1.4, 0.12, 0x8ec5f2, x, 1.8, -3.05, g);
      box(1.4, 2, 0.16, 0xd9654f, 0, 1, -3.06, g);
      sign(g, p.label, p.sub, 3.5, -3.1);
    },
    (g, p) => { // round pavilion
      add(new THREE.CylinderGeometry(3.8, 3.8, 3.4, 20), 0xf7e4d0, 0, 1.7, 0, g);
      add(new THREE.ConeGeometry(4.8, 2.2, 20), roofMat(0xd9654f), 0, 4.5, 0, g);
      add(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), 0xb7c8e4, 0, 6.8, 0, g);
      box(0.9, 0.5, 0.05, 0x2f66d6, 0.45, 7.7, 0, g);
      box(1.4, 2, 0.16, 0x2f66d6, 0, 1, -3.78, g);
      sign(g, p.label, p.sub, 3.2, -3.9);
    },
  ];

  // soft dark blobs under buildings, plazas, trees and cars: a cheap stand-in for ambient occlusion that grounds everything
  const blobTex = tex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(10,22,8,.9)'); gr.addColorStop(0.55, 'rgba(10,22,8,.42)'); gr.addColorStop(1, 'rgba(10,22,8,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  function aoBlob(x, z, w, d, yaw, opacity = 0.5, y = 0.018) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false }));
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, yaw, 0);
    m.position.set(x, y, z);
    scene.add(m);
  }
  const cobble = tex(512, 512, (g, w) => { // cobblestones laid in rings
    const c = w / 2;
    g.fillStyle = '#d9d0bd'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    for (let r = 20; r < c; r += 22) {
      const stones = Math.max(6, Math.round((Math.PI * 2 * r) / 24));
      for (let k = 0; k < stones; k++) {
        const a0 = (k / stones) * Math.PI * 2, a1 = ((k + 1) / stones) * Math.PI * 2, shade = 196 + Math.random() * 40;
        g.fillStyle = `rgb(${shade},${shade - 6},${shade - 22})`;
        g.beginPath(); g.arc(c, c, r + 10, a0 + 0.012, a1 - 0.012); g.arc(c, c, r - 10, a1 - 0.012, a0 + 0.012, true); g.closePath(); g.fill();
      }
    }
  });
  const plazaLabel = (label) => tex(512, 512, (g, w) => {
    g.textAlign = 'center'; g.fillStyle = 'rgba(27,50,99,.6)'; g.font = '800 58px Manrope, system-ui, sans-serif';
    g.fillText(label, w / 2, 410);
    g.fillRect(w / 2 - 22, 432, 44, 6);
  });
  for (const s of stops) {
    const g = new THREE.Group();
    const bx = s.c * (STOP_D + 13), bz = s.s * (STOP_D + 13);
    g.position.set(bx, 0, bz);
    g.rotation.y = s.yaw;
    // headquarters for About, the glass gallery for Projects, the solar studio for Skills, the pavilion for Contact
    BUILDERS[{ about: 0, projects: 1, skills: 2, contact: 3 }[s.kind]](g, s);
    scene.add(g);
    for (const k of [-1, 1]) obstacles.push({ x: bx - s.s * 2.6 * k, z: bz + s.c * 2.6 * k, r: 3.7 });
    shapes.rects.push({ x: bx, z: bz, w: 9, d: 6.4, yaw: s.yaw, color: '#d6cdb8' });
    blocked.push({ cx: bx, cz: bz, r: 8 }, { cx: s.x, cz: s.z, r: PLAZA_R + 3 });

    // the plaza stands a step above the road: a stone rim, cobbles, and the painted blue ring and name
    add(new THREE.CylinderGeometry(PLAZA_R + 0.35, PLAZA_R + 0.4, PLAZA_Y - 0.02, 48), 0xe6dcc8, s.x, (PLAZA_Y - 0.02) / 2, s.z, scene, false);
    add(new THREE.CylinderGeometry(PLAZA_R, PLAZA_R, PLAZA_Y, 48), new THREE.MeshLambertMaterial({ map: cobble }), s.x, PLAZA_Y / 2, s.z, scene, false);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(PLAZA_R * 2, PLAZA_R * 2), new THREE.MeshBasicMaterial({ map: plazaLabel(s.label), transparent: true }));
    label.rotation.x = -Math.PI / 2; label.position.set(s.x, PLAZA_Y + 0.012, s.z); scene.add(label);
    s.ring = flat(new THREE.RingGeometry(PLAZA_R - 1.15, PLAZA_R - 0.4, 56), new THREE.MeshBasicMaterial({ color: 0x2f66d6 }), PLAZA_Y + 0.02, s.x, s.z);
    aoBlob(s.x, s.z, PLAZA_R * 2.5, PLAZA_R * 2.5, 0, 0.3);
    // planters beside the building, a picnic table and parasol on the grass
    for (const px of [-2.8, 2.8]) { box(1.5, 0.5, 0.6, 0xb6845a, px, 0.25, -4.3, g); add(new THREE.IcosahedronGeometry(0.55, 1), GREENS[(px > 0 ? 1 : 0)], px, 0.8, -4.3, g); }
    aoBlob(bx, bz, 13, 10, s.yaw, 0.4);
    {
      const tx2 = -s.s, tz2 = s.c, pic = new THREE.Group();
      pic.position.set(s.x + tx2 * 11 - s.c * 2, 0, s.z + tz2 * 11 - s.s * 2);
      pic.rotation.y = s.yaw;
      box(1.8, 0.08, 0.9, 0x9a7448, 0, 0.78, 0, pic);
      for (const z of [-0.8, 0.8]) box(1.8, 0.08, 0.35, 0x9a7448, 0, 0.48, z, pic);
      for (const x of [-0.7, 0.7]) box(0.08, 0.78, 0.7, 0x56607a, x, 0.39, 0, pic);
      box(0.06, 2.3, 0.06, 0xdfe6f2, 0, 1.15, 0, pic);
      add(new THREE.ConeGeometry(1.5, 0.55, 8), [0xe85d4a, 0xf5c542, 0x3fae7a, 0x4b78c9][s.i % 4], 0, 2.4, 0, pic);
      scene.add(pic);
      obstacles.push({ x: pic.position.x, z: pic.position.z, r: 1.3 });
      blocked.push({ cx: pic.position.x, cz: pic.position.z, r: 3 });
    }
    s.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 15, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x2f66d6, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    s.beacon.position.set(s.x, 7.5, s.z);
    scene.add(s.beacon);
    shapes.discs.push({ x: s.x, z: s.z, r: PLAZA_R, color: '#fff' });
    for (const k of [-1, 1]) { // a bench either side of each plaza, facing the road
      const yaw = Math.atan2(s.s * k, -s.c * k), tx = -s.s * k, tz = s.c * k;
      const bench = new THREE.Group();
      bench.position.set(s.x + tx * 9, 0, s.z + tz * 9);
      bench.rotation.y = yaw;
      box(2, 0.12, 0.6, 0x9a7448, 0, 0.5, 0, bench); box(2, 0.5, 0.1, 0x9a7448, 0, 0.9, -0.28, bench);
      box(0.12, 0.5, 0.5, 0x56607a, -0.8, 0.25, 0, bench); box(0.12, 0.5, 0.5, 0x56607a, 0.8, 0.25, 0, bench);
      scene.add(bench);
    }
  }


  /* ---------- pond, dock, boat ---------- */
  const POND = { x: 38, z: 40, r: 9 };
  obstacles.push({ ...POND, r: 8.3 });
  blocked.push({ cx: POND.x, cz: POND.z, r: POND.r + 4 });
  shapes.water.push({ x: POND.x, z: POND.z, r: POND.r });
  flat(new THREE.CircleGeometry(POND.r + 1.2, 40), 0xe8dcb8, 0.02, POND.x, POND.z);
  const pondTex = tex(256, 256, (g, w) => { // turquoise at the shallow edge, deeper blue in the middle
    const gr = g.createRadialGradient(w / 2, w / 2, w * 0.08, w / 2, w / 2, w / 2);
    gr.addColorStop(0, '#1d82cc'); gr.addColorStop(0.65, '#37aee4'); gr.addColorStop(1, '#7ce2ee');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.16})`; g.lineWidth = 2; g.beginPath(); const x = Math.random() * w, y = Math.random() * w; g.moveTo(x, y); g.quadraticCurveTo(x + 12, y + 4, x + 26, y); g.stroke(); }
  });
  const pondMat = new THREE.MeshStandardMaterial({ map: pondTex, roughness: 0.16, metalness: 0 });
  shiny.add(pondMat);
  flat(new THREE.CircleGeometry(POND.r, 40), pondMat, 0.05, POND.x, POND.z);
  flat(new THREE.RingGeometry(POND.r - 0.9, POND.r + 0.05, 48), foamMat, 0.058, POND.x, POND.z); // foam where the water meets the shore
  box(7, 0.14, 1.9, 0x9a7448, POND.x - POND.r + 3.6, 0.3, POND.z, scene);
  for (const dx of [-2.9, 0, 2.9]) for (const dz of [-0.85, 0.85]) box(0.2, 0.6, 0.2, 0x6f5233, POND.x - POND.r + 3.6 + dx, 0.1, POND.z + dz, scene);
  const boat = new THREE.Group();
  boat.position.set(POND.x + 1.5, 0.12, POND.z - 3.6);
  boat.rotation.y = 0.6;
  box(1.2, 0.35, 3, 0xf7f9fc, 0, 0.2, 0, boat); box(1.25, 0.1, 3.05, 0xd9654f, 0, 0.42, 0, boat); box(0.08, 1.8, 0.08, 0xb7c8e4, 0, 1.2, 0.2, boat);
  const sail = box(0.04, 1.3, 1.1, 0xffffff, 0, 1.3, -0.4, boat);
  scene.add(boat);
  const footpath = sampleCurve([[10, 14], [19, 27], [27, 36], [POND.x - POND.r - 1.5, POND.z - 1]], 2);
  strip(footpath, 0, 1.8, 0.028, 0xe8dcb8);
  keepOut(footpath, 2.5);

  /* ---------- cars ---------- */
  // Cars. Each type is a side profile (forward = z, up = y) extruded across the width, so bonnet, roof and boot are
  // real curves. All the small parts of a type (lights, trim, chrome, wheels) are merged into a handful of meshes and
  // built once, so a car park full of them stays cheap.
  const carMats = new Map();
  const paint = (color, fancy) => {
    const key = `${color}-${fancy}`;
    if (!carMats.has(key)) {
      const m = fancy
        ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 })
        : new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.15 });
      shiny.add(m);
      carMats.set(key, m);
    }
    return carMats.get(key);
  };
  const std = (color, metalness, roughness) => { const m = new THREE.MeshStandardMaterial({ color, metalness, roughness }); shiny.add(m); return m; };
  const CAR_GLASS = std(0x16202f, 0.7, 0.08), CHROME = std(0xe3e8f0, 1, 0.22), TRIM_M = std(0x1a202d, 0.2, 0.6), RUBBER = std(0x12151f, 0, 0.9), WHITE = std(0xf4f6fa, 0, 0.5);
  const CALIPER = std(0xd63a2e, 0.3, 0.4), DISC = std(0xb5bfd0, 0.9, 0.35);
  const carBlobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.55, depthWrite: false });
  const npcHead = new THREE.MeshBasicMaterial({ color: 0xfff6cf }), npcTail = new THREE.MeshBasicMaterial({ color: 0x8a2a2a }); // shared, glow at night
  const plateTex = tex(256, 64, (g, w, h) => {
    g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1b3263'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#1b3263'; g.font = '800 38px Manrope, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('DRIVE 01', w / 2, 44);
  });

  // geometry helpers; every part ends up non-indexed so parts sharing a material can be merged
  const part = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); return geo.index ? geo.toNonIndexed() : geo; };
  const bx = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => part(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  const cyl = (r, h, x, y, z, rx = 0, rz = 0, seg = 12) => part(new THREE.CylinderGeometry(r, r, h, seg), x, y, z, rx, 0, rz);
  const slab = (t, w, [u1, v1], [u2, v2], x) => { const du = u2 - u1, dv = v2 - v1; return part(new THREE.BoxGeometry(w, t, Math.hypot(du, dv)), x, (v1 + v2) / 2, (u1 + u2) / 2, Math.atan2(dv, -du)); };
  const shape = (cmds) => { // [u, v] = line to, [cu, cv, u, v] = curve to
    const s = new THREE.Shape();
    cmds.forEach((c, i) => (i === 0 ? s.moveTo(c[0], c[1]) : c.length === 2 ? s.lineTo(c[0], c[1]) : s.quadraticCurveTo(c[0], c[1], c[2], c[3])));
    s.closePath();
    return s;
  };
  const extrude = (cmds, width, bevel = 0.05, segs = 3) => {
    const depth = width - bevel * 2;
    const geo = new THREE.ExtrudeGeometry(shape(cmds), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 12 });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(-Math.PI / 2); // profile x -> world z, extrusion -> world x
    geo.clearGroups();
    return geo;
  };

  // w body width, gw glasshouse width, wz wheel z, wr wheel radius, fz/rz front/rear extent, low/belt body bottom and
  // waistline, head/tail/grille heights, doors as [front, back] z pairs, bTop the B pillar's top
  const KINDS = {
    sport: {
      w: 1.88, gw: 1.6, wz: 1.3, wr: 0.43, fz: 2.17, rz: 2.17, low: 0.32, belt: 0.93, head: 0.72, tail: 0.77, grille: 0.6, doors: [[0.62, -0.52]], bPillar: -0.35, bTop: 1.3,
      lower: [[-2.0, 0.32], [1.98, 0.32], [2.12, 0.34, 2.12, 0.52], [2.13, 0.68, 1.96, 0.76], [1.5, 0.86, 0.95, 0.93], [-0.7, 0.95], [-1.6, 0.97, -1.98, 0.9], [-2.12, 0.86, -2.12, 0.66], [-2.12, 0.36, -2.0, 0.32]],
      glass: [[0.9, 0.93], [0.6, 1.14, 0.36, 1.27], [-0.2, 1.37, -0.85, 1.28], [-1.2, 1.12, -1.48, 0.94]],
      lid: [[0.38, 1.285], [-0.2, 1.385, -0.87, 1.295], [-0.87, 1.24], [-0.2, 1.33, 0.38, 1.23]],
      pillars: [[[0.9, 0.93], [0.38, 1.27]], [[-0.85, 1.28], [-1.48, 0.94]]],
    },
    sedan: {
      w: 1.86, gw: 1.58, wz: 1.38, wr: 0.43, fz: 2.31, rz: 2.33, low: 0.34, belt: 0.94, head: 0.72, tail: 0.8, grille: 0.6, doors: [[0.78, -0.22], [-0.22, -1.2]], bPillar: -0.22, bTop: 1.4, tailBar: true,
      lower: [[-2.2, 0.34], [2.12, 0.34], [2.26, 0.36, 2.26, 0.56], [2.26, 0.74, 2.06, 0.8], [1.6, 0.88, 1.0, 0.93], [-1.15, 0.95], [-1.95, 0.97, -2.22, 0.88], [-2.3, 0.62, -2.2, 0.34]],
      glass: [[1.0, 0.93], [0.68, 1.2, 0.4, 1.36], [-0.35, 1.44, -1.05, 1.34], [-1.38, 1.15, -1.62, 0.95]],
      lid: [[0.42, 1.37], [-0.35, 1.47, -1.07, 1.35], [-1.07, 1.29], [-0.35, 1.39, 0.42, 1.3]],
      pillars: [[[1.0, 0.93], [0.42, 1.35]], [[-1.05, 1.34], [-1.62, 0.95]]],
    },
    hatch: {
      w: 1.8, gw: 1.56, wz: 1.2, wr: 0.4, fz: 2.03, rz: 2.0, low: 0.34, belt: 0.93, head: 0.74, tail: 0.82, grille: 0.6, doors: [[0.7, -0.5]], bPillar: -0.45, bTop: 1.44,
      lower: [[-1.85, 0.34], [1.86, 0.34], [1.98, 0.36, 1.98, 0.56], [1.98, 0.74, 1.8, 0.8], [1.4, 0.87, 0.9, 0.92], [-1.6, 0.95], [-1.92, 0.95, -1.94, 0.7], [-1.95, 0.4, -1.85, 0.34]],
      glass: [[0.88, 0.92], [0.55, 1.2, 0.3, 1.4], [-0.5, 1.47, -1.42, 1.42], [-1.72, 1.25, -1.84, 0.95]],
      lid: [[0.32, 1.41], [-0.5, 1.5, -1.44, 1.44], [-1.44, 1.38], [-0.5, 1.43, 0.32, 1.35]],
      pillars: [[[0.88, 0.92], [0.32, 1.4]], [[-1.42, 1.42], [-1.84, 0.95]]],
    },
    suv: {
      w: 1.96, gw: 1.7, wz: 1.42, wr: 0.5, fz: 2.31, rz: 2.33, low: 0.46, belt: 1.12, head: 0.92, tail: 1.0, grille: 0.78, doors: [[0.82, -0.3], [-0.3, -1.35]], bPillar: -0.3, bTop: 1.7, rails: 1.76,
      lower: [[-2.15, 0.46], [2.1, 0.46], [2.26, 0.48, 2.26, 0.74], [2.25, 0.98, 2.0, 1.04], [1.5, 1.1, 1.0, 1.12], [-2.05, 1.14], [-2.28, 1.12, -2.28, 0.82], [-2.27, 0.5, -2.15, 0.46]],
      glass: [[0.98, 1.12], [0.72, 1.42, 0.48, 1.68], [-1.95, 1.72], [-2.12, 1.5, -2.16, 1.14]],
      lid: [[0.5, 1.7], [-1.97, 1.74], [-1.97, 1.67], [0.5, 1.63]],
      pillars: [[[0.98, 1.12], [0.5, 1.68]], [[-1.95, 1.72], [-2.16, 1.14]]],
    },
    van: {
      w: 1.9, gw: 1.84, wz: 1.5, wr: 0.42, fz: 2.35, rz: 2.47, low: 0.42, belt: 1.08, head: 0.86, tail: 0.95, grille: 0.72, doors: [[0.95, -0.15], [-0.3, -1.5]], bPillar: null,
      lower: [[-2.42, 0.42], [2.15, 0.42], [2.3, 0.44, 2.3, 0.66], [2.3, 0.92, 2.06, 0.98], [1.62, 1.05, 1.2, 1.08], [-2.42, 1.1]],
      glass: [[1.2, 1.08], [0.95, 1.55, 0.62, 1.95], [-0.3, 1.97], [-0.3, 1.08]],
      upper: [[-0.28, 1.08], [-0.28, 1.98], [-2.38, 2.0], [-2.42, 1.99, -2.42, 1.9], [-2.42, 1.1]], // the cargo box
      roof: [1.86, 0.08, 3.12, 2.03, -0.86],
      pillars: [[[1.2, 1.08], [0.62, 1.95]]],
    },
  };

  function buildKit(K, sport) {
    const P = [], G = [], T = [], C = [], W = [], H = [], L = []; // paint, glass, trim, chrome, white, headlights, taillights
    P.push(extrude(K.lower, K.w));
    G.push(extrude(K.glass, K.gw, 0.03, 2));
    if (K.lid) P.push(extrude(K.lid, K.gw - 0.04, 0.025, 2));
    if (K.upper) P.push(extrude(K.upper, K.w, 0.04, 2));
    if (K.roof) P.push(bx(K.roof[0], K.roof[1], K.roof[2], 0, K.roof[3], K.roof[4]));
    const hw = K.w / 2, gx = K.gw / 2 - 0.02, mirrorZ = K.pillars[0][0][0] - 0.25;
    for (const s of [-1, 1]) {
      for (const [a, b] of K.pillars) P.push(slab(0.07, 0.07, a, b, s * gx));
      if (K.bPillar != null) P.push(bx(0.07, K.bTop - K.belt, 0.08, s * gx, (K.bTop + K.belt) / 2, K.bPillar));
      P.push(bx(0.14, 0.1, 0.22, s * (gx + 0.2), K.belt + 0.08, mirrorZ)); // mirror
      G.push(bx(0.12, 0.07, 0.03, s * (gx + 0.2), K.belt + 0.08, mirrorZ - 0.12));
      T.push(bx(0.05, 0.12, 2 * K.wz - 2 * K.wr - 0.3, s * hw, K.low + 0.06, 0)); // sill
      for (const [f, b] of K.doors) {
        for (const z of [f, b]) T.push(bx(0.03, K.belt - K.low - 0.22, 0.03, s * (hw + 0.004), (K.belt + K.low) / 2 + 0.02, z)); // shut lines
        C.push(bx(0.04, 0.04, 0.16, s * (hw + 0.012), K.belt - 0.14, b + 0.3)); // handle
      }
      for (const z of [-K.wz, K.wz]) {
        T.push(cyl(K.wr + 0.05, 0.03, s * (hw + 0.005), K.wr, z, 0, Math.PI / 2, 18)); // dark wheel arch
        T.push(part(new THREE.TorusGeometry(K.wr + 0.07, 0.028, 6, 18, Math.PI), s * (hw + 0.03), K.wr, z, 0, Math.PI / 2)); // arch lip
      }
      H.push(bx(0.46, 0.13, 0.06, s * (hw - 0.32), K.head, K.fz - 0.03));
      H.push(bx(0.4, 0.025, 0.04, s * (hw - 0.32), K.head + 0.085, K.fz - 0.03)); // daytime running strip
      L.push(bx(0.46, 0.12, 0.05, s * (hw - 0.32), K.tail, -K.rz + 0.02));
      if (K.rails) T.push(bx(0.06, 0.06, 2.2, s * (gx - 0.12), K.rails, -0.75)); // roof rails
    }
    T.push(bx(K.w * 0.52, 0.2, 0.05, 0, K.grille, K.fz - 0.005)); // grille
    for (const dy of [-0.05, 0, 0.05]) C.push(bx(K.w * 0.51, 0.015, 0.06, 0, K.grille + dy, K.fz));
    C.push(cyl(0.05, 0.02, 0, K.grille, K.fz + 0.03, Math.PI / 2)); // badge
    T.push(bx(K.w - 0.14, 0.1, 0.16, 0, K.low + 0.05, K.fz - 0.08), bx(K.w - 0.14, 0.1, 0.16, 0, K.low + 0.08, -K.rz + 0.08)); // bumpers
    T.push(bx(K.w - 0.1, 0.08, K.fz + K.rz - 0.4, 0, K.low - 0.02, (K.fz - K.rz) / 2)); // underbody
    W.push(bx(0.5, 0.12, 0.03, 0, K.low + 0.18, K.fz), bx(0.5, 0.13, 0.03, 0, K.tail - 0.22, -K.rz)); // plates
    if (K.tailBar) L.push(bx(1.0, 0.04, 0.05, 0, K.tail + 0.04, -K.rz + 0.02));
    if (sport) { // the hero car: spoiler, vents, stripes, projectors, twin exhausts
      P.push(bx(1.72, 0.05, 0.42, 0, 1.17, -1.95, 0.06));
      for (const s of [-1, 1]) {
        P.push(bx(0.04, 0.14, 0.44, s * 0.86, 1.2, -1.93));
        T.push(bx(0.06, 0.2, 0.2, s * 0.6, 1.04, -1.85), bx(0.28, 0.02, 0.36, s * 0.35, 0.955, 1.25, 0.127));
        for (let k = 0; k < 3; k++) T.push(bx(0.02, 0.025, 0.3, s * 0.975, 0.5 + k * 0.07, 0.8));
        for (const dx of [-0.1, 0.1]) H.push(cyl(0.055, 0.06, s * (hw - 0.32) + dx, K.head, K.fz, Math.PI / 2));
        C.push(cyl(0.06, 0.2, s * 0.5, 0.38, -K.rz - 0.03, Math.PI / 2));
        const x = s * 0.2;
        W.push(slab(0.02, 0.22, [1.92, 0.815], [1.48, 0.905], x), slab(0.02, 0.22, [1.48, 0.905], [0.97, 0.985], x), slab(0.02, 0.22, [0.38, 1.315], [-0.22, 1.375], x),
          slab(0.02, 0.22, [-0.22, 1.375], [-0.87, 1.33], x), slab(0.02, 0.22, [-0.95, 1.0], [-1.47, 1.0], x), slab(0.02, 0.22, [-1.47, 1.0], [-1.98, 0.95], x));
      }
      L.push(bx(0.5, 0.025, 0.03, 0, 1.15, -2.17));
      T.push(bx(1.4, 0.1, 0.3, 0, 0.33, -K.rz + 0.2, -0.3), bx(0.04, 0.07, 0.2, 0, 1.4, -0.95));
    }
    // wheels: a rounded tyre and a five-spoke alloy, both turned to spin about x
    const r = K.wr;
    const tyre = part(new THREE.LatheGeometry([[0.6, -0.15], [0.88, -0.15], [1, -0.11], [1.02, -0.06], [1.02, 0.06], [1, 0.11], [0.88, 0.15], [0.6, 0.15]].map(([a, y]) => new THREE.Vector2(a * r, y)), 24), 0, 0, 0, 0, 0, Math.PI / 2);
    const rim = [part(new THREE.LatheGeometry([[0.47, 0.13], [0.68, 0.13], [0.68, -0.13], [0.47, -0.13]].map(([a, y]) => new THREE.Vector2(a * r, y)), 20), 0, 0, 0, 0, 0, Math.PI / 2), cyl(0.075, 0.3, 0, 0, 0, 0, Math.PI / 2)];
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
      const len = r * 0.62, g = new THREE.BoxGeometry(0.045, 0.06, len);
      g.translate(0, 0, 0.07 + len / 2); g.rotateX((k / 5) * Math.PI * 2); g.translate(s * 0.11, 0, 0);
      rim.push(g.toNonIndexed());
    }
    const merge = (list) => (list.length ? mergeGeometries(list) : null);
    return { paint: merge(P), glass: merge(G), trim: merge(T), chrome: merge(C), white: merge(W), head: merge(H), tail: merge(L), tyre, rim: merge(rim) };
  }

  const kits = {};
  const discGeo = cyl(0.21, 0.03, 0, 0, 0, 0, Math.PI / 2, 20), caliperGeo = new THREE.BoxGeometry(0.1, 0.12, 0.18);
  const makeCar = (color, { kind = 'sedan', player = false } = {}) => {
    const K = KINDS[kind], kit = (kits[kind] ??= buildKit(K, kind === 'sport'));
    const group = new THREE.Group(), body = new THREE.Group();
    group.add(body);
    const shadowBlob = new THREE.Mesh(new THREE.PlaneGeometry(K.w + 1.4, K.fz + K.rz + 1.6), carBlobMat); // soft contact shadow
    shadowBlob.rotation.x = -Math.PI / 2;
    shadowBlob.position.y = 0.016;
    group.add(shadowBlob);
    const PAINT = paint(color, player);
    const headMat = player ? new THREE.MeshBasicMaterial({ color: 0xfff6cf }) : npcHead;
    const tailMat = player ? new THREE.MeshBasicMaterial({ color: 0x8a2a2a }) : npcTail;
    const mesh = (geo, mat, shadow = false, parent = body) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    mesh(kit.paint, PAINT, true); mesh(kit.glass, CAR_GLASS, true); mesh(kit.trim, TRIM_M, true);
    mesh(kit.chrome, CHROME); mesh(kit.white, WHITE); mesh(kit.head, headMat); mesh(kit.tail, tailMat);
    if (player) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.13), new THREE.MeshBasicMaterial({ map: plateTex }));
      plate.position.set(0, K.tail - 0.22, -K.rz - 0.02); plate.rotation.y = Math.PI; body.add(plate);
    }
    const wheels = [];
    for (const [x, z, front] of [[-1, K.wz, 1], [1, K.wz, 1], [-1, -K.wz, 0], [1, -K.wz, 0]]) {
      const pivot = new THREE.Group(), spin = new THREE.Group();
      pivot.position.set(x * (K.w / 2 + 0.05), K.wr, z);
      pivot.add(spin);
      mesh(kit.tyre, RUBBER, true, spin);
      mesh(kit.rim, CHROME, false, spin);
      if (player) { // brake disc and a red caliper behind the spokes
        mesh(discGeo, DISC, false, spin).position.x = -x * 0.02;
        mesh(caliperGeo, CALIPER, false, pivot).position.set(-x * 0.02, 0.21, 0.07);
      }
      group.add(pivot);
      wheels.push({ pivot, spin, front });
    }
    return { group, body, wheels, headMat, tailMat, paintMat: PAINT };
  };

  /* ---------- car park, billboard, barrier, portal, turbines ---------- */
  const bayCar = (k, row) => ({ x: -39 + k * 2.4, z: row ? 52.6 : 43.4 });
  const occupied = new Set();
  for (const [k, row, c, kind] of [[1, 0, 0xc0392b, 'suv'], [2, 0, 0xe9edf2, 'van'], [5, 0, 0x2e7d5b, 'sedan'], [8, 0, 0x9aa3b2, 'hatch'], [0, 1, 0x274a8f, 'sedan'], [3, 1, 0x2b3038, 'suv'], [4, 1, 0xd9a441, 'hatch']]) {
    const p = makeCar(c, { kind }), b = bayCar(k, row);
    p.group.position.set(b.x + 1.2, ROAD_Y - 0.02, b.z);
    p.group.rotation.y = row ? Math.PI : 0;
    scene.add(p.group);
    occupied.add(`${k}-${row}`);
    obstacles.push({ x: b.x + 1.2, z: b.z, r: 1.5 });
  }
  const freeBay = (() => { for (let k = 9; k >= 0; k--) if (!occupied.has(`${k}-1`)) return { ...bayCar(k, 1), k }; return bayCar(9, 1); })();
  const bayFree = 20 - occupied.size;

  const bill = new THREE.Group();
  bill.position.set(15, 0, 30);
  for (const x of [-3.2, 3.2]) box(0.2, 3, 0.2, 0x56607a, x, 1.5, 0, bill);
  const billFace = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 2.4), new THREE.MeshBasicMaterial({
    map: tex(1024, 300, (g, w, h) => {
      g.fillStyle = '#fff'; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 40); g.fill();
      g.strokeStyle = '#2f66d6'; g.lineWidth = 10; g.stroke();
      g.textAlign = 'center'; g.fillStyle = '#1b3263'; g.font = '800 120px Manrope, system-ui, sans-serif';
      g.fillText(opts.name ?? 'Portfolio', w / 2, 160);
      g.fillStyle = '#6b7fa6'; g.font = '700 46px Manrope, system-ui, sans-serif';
      g.fillText('PORTFOLIO', w / 2, 232);
    }),
  }));
  billFace.position.set(0, 3.3, 0.12);
  bill.add(billFace);
  box(8.6, 2.6, 0.2, 0x2b3550, 0, 3.3, 0, bill);
  scene.add(bill);
  obstacles.push({ x: 15 - 3.2, z: 30, r: 0.6 }, { x: 15 + 3.2, z: 30, r: 0.6 }, { x: 15, z: 30, r: 0.6 });
  blocked.push({ cx: 15, cz: 30, r: 7 });

  const gate = at(entrance.S, 102);
  for (const side of [-1, 1]) { // the end of the road
    const px = gate.p.x + gate.n.x * side * 3.4, pz = gate.p.z + gate.n.z * side * 3.4;
    box(0.4, 1.4, 0.4, 0xffffff, px, 0.7, pz, scene);
    obstacles.push({ x: px, z: pz, r: 0.9 });
  }
  for (let i = 0; i < 5; i++) { // striped bar across the road
    const q = gate.p, off = (i - 2) * 1.4;
    box(1.4, 0.35, 0.3, i % 2 ? 0xffffff : 0xe03a2e, q.x + gate.n.x * off, 1.2, q.z + gate.n.z * off, scene).rotation.y = yawOf(gate) + Math.PI / 2;
    obstacles.push({ x: q.x + gate.n.x * off, z: q.z + gate.n.z * off, r: 0.8 });
  }

  const portalTex = tex(256, 256, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, '#d8fbff'); grad.addColorStop(0.5, '#2bb6e8'); grad.addColorStop(1, '#173d9c');
    g.fillStyle = grad; g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 8;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(w / 2, w / 2, 40 + i * 34, i, i + 3.2); g.stroke(); }
  });
  const portal = new THREE.Group();
  const pa = stops.length > 1 ? (stops[0].a + stops[1].a) / 2 : 2.6; // in the wedge between the first two roads
  const PORTAL = { x: Math.cos(pa) * 27, z: Math.sin(pa) * 27 };
  portal.position.set(PORTAL.x, 0, PORTAL.z);
  const swirl = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), new THREE.MeshBasicMaterial({ map: portalTex, side: THREE.DoubleSide }));
  swirl.position.y = 2.6;
  const frame = add(new THREE.TorusGeometry(2.3, 0.28, 10, 32), new THREE.MeshBasicMaterial({ color: 0x1b3a9a }), 0, 2.6, 0, portal, false);
  portal.add(swirl);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x5be6ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 20;
  portal.add(beam);
  portal.rotation.y = 0.5;
  scene.add(portal);
  obstacles.push({ x: PORTAL.x, z: PORTAL.z, r: 2.8 });
  blocked.push({ cx: PORTAL.x, cz: PORTAL.z, r: 7 });

  const turbines = [];
  for (const [x, z] of [[-36, -88], [-8, -94], [24, -90], [-70, -60]]) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    add(new THREE.CylinderGeometry(0.2, 0.4, 9, 8), 0xffffff, 0, 4.5, 0, t);
    const rotor = new THREE.Group();
    rotor.position.set(0, 9.2, 0.5);
    for (let b = 0; b < 3; b++) { const arm = new THREE.Group(); arm.rotation.z = (b * Math.PI * 2) / 3; box(0.25, 4.2, 0.06, 0xf4f7fc, 0, 2.1, 0, arm); rotor.add(arm); }
    add(new THREE.SphereGeometry(0.4, 10, 8), 0xdfe6f2, 0, 0, 0, rotor);
    t.add(rotor);
    scene.add(t);
    turbines.push(rotor);
    obstacles.push({ x, z, r: 0.9 });
    blocked.push({ cx: x, cz: z, r: 3 });
  }

  /* ---------- street lights: they can be knocked over ---------- */
  const lampPos = [];
  const lampSide = (S, from, to, step, off) => {
    for (let d = from; d <= to; d += step) for (const k of [-1, 1]) { const q = at(S, d); lampPos.push({ x: q.p.x + q.n.x * k * off, z: q.p.z + q.n.z * k * off }); }
  };
  const OFF = ROAD_W / 2 + 0.8;
  for (const a of arms) {
    if (a.kind === 'spoke') lampSide(a.S, 9, a.S.len - 8, 14, OFF);
    else if (a.kind === 'entrance') lampSide(a.S, 24, 98, 22, OFF);
    else if (a.kind === 'east') lampSide(a.S, 22, 40, 18, OFF);
  }
  const N = lampPos.length;
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 4, 6), lambert(0x56607a), N);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xdfe6f2 });
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 8, 6), headMat, N);
  const glow = tex(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  const haloMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xffe3a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const halos = new THREE.InstancedMesh(new THREE.CircleGeometry(3.4, 20), haloMat, N);
  poles.castShadow = true;
  scene.add(poles, heads, halos);
  for (const l of lampPos) blocked.push({ cx: l.x, cz: l.z, r: 1.2 });

  const lamps = lampPos.map((l, i) => ({ ...l, i, state: 'ok', fall: 0, dx: 0, dz: 1, flick: 0, sparkT: 0, sparks: 0, hx: l.x, hy: 4.1, hz: l.z }));
  const LIT = new THREE.Color(1, 1, 1), DEAD = new THREE.Color(0.16, 0.17, 0.2);
  const tilt = new THREE.Quaternion(), axis = new THREE.Vector3();
  let lampsDirty = true, lampsBroken = 0;
  function placeLamp(l, lit = true) {
    let px = l.x, py = 2, pz = l.z;
    tilt.identity();
    l.hx = l.x; l.hy = 4.1; l.hz = l.z;
    if (l.state !== 'ok') { // topple over, pivoting at the base
      const phi = Math.min(1, l.fall) ** 2 * (Math.PI / 2 - 0.06), s = Math.sin(phi), c = Math.cos(phi);
      tilt.setFromAxisAngle(axis.set(l.dz, 0, -l.dx), phi);
      px = l.x + l.dx * s * 2; py = Math.max(0.15, c * 2); pz = l.z + l.dz * s * 2;
      l.hx = l.x + l.dx * s * 4.1; l.hy = Math.max(0.3, c * 4.1); l.hz = l.z + l.dz * s * 4.1;
    }
    dummy.scale.set(1, 1, 1);
    dummy.position.set(px, py, pz); dummy.quaternion.copy(tilt); dummy.updateMatrix(); poles.setMatrixAt(l.i, dummy.matrix);
    dummy.position.set(l.hx, l.hy, l.hz); dummy.quaternion.identity(); dummy.updateMatrix(); heads.setMatrixAt(l.i, dummy.matrix);
    const on = l.state === 'ok' && lit;
    dummy.position.set(l.x, 0.13, l.z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.setScalar(on ? 1 : 0); dummy.updateMatrix(); halos.setMatrixAt(l.i, dummy.matrix);
    heads.setColorAt(l.i, on ? LIT : DEAD);
    lampsDirty = true;
  }
  lamps.forEach((l) => placeLamp(l));

  const SPARKS = 48, sparkPos = new Float32Array(SPARKS * 3).fill(-100), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  scene.add(new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffb347, size: 0.5, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  let sparkNext = 0;
  function emitSparks(x, y, z, count) {
    for (let k = 0; k < count; k++) {
      const i = sparkNext++ % SPARKS;
      sparkPos.set([x, y, z], i * 3);
      sparkVel.set([(Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7], i * 3);
      sparkLife[i] = 0.5 + Math.random() * 0.5;
    }
  }
  function breakLamp(l, dx, dz) {
    l.state = 'falling'; l.fall = 0; l.dx = dx; l.dz = dz; l.sparks = 4; l.sparkT = 0.6;
    emitSparks(l.hx, l.hy - 0.5, l.hz, 22);
    lampsBroken++;
  }
  let flickT = 3;

  /* ---------- scatter: houses, trees, flowers ---------- */
  function free(x, z, r) {
    if (Math.hypot(x, z) > LIMIT - 3) return false;
    for (const b of blocked) {
      if (b.cx != null ? Math.hypot(x - b.cx, z - b.cz) < b.r + r : distSeg(x, z, b.ax, b.az, b.bx, b.bz) < b.r + r) return false;
    }
    return obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + r + 0.5);
  }
  function scatter(count, r, place, solid = true, o = {}) {
    const [d0, d1] = o.d ?? [12, LIMIT - 4];
    for (let k = 0, tries = 0; k < count && tries < count * 80; tries++) {
      const ang = rnd() * Math.PI * 2;
      let x, z; // either anywhere in the village, or in a patch round o.at
      if (o.at) { const dd = Math.sqrt(rnd()) * o.at.r; x = o.at.x + Math.cos(ang) * dd; z = o.at.z + Math.sin(ang) * dd; }
      else { const d = d0 + Math.sqrt(rnd()) * (d1 - d0); x = Math.cos(ang) * d; z = Math.sin(ang) * d; }
      if (!free(x, z, r)) continue;
      place(x, z);
      if (solid) obstacles.push({ x, z, r });
      k++;
    }
  }
  /* ---------- detail that gives the village structure: arrows, hedges, fences, a bus stop, a field, an orchard, ducks ---------- */
  const arrowGeo = (() => { // a painted lane arrow, tip towards -z
    const s = new THREE.Shape();
    s.moveTo(0, 1.3); s.lineTo(0.55, 0.3); s.lineTo(0.18, 0.3); s.lineTo(0.18, -1.2); s.lineTo(-0.18, -1.2); s.lineTo(-0.18, 0.3); s.lineTo(-0.55, 0.3); s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  const arrows = [], stopLines = [], manholes = [];
  for (const a of arms) {
    if (a.kind === 'east') continue;
    const q = at(a.S, 15), line = at(a.S, 9.9);
    arrows.push({ x: q.p.x - q.n.x * 1.6, z: q.p.z - q.n.z * 1.6, yaw: yawOf(q) }); // inbound, pointing at the roundabout
    arrows.push({ x: q.p.x + q.n.x * 1.6, z: q.p.z + q.n.z * 1.6, yaw: yawOf(q) + Math.PI }); // outbound
    stopLines.push({ x: line.p.x - line.n.x * 1.7, z: line.p.z - line.n.z * 1.7, yaw: yawOf(line) });
    for (let k = 0; k < 2; k++) { const m = at(a.S, 20 + rnd() * (a.S.len - 30)); manholes.push({ x: m.p.x + m.n.x * (rnd() - 0.5) * 3, z: m.p.z + m.n.z * (rnd() - 0.5) * 3, yaw: 0 }); }
  }
  instanced(arrowGeo, arrows, 0xffffff);
  instanced(new THREE.BoxGeometry(2.8, 0.02, 0.35), stopLines, 0xffffff);
  instanced(new THREE.CylinderGeometry(0.38, 0.38, 0.02, 10), manholes, 0x39404c);

  const hedges = [], fenceSegs = [];
  const hedgeAlong = (S, from, to, off) => { for (let d = from; d <= to; d += 2.1) { const q = at(S, d); hedges.push({ x: q.p.x + q.n.x * off, z: q.p.z + q.n.z * off, yaw: yawOf(q) }); } };
  for (const side of [-1, 1]) { hedgeAlong(entrance.S, 40, 56, side * 5.6); hedgeAlong(entrance.S, 74, 96, side * 5.6); }
  for (let x = park.x - park.w / 2; x <= park.x + park.w / 2; x += 2.1) { hedges.push({ x, z: park.z - park.d / 2 - 1, yaw: Math.PI / 2 }, { x, z: park.z + park.d / 2 + 1, yaw: Math.PI / 2 }); }
  blocked.push({ ax: park.x - park.w / 2, az: park.z - park.d / 2 - 1, bx: park.x + park.w / 2, bz: park.z - park.d / 2 - 1, r: 2 }, { ax: park.x - park.w / 2, az: park.z + park.d / 2 + 1, bx: park.x + park.w / 2, bz: park.z + park.d / 2 + 1, r: 2 });
  const fence = (ax, az, bx, bz) => { fenceSegs.push({ ax, az, bx, bz }); blocked.push({ ax, az, bx, bz, r: 1.2 }); for (let t = 0; t <= 1.001; t += 3 / Math.hypot(bx - ax, bz - az)) obstacles.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, r: 0.45 }); };
  fence(park.x - park.w / 2 - 0.3, park.z - park.d / 2, park.x - park.w / 2 - 0.3, park.z + park.d / 2); // west edge of the car park

  const FIELD = { x: -76, z: 22, w: 28, d: 17 };
  const fieldTex = tex(256, 128, (g, w, h) => { // rows of wheat
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#d9b94f' : '#e8cb62'; g.fillRect(0, (i * h) / 16, w, h / 16); }
    for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(${i % 2 ? '120,90,20' : '255,240,160'},.18)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 3); }
  });
  flat(new THREE.PlaneGeometry(FIELD.w, FIELD.d), new THREE.MeshLambertMaterial({ map: fieldTex }), 0.03, FIELD.x, FIELD.z).rotation.z = 0;
  shapes.rects.push({ x: FIELD.x, z: FIELD.z, w: FIELD.w, d: FIELD.d, yaw: 0, color: '#ead98a' });
  blocked.push({ cx: FIELD.x, cz: FIELD.z, r: 18 });
  for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1]]) fence(FIELD.x + ax * (FIELD.w / 2 + 0.6), FIELD.z + az * (FIELD.d / 2 + 0.6), FIELD.x + bx * (FIELD.w / 2 + 0.6), FIELD.z + bz * (FIELD.d / 2 + 0.6)); // the open side faces the road
  for (const [bx, bz] of [[-3, 3], [2, -2], [6, 4]]) { // round hay bales
    const bale = add(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 14), 0xe0c35a, FIELD.x + bx, 0.78, FIELD.z + bz, scene);
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = bx;
    obstacles.push({ x: FIELD.x + bx, z: FIELD.z + bz, r: 1.1 });
  }
  const orchard = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) orchard.push({ x: -80 + col * 5.2, z: -46 + row * 6 });
  blocked.push({ cx: -67, cz: -40, r: 17 });

  { // a bus shelter with a bench, a stop sign and a post box beside the entrance road
    const q = at(entrance.S, 64), side = 1, g = new THREE.Group();
    const px = q.p.x + q.n.x * side * (ROAD_W / 2 + SW + 2.4), pz = q.p.z + q.n.z * side * (ROAD_W / 2 + SW + 2.4);
    g.position.set(px, 0, pz);
    g.rotation.y = Math.atan2(-q.n.x * side, -q.n.z * side); // the open side faces the road
    add(new THREE.BoxGeometry(3.2, 1.9, 0.08), glass, 0, 1.15, -0.8, g, false);
    box(3.5, 0.14, 1.9, 0x2b3550, 0, 2.2, 0, g);
    for (const x of [-1.5, 1.5]) box(0.1, 2.2, 0.1, 0x56607a, x, 1.1, -0.8, g);
    box(2.2, 0.1, 0.5, 0x9a7448, 0, 0.55, -0.45, g);
    const sign2 = new THREE.Group(); sign2.position.set(2.4, 0, 0.4); g.add(sign2);
    box(0.08, 2.6, 0.08, 0x56607a, 0, 1.3, 0, sign2);
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16), 0xf2c230, 0, 2.6, 0, sign2).rotation.x = Math.PI / 2;
    box(0.5, 1.0, 0.4, 0xf2c230, -2.4, 0.5, 0.3, g); box(0.34, 0.06, 0.02, 0x1b2438, -2.4, 0.85, 0.52, g); // post box
    scene.add(g);
    obstacles.push({ x: px, z: pz, r: 2 });
    blocked.push({ cx: px, cz: pz, r: 4.5 });
    aoBlob(px, pz, 6, 4, g.rotation.y, 0.4);
  }

  const ducks = Array.from({ length: 4 }, (_, i) => { // ducks paddle round the pond
    const g = new THREE.Group();
    add(new THREE.SphereGeometry(0.2, 8, 6), 0xffffff, 0, 0.14, 0, g).scale.set(1, 0.7, 1.5);
    add(new THREE.SphereGeometry(0.11, 8, 6), 0x2f7d4a, 0, 0.34, 0.26, g);
    add(new THREE.ConeGeometry(0.05, 0.14, 6), 0xf09a2a, 0, 0.32, 0.4, g).rotation.x = Math.PI / 2;
    scene.add(g);
    return { g, r: 2.4 + i * 1.3, th: i * 1.7, v: (i % 2 ? -1 : 1) * (0.18 + i * 0.03), ph: i * 2 };
  });
  const reedPts = [];
  for (let i = 0; i < 90; i++) { const a = rnd() * 6.3; if (Math.abs(wrapAngle(a - Math.PI)) < 0.5) continue; const r = POND.r + 0.1 + rnd() * 0.7; reedPts.push({ x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r }); } // none at the dock

  const WALLS = [0xffffff, 0xf6e8d2, 0xe8eef7, 0xf1e4cb], ROOFS = [0xd9654f, 0x4b78c9, 0x3f8f6b, 0xc9863a, 0x6b6f7c];
  scatter(14, 3.2, (x, z) => {
    const w = 3 + rnd() * 2, d = 3 + rnd() * 1.6, h = 2 + rnd() * 1.4, yaw = rnd() * Math.PI;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    windowed(w, h, d, WALLS[(rnd() * 4) | 0], h / 2, g);
    const roof = add(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.7, 4), roofMat(ROOFS[(rnd() * 5) | 0]), 0, h + 0.85, 0, g);
    roof.rotation.y = Math.PI / 4;
    box(0.7, 1.2, 0.1, 0x6f5233, 0, 0.6, -d / 2 - 0.02, g);
    box(1.3, 0.1, 0.9, 0x5a4a3a, 0, 1.45, -d / 2 - 0.4, g); // porch roof over the door
    for (const x of [-0.55, 0.55]) box(0.07, 1.4, 0.07, 0xf4f6fa, x, 0.7, -d / 2 - 0.75, g);
    if (rnd() > 0.5) box(0.4, 1.2, 0.4, 0x8a6a48, w * 0.25, h + 1.4, d * 0.1, g);
    scene.add(g);
    shapes.rects.push({ x, z, w, d, yaw, color: '#d6cdb8' });
    aoBlob(x, z, w + 4.5, d + 4.5, yaw, 0.45);
  }, true, { d: [16, 96] });

  // trees: one instanced mesh per part, so a whole forest is a handful of draw calls
  const treeList = [];
  const addTree = (x, z, solid) => { treeList.push({ x, z, k: 0.8 + rnd() * 0.8, round: rnd() > 0.38, tint: GREENS[(rnd() * 3) | 0] }); if (solid) obstacles.push({ x, z, r: 1.1 }); };
  // trees grow in groves with open meadow between them, not evenly sprinkled
  const groves = [];
  for (let i = 0; i < 15; i++) { const a = rnd() * 6.3, d = 30 + rnd() * 62; groves.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 5 + rnd() * 5 }); }
  for (const gr of groves) scatter(6 + ((rnd() * 8) | 0), 1.3, (x, z) => addTree(x, z, false), true, { at: gr });
  scatter(34, 1.3, (x, z) => addTree(x, z, false), true, { d: [18, 100] }); // a few lone trees in the open
  for (const o of orchard) addTree(o.x, o.z, true); // rows of fruit trees beside the field
  for (let i = 0; i < 900; i++) { // forest all round the edge of the map
    const a = rnd() * Math.PI * 2, d = LIMIT + 2 + Math.sqrt(rnd()) * 90;
    addTree(Math.cos(a) * d, Math.sin(a) * d, false);
  }
  for (let i = 0; i < 120; i++) { // along the river and the railway
    const q = (i % 2 ? river : rail).s[(rnd() * (i % 2 ? river : rail).s.length) | 0], side = rnd() > 0.5 ? 1 : -1, off = (i % 2 ? 11 : 9) + rnd() * 9;
    const x = q.p.x + q.n.x * side * off, z = q.p.z + q.n.z * side * off;
    if (Math.hypot(x, z) < LIMIT + 60 && free(x, z, 1)) addTree(x, z, false);
  }
  const rounds = treeList.filter((t) => t.round), cones = treeList.filter((t) => !t.round);
  // canopies are clusters of blobs with a darker underside (baked ambient occlusion), so trees have volume
  const aoPaint = (geo, lo, hi) => {
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox, pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const k = lo + (hi - lo) * ((pos.getY(i) - min.y) / (max.y - min.y)); col.set([k, k, k], i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  const blob = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
  const tier = (r, h, y) => new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2, 0);
  const crownGeo = aoPaint(mergeGeometries([blob(1.15, 0, 0, 0), blob(0.85, 0.75, -0.2, 0.3), blob(0.8, -0.7, -0.15, -0.25), blob(0.7, 0.1, 0.6, -0.5)]), 0.6, 1);
  const pineGeo = aoPaint(mergeGeometries([tier(1.4, 1.9, 0), tier(1.1, 1.7, 1.05), tier(0.78, 1.5, 2.0)]), 0.55, 1);
  const bushGeo = aoPaint(mergeGeometries([blob(0.5, 0, 0, 0), blob(0.38, 0.4, -0.08, 0.1), blob(0.34, -0.38, -0.1, -0.08)]), 0.6, 1);
  const tuftGeo = aoPaint(mergeGeometries([0, 1, 2, 3, 4].map((i) => new THREE.ConeGeometry(0.07, 0.55 - i * 0.04, 4).translate(Math.cos(i * 1.26) * 0.12, 0.27, Math.sin(i * 1.26) * 0.12))), 0.5, 1);
  const mkInst = (geo, count, color = 0xffffff, cast = true) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true, vertexColors: !!geo.attributes.color }), count);
    m.castShadow = cast; m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const PINES = [0x4a9b5c, 0x3f8c52, 0x55a066];
  const trunks = mkInst(new THREE.CylinderGeometry(0.15, 0.2, 1, 6), treeList.length, 0x8b6b4a);
  const crowns = mkInst(crownGeo, rounds.length);
  const pines = mkInst(pineGeo, cones.length);
  treeList.forEach((t, i) => { dummy.position.set(t.x, 0.5 * t.k, t.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, t.k, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix); });
  rounds.forEach((t, i) => { dummy.position.set(t.x, 1.8 * t.k + 0.2, t.z); dummy.rotation.set(0, i * 1.7, 0); dummy.scale.setScalar(t.k); dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix); crowns.setColorAt(i, new THREE.Color(t.tint)); });
  cones.forEach((t, i) => { dummy.position.set(t.x, 0.8 * t.k, t.z); dummy.rotation.set(0, i, 0); dummy.scale.setScalar(t.k); dummy.updateMatrix(); pines.setMatrixAt(i, dummy.matrix); pines.setColorAt(i, new THREE.Color(PINES[i % 3])); });
  dummy.scale.set(1, 1, 1);
  const shaded = treeList.filter((t) => Math.hypot(t.x, t.z) < LIMIT + 4); // a soft dark blob under every tree near the village
  const treeBlobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.5, depthWrite: false }), shaded.length);
  shaded.forEach((t, i) => { dummy.position.set(t.x, 0.02, t.z); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(4 * t.k, 4 * t.k, 1); dummy.updateMatrix(); treeBlobs.setMatrixAt(i, dummy.matrix); });
  scene.add(treeBlobs);
  dummy.scale.set(1, 1, 1);

  const spots = (count, r, o = { d: [12, 100] }) => { const pts = []; scatter(count, r, (x, z) => pts.push({ x, z }), false, o); return pts; };
  const dress = (geo, pts, y, tints, [s0, s1], cast = false) => { // bushes and grass tufts scattered over the meadow
    const m = mkInst(geo, pts.length, 0xffffff, cast);
    pts.forEach((p, i) => { const k = s0 + rnd() * (s1 - s0); dummy.position.set(p.x, y * k, p.z); dummy.rotation.set(0, rnd() * 6, 0); dummy.scale.setScalar(k); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, new THREE.Color(tints[(rnd() * tints.length) | 0])); });
    dummy.scale.set(1, 1, 1);
  };
  const bushPts = groves.flatMap((gr) => spots(7, 0.7, { at: { x: gr.x, z: gr.z, r: gr.r + 3 } })); // bushes huddle at the edges of the groves
  dress(bushGeo, [...bushPts, ...spots(50, 0.7, { d: [16, 100] })], 0.38, GREENS, [0.8, 1.5], true);
  dress(tuftGeo, spots(480, 0.4, { d: [16, 100] }), 0, [0x9bd36f, 0x8fcb64, 0x7fbe58, 0xa9dc7c], [0.8, 1.6]);

  // low hedges line the road verges and the car park; fences and reeds are instanced too
  const hedgeGeo = aoPaint(mergeGeometries([blob(0.5, -0.8, 0, 0), blob(0.55, 0, 0.05, 0), blob(0.5, 0.8, 0, 0)]), 0.6, 1);
  const hedgeMesh = mkInst(hedgeGeo, hedges.length, 0xffffff, true);
  hedges.forEach((h, i) => { dummy.position.set(h.x, 0.5, h.z); dummy.rotation.set(0, h.yaw + Math.PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); hedgeMesh.setMatrixAt(i, dummy.matrix); hedgeMesh.setColorAt(i, new THREE.Color(i % 3 ? 0x5fa84e : 0x6bb85a)); });
  const postList = [], railList = [];
  for (const f of fenceSegs) {
    const len = Math.hypot(f.bx - f.ax, f.bz - f.az), yaw = Math.atan2(f.bx - f.ax, f.bz - f.az);
    for (let t = 0; t <= len + 0.01; t += 2.4) postList.push({ x: f.ax + ((f.bx - f.ax) * t) / len, z: f.az + ((f.bz - f.az) * t) / len });
    for (const y of [0.4, 0.8]) railList.push({ x: (f.ax + f.bx) / 2, z: (f.az + f.bz) / 2, y, len, yaw });
  }
  const posts = mkInst(new THREE.BoxGeometry(0.14, 1.05, 0.14), postList.length, 0xa8814f, true);
  postList.forEach((p, i) => { dummy.position.set(p.x, 0.52, p.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix); });
  const rails = mkInst(new THREE.BoxGeometry(0.06, 0.09, 1), railList.length, 0xb78f5c, true);
  railList.forEach((r, i) => { dummy.position.set(r.x, r.y, r.z); dummy.rotation.set(0, r.yaw, 0); dummy.scale.set(1, 1, r.len); dummy.updateMatrix(); rails.setMatrixAt(i, dummy.matrix); });
  dummy.scale.set(1, 1, 1);
  const reeds = mkInst(new THREE.ConeGeometry(0.05, 1.3, 4), reedPts.length, 0xffffff, false);
  reedPts.forEach((p, i) => { const k = 0.7 + rnd() * 0.8; dummy.position.set(p.x, 0.6 * k, p.z); dummy.rotation.set((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3); dummy.scale.setScalar(k); dummy.updateMatrix(); reeds.setMatrixAt(i, dummy.matrix); reeds.setColorAt(i, new THREE.Color([0xb8a95a, 0x9bb05a, 0xc9b96a][i % 3])); });
  dummy.scale.set(1, 1, 1);

  const rockPts = [];
  for (let i = 0; i < 80; i++) { // boulders on the river banks and round the pond
    if (i < 56) { const q = river.s[(rnd() * river.s.length) | 0], side = rnd() > 0.5 ? 1 : -1, off = RIVER_W / 2 + 0.8 + rnd() * 2; rockPts.push({ x: q.p.x + q.n.x * side * off, z: q.p.z + q.n.z * side * off }); }
    else { const a = rnd() * 6.3; rockPts.push({ x: POND.x + Math.cos(a) * (POND.r + 0.3), z: POND.z + Math.sin(a) * (POND.r + 0.3) }); }
  }
  const rocks = mkInst(new THREE.DodecahedronGeometry(0.5, 0), rockPts.length, 0xffffff);
  rockPts.forEach((p, i) => { dummy.position.set(p.x, 0.12, p.z); dummy.rotation.set(rnd(), rnd() * 6, rnd()); dummy.scale.set(0.6 + rnd(), 0.4 + rnd() * 0.5, 0.6 + rnd()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); rocks.setColorAt(i, new THREE.Color([0x9aa0a8, 0x8a909a, 0xb1b6bd][i % 3])); });
  dummy.scale.set(1, 1, 1);

  const lilies = mkInst(new THREE.CircleGeometry(0.38, 10), 16, 0x3d9a55, false); // lily pads floating on the pond
  for (let i = 0; i < 16; i++) { const a = rnd() * 6.3, d = Math.sqrt(rnd()) * (POND.r - 2.5), s = 0.7 + rnd() * 0.7; dummy.position.set(POND.x + Math.cos(a) * d, 0.064, POND.z + Math.sin(a) * d); dummy.rotation.set(-Math.PI / 2, 0, rnd() * 6); dummy.scale.set(s, s, 1); dummy.updateMatrix(); lilies.setMatrixAt(i, dummy.matrix); }
  dummy.scale.set(1, 1, 1);

  const flowerPts = [];
  const beds = [...stops.map((s) => ({ x: s.x - s.c * 10, z: s.z - s.s * 10, r: 2.4 })), { x: POND.x - 6, z: POND.z + 12, r: 3 }, { x: 15, z: 28, r: 2.6 }, { x: -13, z: 30, r: 2.6 }];
  for (const bd of beds) scatter(22, 0.45, (x, z) => flowerPts.push({ x, z }), false, { at: bd }); // flower beds, rather than flowers sprinkled everywhere
  scatter(50, 0.5, (x, z) => flowerPts.push({ x, z }), false, { d: [16, 100] });
  const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), lambert(0xffffff), flowerPts.length);
  flowerPts.forEach((f, i) => { dummy.position.set(f.x, 0.22, f.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); flowers.setMatrixAt(i, dummy.matrix); flowers.setColorAt(i, new THREE.Color(PETALS[(rnd() * 5) | 0])); });
  scene.add(flowers);

  /* ---------- people & birds ---------- */
  const makeWalker = (shirt) => {
    const g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    box(0.42, 0.72, 0.28, shirt, 0, 1.05, 0, body);
    add(new THREE.SphereGeometry(0.2, 8, 6), 0xf2c9a0, 0, 1.6, 0, body);
    const legs = [-0.11, 0.11].map((x) => {
      const p = new THREE.Group();
      p.position.set(x, 0.7, 0);
      box(0.15, 0.7, 0.17, 0x2b3550, 0, -0.35, 0, p);
      g.add(p);
      return p;
    });
    return { g, body, legs };
  };
  const walkers = [];
  const walkPath = (cx, cz, r, dir, th, v = 1.3) => walkers.push({ ...makeWalker(SHIRTS[walkers.length % SHIRTS.length]), cx, cz, r, dir, th, v, ph: rnd() * 6 });
  walkPath(0, 0, RB_R + SW * 0.55, 1, 0);
  stops.forEach((s, i) => walkPath(s.x, s.z, PLAZA_R + 1.7, i % 2 ? -1 : 1, i * 2, 1.1));
  walkPath(POND.x, POND.z, POND.r + 3, 1, 1, 1);
  for (const w of walkers) scene.add(w.g);

  const gulls = Array.from({ length: 8 }, () => {
    const g = new THREE.Group();
    box(0.3, 0.16, 0.7, 0xffffff, 0, 0, 0, g);
    const wings = [-1, 1].map((e) => { const p = new THREE.Group(); p.position.x = e * 0.12; box(1.1, 0.04, 0.32, 0xf4f7fc, e * 0.55, 0, 0, p); g.add(p); return { p, e }; });
    scene.add(g);
    return { g, wings, cx: (rnd() - 0.5) * 60, cz: (rnd() - 0.5) * 60, r: 14 + rnd() * 28, y: 11 + rnd() * 6, th: rnd() * 6.3, v: 0.12 + rnd() * 0.1, ph: rnd() * 6 };
  });

  /* ---------- clouds (shadows only: they sit between camera and ground) ---------- */
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, colorWrite: false, depthWrite: false });
  const clouds = [];
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = add(new THREE.SphereGeometry(2.4 + rnd() * 1.6, 8, 6), cloudMat, k * 2.6 - 4, rnd() * 0.8, rnd() * 2 - 1, c); b.scale.y = 0.55; }
    c.position.set(-120 + i * 32, 24 + rnd() * 6, -80 + rnd() * 160);
    scene.add(c);
    clouds.push({ c, v: 1 + rnd() * 1.2 });
  }

  /* ---------- player & traffic ---------- */
  const player = makeCar(0x2f66d6, { kind: 'sport', player: true });
  scene.add(player.group);
  let carY = ROAD_Y - 0.01;
  const boostLight = new THREE.PointLight(0xff8a2b, 0, 9, 2); // orange wash on the road behind the car while boosting
  boostLight.position.set(0, 0.7, -2.8);
  player.group.add(boostLight);
  const spot = new THREE.SpotLight(0xfff0c8, 0, 40, 0.7, 0.6, 1.2);
  spot.position.set(0, 0.9, 1.8);
  spot.target.position.set(0, 0, 9);
  player.group.add(spot, spot.target);
  const flames = [-0.55, 0.55].map((x) => { // boost flames
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 7), new THREE.MeshBasicMaterial({ color: 0xff8a2b, transparent: true, opacity: 0.9, depthWrite: false }));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1, 7), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, depthWrite: false }));
    for (const m of [outer, inner]) { m.rotation.x = -Math.PI / 2; m.visible = false; player.body.add(m); }
    return { outer, inner, x };
  });

  // traffic: two cars circle the roundabout, one shuttles along the entrance road, one along the east road
  const traffic = [
    { S: entrance.S, s: 30, dir: 1, v: 8, color: 0xf5c542 },
    { S: east.S, s: 30, dir: 1, v: 7, color: 0x3fae7a },
  ].map((c, i) => { const car = makeCar(c.color, { kind: i ? 'suv' : 'sedan' }); scene.add(car.group); return { ...car, ...c, x: 0, z: 0, r: 1.5 }; });

  // drift and boost effects: tyre smoke, skid marks on the ground, a glowing flame trail
  const pool = (n, make) => Array.from({ length: n }, () => { const m = make(); m.visible = false; scene.add(m); return { m, life: 0, max: 1, vx: 0, vz: 0 }; });
  const smokes = pool(40, () => new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe9edf4, transparent: true, opacity: 0, depthWrite: false })));
  const sparksTrail = pool(48, () => new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
  const SKIDS = 260;
  const skids = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.01, 0.8), new THREE.MeshBasicMaterial({ color: 0x0d0f15, transparent: true, opacity: 0.38, depthWrite: false }), SKIDS);
  dummy.scale.setScalar(0); dummy.position.set(0, -5, 0); dummy.updateMatrix();
  for (let i = 0; i < SKIDS; i++) skids.setMatrixAt(i, dummy.matrix);
  dummy.scale.set(1, 1, 1);
  skids.frustumCulled = false;
  scene.add(skids);
  let skidNext = 0, skidT = 0, trailT = 0;
  const wpos = new THREE.Vector3();
  const spawn = (list, x, y, z, life, vx, vz) => {
    const p = list.find((q) => q.life <= 0);
    if (!p) return;
    p.m.position.set(x, y, z); p.life = p.max = life; p.vx = vx; p.vz = vz; p.m.visible = true;
  };

  // a few traffic cones in the car park: knock them over and they tumble, settle, and pop back after a while
  const mkColor = (g, r, gg, b) => { const n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.set([r, gg, b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
  const coneGeo = mergeGeometries([
    mkColor(new THREE.ConeGeometry(0.28, 0.8, 10).translate(0, 0.45, 0), 1, 0.42, 0.1),
    mkColor(new THREE.CylinderGeometry(0.15, 0.19, 0.16, 10).translate(0, 0.5, 0), 1, 1, 1),
    mkColor(new THREE.BoxGeometry(0.62, 0.06, 0.62).translate(0, 0.03, 0), 0.12, 0.12, 0.15),
  ]);
  const coneHomes = Array.from({ length: 6 }, (_, k) => ({ x: park.x - 8 + k * 2.4, z: park.z - 1.3 }));
  const trafficCones = coneHomes.map((h) => ({ ...h, hx: h.x, hz: h.z, y: 0, vx: 0, vy: 0, vz: 0, tilt: 0, yaw: 0, spin: 0, state: 'rest', t: 0, s: 1 }));
  const coneMesh = mkInst(coneGeo, trafficCones.length, 0xffffff, true);
  coneMesh.frustumCulled = false;

  const puffs = Array.from({ length: 16 }, () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return { m, life: 0 };
  });
  let puffT = 0;

  /* ---------- rain ---------- */
  const DROPS_RAIN = 1800, rainBase = [];
  const rainPos = new Float32Array(DROPS_RAIN * 6);
  for (let i = 0; i < DROPS_RAIN; i++) rainBase.push({ x: (Math.random() - 0.5) * 120, y: Math.random() * 40, z: (Math.random() - 0.5) * 120 });
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0, depthWrite: false });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.frustumCulled = false;
  scene.add(rainLines);

  /* ---------- day / night / weather ---------- */
  const night = { on: false, t: 0 }, weather = { on: false, t: 0 };
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  const mix = (target, day, ni, rain) => {
    target.set(day).lerp(tmpA.set(ni), night.t);
    if (rain != null) target.lerp(tmpB.set(rain), weather.t * (1 - night.t * 0.5));
  };
  function applyLight() {
    const t = night.t, w = weather.t;
    mix(skyMat.uniforms.top.value, DAY.skyTop, NIGHT.skyTop, RAIN.skyTop);
    mix(skyMat.uniforms.bot.value, DAY.fog, NIGHT.fog, RAIN.fog);
    mix(scene.fog.color, DAY.fog, NIGHT.fog, RAIN.fog);
    scene.fog.near = lerp(160, 70, w); scene.fog.far = lerp(420, 200, w);
    mix(mountMat.color, DAY.mount, NIGHT.mount);
    mix(hemi.color, DAY.hemiSky, NIGHT.hemiSky);
    mix(hemi.groundColor, DAY.hemiGround, NIGHT.hemiGround);
    hemi.intensity = lerp(DAY.hemi, NIGHT.hemi, t) * (1 - 0.28 * w);
    mix(sun.color, DAY.sun, NIGHT.sun);
    sun.intensity = lerp(DAY.sunI, NIGHT.sunI, t) * (1 - 0.65 * w);
    sunDisc.visible = t < 0.5 && w < 0.5; moonDisc.visible = t >= 0.5;
    starMat.opacity = Math.max(0, t * 1.2 - 0.2) * (1 - w);
    mix(headMat.color, 0xdfe6f2, 0xfff0b8);
    npcHead.color.setHex(0xfff6cf).multiplyScalar(1 + t * 1.6); // every car turns its lights on at night
    npcTail.color.setHex(0x8a2a2a).multiplyScalar(1 + t * 0.8);
    headMat.color.multiplyScalar(1 + t * 1.4); // above 1 so the bloom pass makes the lamps glow
    const envI = lerp(1, 0.22, t) * (1 - 0.4 * w);
    for (const m of shiny) m.envMapIntensity = envI;
    haloMat.opacity = t * 0.75;
    spot.intensity = t * 2.4;
    rainMat.opacity = w * 0.45;
    rainLines.visible = w > 0.02;
  }

  /* ---------- self-driving route ---------- */
  const wrapPi = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  function nearestOn(S, x, z) {
    let bi = 0, bd = Infinity;
    S.s.forEach((q, i) => { const d = Math.hypot(q.p.x - x, q.p.z - z); if (d < bd) { bd = d; bi = i; } });
    return { i: bi, d: bd };
  }
  function route(P, dest) {
    const wp = [];
    const destArm = dest.kind === 'park' ? entrance : arms.find((a) => a.kind === 'spoke' && Math.abs(wrapPi(a.ang - dest.stop.a)) < 1e-6);
    const endIdx = dest.kind === 'park' ? nearestOn(entrance.S, 2.5, 44).i : destArm.S.s.length - 1;
    const here = Math.hypot(P.x, P.z) < RB_R + 2;
    let near = null;
    for (const a of arms) { const m = nearestOn(a.S, P.x, P.z); if (!near || m.d < near.d) near = { arm: a, ...m }; }
    const tail = () => {
      if (dest.kind === 'park') for (const [x, z] of [[-6, 44.5], [-15, 46], [freeBay.x + 5, 49.5], [freeBay.x + 1.2, freeBay.z]]) wp.push({ x, z });
      else wp.push({ x: dest.stop.x, z: dest.stop.z });
    };
    const finish = (arm, from) => {
      for (let i = from; i <= endIdx; i += 2) wp.push({ x: arm.S.s[i].p.x, z: arm.S.s[i].p.z });
      tail();
    };
    if (!here && dest.kind === 'park' && near.arm === entrance && near.d < 8 && near.i > endIdx) { // already south of the turn-off
      for (let i = near.i; i >= endIdx; i -= 2) wp.push({ x: entrance.S.s[i].p.x, z: entrance.S.s[i].p.z });
      tail();
      return wp;
    }
    if (!here && near.arm === destArm && near.i <= endIdx && near.d < 8) { finish(destArm, near.i); return wp; }
    let startAng = Math.atan2(P.z, P.x);
    if (!here) {
      for (let i = near.i; i >= 0; i -= 2) wp.push({ x: near.arm.S.s[i].p.x, z: near.arm.S.s[i].p.z });
      startAng = near.arm.ang;
    }
    const delta = wrapPi(destArm.ang - startAng), steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.3));
    for (let k = 1; k <= steps; k++) { const a = startAng + (delta * k) / steps; wp.push({ x: Math.cos(a) * 9.4, z: Math.sin(a) * 9.4 }); }
    finish(destArm, 0);
    return wp;
  }

  /* ---------- per-frame ---------- */
  const rear = new THREE.Vector3();
  function carVisuals(car, speed, steer, dt) {
    for (const w of car.wheels) { w.spin.rotation.x += (speed * dt) / 0.42; if (w.front) w.pivot.rotation.y = steer * 0.45; }
  }
  function update(dt, time, P, activeStop, focus) {
    night.t += (night.on ? 1 - night.t : -night.t) * (1 - Math.exp(-3 * dt));
    weather.t += (weather.on ? 1 - weather.t : -weather.t) * (1 - Math.exp(-1.5 * dt));
    applyLight();
    // the shadow map follows the camera, snapped to its texel grid so shadows do not shimmer as it moves
    const texel = 104 / SHADOW;
    sun.target.position.copy(sunR).multiplyScalar(Math.round(focus.dot(sunR) / texel) * texel)
      .addScaledVector(sunU, Math.round(focus.dot(sunU) / texel) * texel)
      .addScaledVector(sunF, focus.dot(sunF));
    sun.position.copy(sun.target.position).add(SUN_OFF);
    waterTex.offset.x -= dt * 0.05;

    // player car
    const fast = Math.min(1, Math.abs(P.speed) / 8);
    const hop = P.hop > 0 ? Math.sin((1 - P.hop / 0.55) * Math.PI) * 0.9 : 0;
    const onPlaza = stops.some((s) => Math.hypot(P.x - s.x, P.z - s.z) < PLAZA_R + 0.2);
    carY += ((onPlaza ? PLAZA_Y : ROAD_Y) - 0.01 - carY) * Math.min(1, dt * 12); // wheels follow the road and the plaza step
    player.group.position.set(P.x, carY, P.z);
    player.group.rotation.y = P.h;
    player.body.position.y = hop + Math.sin(time * 16) * 0.012 * (1 - fast) + Math.sin(time * 70) * 0.02 * P.boost;
    player.body.rotation.z = lerp(player.body.rotation.z, -P.steer * fast * 0.08, 0.15);
    player.body.rotation.x = lerp(player.body.rotation.x, -(P.gas + P.boost) * 0.04, 0.12);
    carVisuals(player, P.speed, P.steer, dt);
    const braking = (P.gas < 0 && P.speed > 0.5) || (P.gas > 0 && P.speed < -0.5);
    player.tailMat.color.setHex(braking ? 0xff3b30 : 0x8a2a2a).multiplyScalar(braking ? 1.8 : 1 + night.t * 0.6);
    player.headMat.color.setHex(0xfff6cf).multiplyScalar(1 + night.t * 1.8);
    boostLight.intensity = P.boost * 70;

    // drift: smoke and skid marks from the rear tyres, laid along the way the car is really travelling
    const drifting = (P.drift ?? 0) > 0.35 && Math.abs(P.speed) > 5;
    skidT -= dt;
    if (drifting && skidT <= 0) {
      skidT = 0.04;
      for (const w of player.wheels.slice(2)) {
        w.pivot.getWorldPosition(wpos);
        dummy.position.set(wpos.x, 0.13, wpos.z); dummy.rotation.set(0, P.h + (P.slide ?? 0), 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        skids.setMatrixAt(skidNext++ % SKIDS, dummy.matrix);
        spawn(smokes, wpos.x, 0.25, wpos.z, 1.1, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2);
      }
      skids.instanceMatrix.needsUpdate = true;
    }
    trailT -= dt;
    if (P.boost > 0.3 && trailT <= 0) { // a trail of embers behind the exhausts
      trailT = 0.018;
      for (const sx of [-0.5, 0.5]) {
        rear.set(sx, 0.4, -2.35).applyMatrix4(player.group.matrixWorld);
        spawn(sparksTrail, rear.x, rear.y, rear.z, 0.4, -Math.sin(P.h) * 4 + (Math.random() - 0.5), -Math.cos(P.h) * 4 + (Math.random() - 0.5));
      }
    }
    for (const p of smokes) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt; p.m.position.y += dt * 0.7;
      p.m.scale.setScalar(0.6 + k * 2.6);
      p.m.material.opacity = (1 - k) * 0.5;
      if (p.life <= 0) p.m.visible = false;
    }
    for (const p of sparksTrail) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt;
      p.m.scale.setScalar(Math.max(0.05, 1 - k));
      p.m.material.opacity = (1 - k) * 0.9;
      if (p.life <= 0) p.m.visible = false;
    }
    for (const f of flames) {
      const on = P.boost > 0.05, len = (0.5 + 2.2 * P.boost) * (0.8 + 0.2 * Math.sin(time * 70 + f.x * 9));
      f.outer.visible = f.inner.visible = on;
      f.outer.scale.set(1, len, 1); f.outer.position.set(f.x, 0.4, -2.28 - len / 2);
      f.inner.scale.set(1, len * 0.6, 1); f.inner.position.set(f.x, 0.4, -2.28 - len * 0.3);
    }

    // exhaust puffs
    puffT -= dt;
    if (puffT <= 0) {
      puffT = P.boost > 0.2 ? 0.04 : P.gas > 0 ? 0.09 : 0.65;
      const p = puffs.find((q) => q.life <= 0);
      if (p) { rear.set(0.5, 0.38, -2.3).applyMatrix4(player.group.matrixWorld); p.m.position.copy(rear); p.life = p.max = 0.9; p.m.visible = true; }
    }
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.m.position.y += dt * 0.8;
      p.m.scale.setScalar(0.5 + k * 2);
      p.m.material.opacity = (1 - k) * (P.gas > 0 || P.boost > 0.2 ? 0.5 : 0.3);
      if (p.life <= 0) p.m.visible = false;
    }

    // street lights: knocked over by the car, sparks, flicker at night
    let broken = 0;
    if (night.t > 0.5 && (flickT -= dt) <= 0) {
      flickT = 3 + Math.random() * 5;
      const l = lamps[(Math.random() * lamps.length) | 0];
      if (l.state === 'ok') l.flick = 0.6;
    }
    for (const l of lamps) {
      if (l.state === 'ok') {
        const dx = l.x - P.x, dz = l.z - P.z, d = Math.hypot(dx, dz) || 1;
        if (d < 1.45) {
          if (Math.abs(P.speed) > 2.5) { breakLamp(l, dx / d, dz / d); P.speed *= 0.82; broken++; placeLamp(l); }
          else { P.x = l.x - (dx / d) * 1.45; P.z = l.z - (dz / d) * 1.45; }
        } else if (l.flick > 0) {
          l.flick -= dt;
          placeLamp(l, l.flick <= 0 || Math.floor(time * 14) % 2 === 0);
        }
      } else if (l.state === 'falling') {
        l.fall += dt / 0.7;
        if (l.fall >= 1) { l.fall = 1; l.state = 'broken'; emitSparks(l.hx, l.hy + 0.2, l.hz, 10); }
        placeLamp(l);
      } else if (l.sparks > 0 && (l.sparkT -= dt) <= 0) {
        emitSparks(l.hx, l.hy + 0.2, l.hz, 5);
        l.sparks--; l.sparkT = 0.8 + Math.random() * 1.8;
      }
    }
    if (lampsDirty) {
      poles.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = halos.instanceMatrix.needsUpdate = heads.instanceColor.needsUpdate = true;
      lampsDirty = false;
    }
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 14 * dt;
      for (let a = 0; a < 3; a++) sparkPos[i * 3 + a] += sparkVel[i * 3 + a] * dt;
      if (sparkPos[i * 3 + 1] < 0.1) { sparkPos[i * 3 + 1] = 0.1; sparkVel.fill(0, i * 3, i * 3 + 3); }
      if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -100;
    }
    sparkGeo.attributes.position.needsUpdate = true;

    // traffic
    for (const c of traffic) {
      if (c.loop) {
        c.th += (c.dir * c.v * dt) / c.lane;
        c.x = Math.cos(c.th) * c.lane; c.z = Math.sin(c.th) * c.lane;
        c.group.rotation.y = -c.th;
      } else {
        c.s += c.dir * c.v * dt;
        if (c.s > c.S.len - 6) c.dir = -1; else if (c.s < 14) c.dir = 1;
        const q = at(c.S, c.s), off = 1.8 * c.dir;
        c.x = q.p.x + q.n.x * off; c.z = q.p.z + q.n.z * off;
        c.group.rotation.y = yawOf(q) + (c.dir > 0 ? 0 : Math.PI);
      }
      c.group.position.set(c.x, ROAD_Y - 0.01, c.z);
      carVisuals(c, c.v, 0, dt);
    }

    // the train loops along its track
    trainU = (trainU + (14 * dt) / rail.len) % 1;
    train.forEach((g, i) => {
      const u = (trainU - (i * 9.8) / rail.len + 1) % 1, p = rail.curve.getPointAt(u), t = rail.curve.getTangentAt(u);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = Math.atan2(t.x, t.z);
    });

    // pedestrians and birds
    for (const w of walkers) {
      w.th += (w.dir * w.v * dt) / w.r;
      w.g.position.set(w.cx + Math.cos(w.th) * w.r, 0, w.cz + Math.sin(w.th) * w.r);
      w.g.rotation.y = w.dir > 0 ? -w.th : Math.PI - w.th;
      const sw = Math.sin(time * 6 * w.v + w.ph);
      w.legs[0].rotation.x = sw * 0.55; w.legs[1].rotation.x = -sw * 0.55;
      w.body.position.y = Math.abs(sw) * 0.05;
      if (w.jump > 0) { w.jump -= dt; w.body.position.y += Math.sin((1 - w.jump / 0.55) * Math.PI) * 0.7; } // startled by the horn
    }
    for (const b of gulls) {
      b.th += b.v * dt;
      b.g.position.set(b.cx + Math.cos(b.th) * b.r, b.y + Math.sin(time * 0.7 + b.ph) * 0.8, b.cz + Math.sin(b.th) * b.r);
      b.g.rotation.y = -b.th;
      b.g.rotation.z = -0.25;
      for (const w of b.wings) w.p.rotation.z = w.e * Math.sin(time * 9 + b.ph) * 0.6;
    }

    // fountain
    const pos = dropGeo.attributes.position;
    drops.forEach((d, i) => {
      const t = ((time * 0.9 + d.ph) % 1) * T, vr = d.r / T;
      pos.setXYZ(i, Math.cos(d.ang) * vr * t, 1.7 + 4.8 * t - 4.9 * t * t, Math.sin(d.ang) * vr * t);
    });
    pos.needsUpdate = true;

    // rain falls in a box that follows the car
    if (rainLines.visible) {
      rainLines.position.set(focus.x, 0, focus.z);
      for (let i = 0; i < DROPS_RAIN; i++) {
        const d = rainBase[i];
        d.y -= 38 * dt;
        if (d.y < 0) d.y += 40;
        rainPos.set([d.x, d.y, d.z, d.x + 0.2, d.y + 1.3, d.z], i * 6);
      }
      rainGeo.attributes.position.needsUpdate = true;
    }

    for (const r of turbines) r.rotation.z += dt * 1.1;
    for (const d of ducks) {
      d.th += d.v * dt;
      d.g.position.set(POND.x + Math.cos(d.th) * d.r, 0.06 + Math.sin(time * 2 + d.ph) * 0.015, POND.z + Math.sin(d.th) * d.r);
      d.g.rotation.y = d.v > 0 ? -d.th : Math.PI - d.th;
    }
    boat.position.y = 0.12 + Math.sin(time * 1.6) * 0.04;
    boat.rotation.z = Math.sin(time * 1.3) * 0.04;
    sail.rotation.y = Math.sin(time * 0.8) * 0.15;
    swirl.rotation.z -= dt * 1.6;
    frame.rotation.z += dt * 0.3;
    for (const c of clouds) { c.c.position.x += c.v * dt; if (c.c.position.x > 130) c.c.position.x = -130; }
    for (const s of stops) {
      const on = activeStop === s;
      s.ring.scale.setScalar(1 + Math.sin(time * 4 + s.i) * (on ? 0.05 : 0.015));
      s.beacon.material.opacity = (s.found ? 0.07 : 0.2) + Math.sin(time * 2.4 + s.i) * 0.05;
    }
    const events = { broken, cones: 0 };

    // cones: knocked into the air by the car, tumble, settle, then pop back to where they started
    dummy.rotation.order = 'YXZ';
    trafficCones.forEach((c, i) => {
      if (c.state === 'rest') {
        const dx = c.x - P.x, dz = c.z - P.z;
        if (dx * dx + dz * dz < 2.4 && Math.abs(P.speed) > 1.5) {
          const d = Math.hypot(dx, dz) || 1, hd = P.h + (P.slide ?? 0), sg = Math.sign(P.speed), sp = Math.abs(P.speed) * 0.9 + 3;
          c.vx = ((dx / d) * 0.5 + Math.sin(hd) * sg * 0.5) * sp; c.vz = ((dz / d) * 0.5 + Math.cos(hd) * sg * 0.5) * sp;
          c.vy = 3 + Math.abs(P.speed) * 0.25; c.spin = (Math.random() - 0.5) * 10; c.yaw = Math.atan2(c.vx, c.vz); c.t = 0; c.state = 'fly';
          events.cones++;
          P.speed *= 0.985;
        }
      } else if (c.state === 'fly') {
        c.vy -= 22 * dt; c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
        if (c.y <= 0) { c.y = 0; c.vy = c.vy < -1.5 ? -c.vy * 0.38 : 0; const f = Math.exp(-2.2 * dt); c.vx *= f; c.vz *= f; }
        c.tilt += (1.45 - c.tilt) * Math.min(1, dt * 6);
        c.yaw += c.spin * dt; c.spin *= Math.exp(-1.5 * dt);
        if (c.y === 0 && Math.hypot(c.vx, c.vz) < 0.4) { c.t += dt; if (c.t > 6) { c.state = 'wait'; c.t = 14; } }
      } else if (c.state === 'wait') {
        c.s += (0 - c.s) * Math.min(1, dt * 8);
        if ((c.t -= dt) <= 0) { c.x = c.hx; c.z = c.hz; c.y = 0; c.tilt = 0; c.yaw = 0; c.state = 'respawn'; }
      } else { // respawn
        c.s += (1 - c.s) * Math.min(1, dt * 6);
        if (c.s > 0.97) { c.s = 1; c.state = 'rest'; }
      }
      dummy.position.set(c.x, c.y, c.z); dummy.rotation.set(c.tilt, c.yaw, 0); dummy.scale.setScalar(Math.max(0.001, c.s)); dummy.updateMatrix();
      coneMesh.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.order = 'XYZ';
    dummy.scale.set(1, 1, 1);
    coneMesh.instanceMatrix.needsUpdate = true;
    return events;
  }

  function repairLamps() {
    for (const l of lamps) { l.state = 'ok'; l.fall = 0; l.flick = 0; placeLamp(l); }
    lampsBroken = 0;
  }

  return {
    scene, stops, obstacles, traffic, shapes, route,
    start: { x: 0, z: 24, h: Math.PI },
    park: { x: -28, z: 48, free: bayFree, total: 20, label: 'Car park' },
    setNight: (on) => { night.on = on; },
    nightLevel: () => night.t,
    honk(P) { for (const w of walkers) if (Math.hypot(w.g.position.x - P.x, w.g.position.z - P.z) < 16) w.jump = 0.55; },
    setRain: (on) => { weather.on = on; },
    setFound(s, on) {
      s.found = on;
      s.ring.material.color.setHex(on ? 0x2fb36b : 0x2f66d6);
      s.beacon.material.color.setHex(on ? 0x2fb36b : 0x2f66d6);
    },
    setEnvironment(tex) { for (const m of shiny) { m.envMap = tex; m.needsUpdate = true; } },
    brokenLamps: () => lampsBroken,
    repairLamps,
    update,
  };
}
