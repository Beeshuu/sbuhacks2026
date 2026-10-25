// Sound effects, all synthesised with the Web Audio API from tones and filtered noise: no recordings and
// no voices. Muting is remembered in this browser. Nothing plays until the first click or key press.
const Sound = (() => {
  const KEY = 'logical-steam-muted';
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked: start with sound on */ }
  let ac = null;
  let master = null;
  let engine = null;
  let noiseBuf = null;

  // The audio context, created on first use and resumed if the browser suspended it; null when muted.
  function ready() {
    if (muted) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function noise() {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    return src;
  }

  // A gain that rises in 10 ms, then dies away over `len` seconds.
  function envelope(peak, len, at) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    g.connect(master);
    return g;
  }

  // A tone sliding from f0 to f1 Hz.
  function tone(type, f0, f1, peak, len, delay = 0) {
    const at = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + len);
    o.connect(envelope(peak, len, at));
    o.start(at);
    o.stop(at + len + 0.05);
  }

  // Noise through a filter sweeping from f0 to f1 Hz: splashes, thuds, hisses and scrapes.
  function hiss(type, f0, f1, q, peak, len, delay = 0) {
    const at = ac.currentTime + delay;
    const src = noise();
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, at + len);
    src.connect(f).connect(envelope(peak, len, at));
    src.start(at, Math.random());
    src.stop(at + len + 0.05);
  }

  const play = (fn) => () => { if (ready()) fn(); };
  const fx = {
    click: play(() => { tone('square', 1800, 900, 0.04, 0.04); hiss('bandpass', 3200, 3200, 2, 0.05, 0.03); }), // a brass switch
    tick: play(() => tone('sine', 880, 880, 0.15, 0.12)),
    whistle: play(() => { // a steam whistle: a three-note chord with a breath of steam
      for (const f of [523, 659, 784]) tone('sine', f, f * 0.98, 0.07, 0.9);
      hiss('bandpass', 2600, 2000, 1.5, 0.05, 0.9);
    }),
    crate: play(() => { tone('triangle', 180, 70, 0.4, 0.18); hiss('bandpass', 900, 500, 3, 0.35, 0.15); }),
    rock: play(() => { tone('sine', 90, 40, 0.6, 0.35); hiss('lowpass', 1200, 200, 1, 0.5, 0.4); }),
    wave: play(() => { hiss('highpass', 400, 2500, 0.7, 0.4, 0.7); hiss('lowpass', 600, 300, 1, 0.3, 0.6); }),
    sink: play(() => { tone('sine', 220, 35, 0.5, 1.6); hiss('lowpass', 900, 120, 1, 0.4, 1.6); }),
    bell: play(() => { for (const d of [0, 0.25]) { tone('sine', 988, 988, 0.12, 0.25, d); tone('sine', 1319, 1319, 0.06, 0.25, d); } }),
    fixed: play(() => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.12, 0.25, i * 0.07))),
    failed: play(() => tone('sawtooth', 160, 90, 0.1, 0.5)),
    scrape: play(() => hiss('bandpass', 1800, 1200, 4, 0.12, 0.25)),
  };

  // The engine's chuff: filtered noise pulsed by a slow oscillator, plus a low hum. Both speed up with the
  // boat. Pass null to stop it.
  function setEngine(pct) {
    if (pct === null || !ready()) {
      if (engine) { engine.out.gain.setTargetAtTime(0, ac.currentTime, 0.05); }
      return;
    }
    if (!engine) {
      const out = ac.createGain();
      out.gain.value = 0;
      out.connect(master);
      const src = noise();
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 260;
      const chuff = ac.createGain();
      chuff.gain.value = 0.12;
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      depth.gain.value = 0.12;
      lfo.connect(depth).connect(chuff.gain);
      src.connect(band).connect(chuff).connect(out);
      const hum = ac.createOscillator();
      hum.type = 'triangle';
      const humGain = ac.createGain();
      humGain.gain.value = 0.05;
      hum.connect(humGain).connect(out);
      src.start();
      lfo.start();
      hum.start();
      engine = { out, lfo, hum };
    }
    const now = ac.currentTime;
    engine.out.gain.setTargetAtTime(0.6, now, 0.1);
    engine.lfo.frequency.setTargetAtTime(1.5 + pct * 7, now, 0.1);
    engine.hum.frequency.setTargetAtTime(45 + pct * 30, now, 0.1);
  }

  function setMuted(on) {
    muted = on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* it just won't be remembered */ }
    if (ac) on ? ac.suspend() : ac.resume();
  }

  // Every button clicks; radio cards click when picked.
  document.addEventListener('click', (e) => { if (e.target.closest('button')) fx.click(); });
  document.addEventListener('change', (e) => { if (e.target.matches('input[type="radio"]')) fx.click(); });

  return { fx, setEngine, setMuted, get muted() { return muted; } };
})();
