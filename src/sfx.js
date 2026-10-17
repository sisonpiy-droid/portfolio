// Sound effects, synthesised with the Web Audio API (no audio files). Browsers only allow sound after a user gesture,
// so nothing is created until init() is called from a click or key press.
let ctx = null, master = null, noise = null, screech = null, whoosh = null, enabled = true;

function init() {
  if (ctx) { ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  master = ctx.createGain();
  master.gain.value = enabled ? 0.55 : 0;
  master.connect(ctx.destination);
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noise = buf;
  const loop = (type, freq, q) => { // a looping noise source whose volume we ride
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return { g, f };
  };
  screech = loop('bandpass', 1900, 5);
  whoosh = loop('lowpass', 500, 0.7);
}

function tone(freq, dur, type = 'sine', vol = 0.25, slideTo = null, delay = 0) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function burst(freq, dur, vol = 0.3, type = 'lowpass') { // a short puff of filtered noise
  if (!ctx || !enabled) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const ride = (node, level, max, rate = 0.08) => { // only touch the audio graph when the level actually moved
  if (!node || !ctx || Math.abs((node.last ?? -1) - level) < 0.02) return;
  node.last = level;
  node.g.gain.setTargetAtTime(enabled ? level * max : 0, ctx.currentTime, rate);
};

export const sfx = {
  init,
  setEnabled(on) { enabled = on; if (master) master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05); },
  cone() { burst(900, 0.12, 0.25, 'bandpass'); tone(300, 0.1, 'triangle', 0.15, 120); },
  hit() { burst(500, 0.22, 0.4); tone(110, 0.18, 'sine', 0.35, 50); },
  lamp() { burst(1200, 0.35, 0.3, 'highpass'); tone(190, 0.25, 'sawtooth', 0.12, 60); },
  horn() { tone(392, 0.4, 'square', 0.08); tone(311, 0.4, 'square', 0.08); },
  drift(level) { ride(screech, level, 0.22, 0.06); },
  boost(level) { ride(whoosh, level, 0.28, 0.1); },
};
