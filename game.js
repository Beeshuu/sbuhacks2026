// The endless run: a chase view from behind the locomotive, drawn segment by segment on a canvas
// (the pseudo-3D method of classic arcade racers). Uses Workshop (app.js) for engine faults
// and Chain (solana.js) for the devnet leaderboard.
// Wrapped in a function so its names (update, say, ...) don't collide with app.js.
(() => {

const SEG = 200; // one track segment in world units; shown to the player as 1 metre
const ROAD = 1600; // half-width of the track bed; about the screen width at the bottom edge
const CAM_H = 1400;
const DEPTH = 0.84; // camera depth, roughly a 100 degree field of view
const DRAW = 170; // segments drawn ahead
const RING = 600; // segments kept in memory; older ones are rewritten ahead of the train
const AHEAD = CAM_H * DEPTH; // the train's front sits this far in front of the camera
const LANES = [-0.66, 0, 0.66];
const GAP_MAX = 120; // metres: the furthest the monster falls behind
const HIT_RANGE = 0.42; // obstacle half-width plus train half-width, in track half-widths
const FAULT_EVERY = [750, 1500]; // metres between engine faults, on every difficulty
const FAULT_WARN = 200; // metres of warning before a fault
const COUNTDOWN = 3; // seconds before the train moves again after a repair
const MPH_PER_UNIT = 2.23694 / SEG; // world units per second to miles per hour (1 segment = 1 metre)
const MPH_MAX = 120; // top of the speedometer dial; Hard tops out near 112 mph

// Every number a player feels comes from here. Keep pull * curve below 1 so full steering always beats a bend:
// at the sharpest bend that ratio is 0.45 (Easy), 0.6 (Medium) and 0.7 (Hard).
const MODES = {
  easy: { label: 'Easy', maxSpeed: 7000, monster: 0.74, curve: 3, obstacles: 0.015, pull: 0.15, repair: 40, plates: [0, 1, 2, 3] },
  medium: { label: 'Medium', maxSpeed: 8500, monster: 0.82, curve: 5, obstacles: 0.022, pull: 0.12, repair: 32, plates: [2, 3, 4, 5, 6] },
  hard: { label: 'Hard', maxSpeed: 10000, monster: 0.88, curve: 7, obstacles: 0.03, pull: 0.1, repair: 26, plates: [5, 6, 7, 8, 9, 10] },
};

const C = { ink: '#2b2118', ink2: '#5a4630', brass: '#8a6420', face: '#f8f2e4', plate: '#e8dcc0', paper: '#f1e9d6', rule: '#cdb98d' };
const BEST_KEY = 'steel-junction-best';
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
}
function saveBest(best) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* blocked storage: best distance lasts this visit only */ }
}

const canvas = el('view');
const ctx = canvas.getContext('2d');
const keys = { left: false, right: false };
let run = null;
let raf = 0;
let last = 0;
let mirrorTop = 0; // canvas pixels: the top of the mirror glass (see placeMirror)
const MIRROR_LABEL = 30; // CSS pixels kept above the mirror for its distance label

// ---- Track generation -------------------------------------------------------

function newRun(mode, category) {
  const cfg = MODES[mode];
  run = {
    mode, cfg, category, bag: [],
    z: 0, x: 0, speed: cfg.maxSpeed * 0.5, gap: 60, time: 0,
    segs: new Array(RING), written: 0, plan: [], lastObstacle: 0,
    faultAt: rand(...FAULT_EVERY), warned: false, countdown: 0, resume: '', turn: 0, repairs: 0, hits: 0,
    paused: null, over: false, shake: 0, callout: null, smoke: [], hills: 0, hud: 0,
  };
  fillTrack();
}

const ease = (a, b, t) => a + (b - a) * (1 - Math.cos(t * Math.PI)) / 2;

// Bends come as sections that ease in, hold, and ease out, so the pull builds up the way it would on rails.
function planSection() {
  const { cfg, plan } = run;
  if (Math.random() < 0.45 || run.written < 80) {
    for (let i = 0, n = Math.floor(rand(25, 60)); i < n; i++) plan.push(0);
    return;
  }
  const curve = (Math.random() < 0.5 ? -1 : 1) * rand(cfg.curve * 0.4, cfg.curve);
  const enter = Math.floor(rand(12, 22));
  const hold = Math.floor(rand(20, 55));
  for (let i = 0; i < enter; i++) plan.push(ease(0, curve, i / enter));
  for (let i = 0; i < hold; i++) plan.push(curve);
  for (let i = 0; i < enter; i++) plan.push(ease(curve, 0, i / enter));
}

function addSegment() {
  if (!run.plan.length) planSection();
  const abs = run.written++;
  const seg = { curve: run.plan.shift(), obstacles: [] };
  // Leave one track clear in every row, and space rows out so there is always time to react.
  if (abs > 70 && abs - run.lastObstacle > 14 && Math.random() < run.cfg.obstacles) {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.3 ? 2 : 1);
    seg.obstacles = lanes.map((l) => ({ x: LANES[l], kind: Math.random() < 0.5 ? 'rock' : 'crate', hit: false }));
    run.lastObstacle = abs;
  }
  // Trees and bushes beside the line, for colour and a sense of speed. Purely visual.
  seg.scenery = Math.random() < 0.14
    ? [{ x: (Math.random() < 0.5 ? -1 : 1) * rand(1.6, 3.4), kind: Math.random() < 0.6 ? 'tree' : 'bush' }]
    : [];
  run.segs[abs % RING] = seg;
}

function fillTrack() {
  const base = Math.floor(run.z / SEG);
  while (run.written < base + RING - 5) addSegment();
}

const segAt = (abs) => run.segs[abs % RING];

// ---- Simulation ------------------------------------------------------------

// Routine hints (bends, steering) never cover an event message that is still showing.
function say(text, seconds = 0.3) {
  const showing = run.callout && run.callout.until > run.time && run.callout.event;
  if (!showing) run.callout = { text, until: run.time + seconds, event: false };
}
function shout(text, seconds = 1.8) {
  run.callout = { text, until: run.time + seconds, event: true };
}
function announce(text) {
  el('drive-live').textContent = text;
}

function update(dt) {
  const { cfg } = run;
  const max = cfg.maxSpeed;
  const pct = run.speed / max;
  run.time += dt;

  const before = Math.floor((run.z + AHEAD) / SEG);
  const seg = segAt(before);
  const turn = dt * 2 * Math.max(pct, 0.35);
  if (keys.left) run.x -= turn;
  if (keys.right) run.x += turn;
  run.x -= turn * pct * seg.curve * cfg.pull; // bends push the train to the outside
  run.x = clamp(run.x, -1.6, 1.6);
  const off = Math.abs(run.x) > 1;

  if (off) run.speed = Math.max(max * 0.3, run.speed - max * 1.2 * dt);
  else run.speed = Math.min(max, run.speed + max * 0.22 * dt);

  run.z += run.speed * dt;
  fillTrack();
  run.hills += seg.curve * pct * dt * 0.02;

  const after = Math.floor((run.z + AHEAD) / SEG);
  for (let a = before; a <= after; a++) {
    for (const ob of segAt(a).obstacles) {
      if (!ob.hit && Math.abs(run.x - ob.x) < HIT_RANGE) {
        ob.hit = true;
        run.hits++;
        run.speed *= 0.35;
        run.shake = 1;
        shout(ob.kind === 'rock' ? 'Hit a rock!' : 'Smashed a crate!');
        announce(`You hit a ${ob.kind}. The train slowed down.`);
      }
    }
  }

  // The monster wakes up over the first 10 seconds, so the run doesn't open with a loss.
  const chase = cfg.monster * max * Math.min(1, run.time / 10);
  run.gap = Math.min(GAP_MAX, run.gap + ((run.speed - chase) / SEG) * dt);
  if (run.gap <= 0) return finish();

  if (off) say('Off the track! Steer back.');
  else if (Math.abs(seg.curve) > 0.5 && Math.abs(run.x) > 0.75 && run.x * seg.curve < 0) say(`Steer ${seg.curve > 0 ? 'right' : 'left'}!`);
  run.turn = 0;
  for (let k = 0; k < 70 && !run.turn; k++) {
    const c = segAt(after + k).curve;
    if (Math.abs(c) > (k ? 0.6 : 0.5)) run.turn = Math.sign(c);
  }
  if (run.gap < 20 && Math.floor(run.time * 2) % 4 === 0) say('It\'s right behind you!', 0.4);

  run.shake = Math.max(0, run.shake - dt * 2.5);
  const metres = run.z / SEG;
  if (!run.warned && run.faultAt - metres < FAULT_WARN) {
    run.warned = true;
    shout('Engine trouble ahead! Get ready.', 2.2);
    announce('Engine trouble ahead. A fault is coming up.');
  }
  if (metres >= run.faultAt) startRepair();
}

// After a repair the train waits for a short countdown; the monster waits too.
function tickCountdown(dt) {
  const shown = Math.ceil(run.countdown);
  run.countdown -= dt;
  if (run.countdown <= 0) {
    run.paused = null;
    shout(run.resume, 1.6);
    hud(); // swap the last number for the message right away, not on the next HUD tick
    canvas.focus();
  } else if (Math.ceil(run.countdown) !== shown) {
    announce(String(Math.ceil(run.countdown)));
  }
}

// While a fault is open everything stops, the monster included. Running out of time costs speed, not distance.
async function startRepair() {
  const { cfg } = run;
  run.paused = 'repair';
  keys.left = keys.right = false;
  announce('Engine fault. Answer the question in the pop-up before the timer runs out.');
  const kind = run.category === 'mixed' ? (Math.random() < 0.5 ? 'circuits' : 'coding') : run.category;
  const plate = cfg.plates[Math.floor(Math.random() * cfg.plates.length)];
  const ok = kind === 'coding' ? await Quiz.repair(nextQuestion(), cfg.repair) : await Workshop.repair(plate, cfg.repair);
  if (run.over) return;
  run.faultAt = run.z / SEG + rand(...FAULT_EVERY);
  run.warned = false;
  last = performance.now();
  if (ok) {
    run.repairs++;
    run.resume = 'Full steam!';
    announce(`Engine fixed. Moving again in ${COUNTDOWN}.`);
  } else {
    run.speed = cfg.maxSpeed * 0.2;
    run.resume = 'The engine is crawling. Get the speed back up!';
    announce(`Out of time. The train will crawl. Moving again in ${COUNTDOWN}.`);
  }
  run.countdown = COUNTDOWN;
  run.paused = 'countdown';
  canvas.focus();
}

// Coding questions come from a shuffled bag for this difficulty, so none repeats until all have been asked.
function nextQuestion() {
  if (!run.bag.length) run.bag = [...CODING[run.mode]].sort(() => Math.random() - 0.5);
  return run.bag.pop();
}

// ---- Drawing ---------------------------------------------------------------

function quad(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

// A strip of track between two projected edges, at `off` across the bed and `half` wide (both in half-widths).
function strip(p1, p2, off, half, color) {
  quad(p1.x + (off - half) * p1.w, p1.y, p1.x + (off + half) * p1.w, p1.y,
    p2.x + (off + half) * p2.w, p2.y, p2.x + (off - half) * p2.w, p2.y, color);
}

// Tall (portrait) screens raise the horizon so more of the track shows below it.
const horizonOf = (w, h) => h * (h > w ? 0.38 : 0.5);

const CLOUDS = [[0.1, 0.22, 1], [0.38, 0.1, 0.7], [0.62, 0.3, 1.2], [0.9, 0.16, 0.8], [1.15, 0.26, 1]];

// A fixed industrial skyline (seeded, so it never changes between frames): towers with lit windows
// and factories with sawtooth roofs and tall chimneys. Positions are fractions of one repeating tile.
const SKYLINE = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let x = 0; x < 1; ) {
    const factory = rnd() < 0.12; // mostly city towers, with the odd factory
    const width = factory ? 0.05 + rnd() * 0.05 : 0.015 + rnd() * 0.025;
    const height = factory ? 0.025 + rnd() * 0.02 : 0.04 + rnd() * 0.08;
    const lights = Array.from({ length: 12 }, () => rnd() < 0.35);
    const stacks = factory ? Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => [0.15 + rnd() * 0.7, 0.05 + rnd() * 0.05]) : [];
    out.push({ x, width, height, factory, lights, stacks });
    x += width + rnd() * 0.012;
  }
  return out;
})();

// Sunset outside the track: indigo to orange sky, a low sun, warm clouds, purple mountains,
// a smoky industrial skyline, dark hills and evening grass.
function drawSky(w, h) {
  const hz = horizonOf(w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#2b2a5c');
  sky.addColorStop(0.45, '#8a3f6b');
  sky.addColorStop(0.8, '#e8734a');
  sky.addColorStop(1, '#f6b26b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hz + 1);

  const sunX = w * 0.68 - run.hills * w * 0.6;
  const sunY = hz - h * 0.06;
  const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.25);
  halo.addColorStop(0, 'rgba(255, 214, 140, 0.75)');
  halo.addColorStop(1, 'rgba(255, 214, 140, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, hz);
  ctx.fillStyle = '#ffd98a';
  ctx.beginPath();
  ctx.arc(sunX, sunY, w * 0.045, 0, Math.PI * 2);
  ctx.fill();

  const span = w * 1.4;
  const drift = run.hills * w * 3 + run.time * w * 0.006;
  for (const [cx, cy, size] of CLOUDS) {
    const x = (((cx * w - drift) % span) + span) % span - w * 0.2;
    const y = cy * hz;
    const r = w * 0.035 * size;
    for (const [dx, dy, k, color] of [[0, 0.15, 1, 'rgba(120, 60, 100, 0.55)'], [0, 0, 1, 'rgba(250, 170, 130, 0.9)'], [1.1, 0.2, 0.8, 'rgba(244, 150, 120, 0.85)'], [-1.1, 0.25, 0.75, 'rgba(244, 150, 120, 0.85)']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x + dx * r, y + dy * r, r * k * 1.3, r * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const ridge = (color, amp, speed, freq) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, hz);
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * freq * Math.PI * 2 + run.hills * speed * 40;
      const r = 0.55 + 0.27 * Math.sin(t) + 0.13 * Math.sin(t * 2.3 + 1) + 0.05 * Math.sin(t * 5.1);
      ctx.lineTo((i / 60) * w, hz - h * amp * r);
    }
    ctx.lineTo(w, hz);
    ctx.fill();
  };
  ridge('#7a5577', 0.13, 0.25, 1.3);
  drawSkyline(w, h, hz);
  ridge('#4a3b3a', 0.035, 1, 3.7);
  ctx.fillStyle = '#5f6e33';
  ctx.fillRect(0, hz, w, h - hz);
}

function drawSkyline(w, h, hz) {
  const tile = w * 1.6;
  const offset = ((run.hills * w * 1.2) % tile + tile) % tile;
  for (const copy of [-1, 0, 1]) {
    for (const b of SKYLINE) {
      const x = b.x * tile - offset + copy * tile;
      const bw = b.width * tile;
      if (x > w || x + bw < 0) continue;
      const top = hz - b.height * h;
      ctx.fillStyle = '#3b2b3e';
      if (b.factory) {
        ctx.beginPath();
        ctx.moveTo(x, hz);
        ctx.lineTo(x, top);
        const teeth = 4;
        for (let i = 0; i < teeth; i++) {
          ctx.lineTo(x + (bw * (i + 1)) / teeth, top - h * 0.012);
          ctx.lineTo(x + (bw * (i + 1)) / teeth, top);
        }
        ctx.lineTo(x + bw, hz);
        ctx.fill();
        for (const [at, tall] of b.stacks) {
          const sx = x + at * bw;
          ctx.fillStyle = '#3b2b3e';
          ctx.fillRect(sx - bw * 0.03, hz - tall * h, bw * 0.06, tall * h);
          // Chimney smoke drifts off to the left and thins out.
          for (let k = 0; k < 4; k++) {
            const t = ((run.time * 0.25 + k / 4 + at) % 1);
            ctx.fillStyle = `rgba(90, 70, 90, ${0.45 * (1 - t)})`;
            ctx.beginPath();
            ctx.arc(sx - t * w * 0.03, hz - tall * h - t * h * 0.05, w * (0.004 + t * 0.01), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = '#ffcf6a';
        for (let i = 0; i < 4; i++) if (b.lights[i]) ctx.fillRect(x + bw * (0.15 + i * 0.2), top + (hz - top) * 0.45, bw * 0.08, (hz - top) * 0.18);
      } else {
        ctx.fillRect(x, top, bw, hz - top);
        ctx.fillStyle = '#ffcf6a';
        b.lights.forEach((on, i) => {
          if (!on) return;
          const col = i % 3;
          const row = Math.floor(i / 3);
          ctx.fillRect(x + bw * (0.18 + col * 0.25), top + (hz - top) * (0.12 + row * 0.2), bw * 0.14, (hz - top) * 0.07);
        });
      }
    }
  }
}

function drawObstacle(ob, p, clipY) {
  const wide = p.w * 0.48;
  const tall = ob.kind === 'rock' ? wide * 0.75 : wide * 0.85;
  const sx = p.x + ob.x * p.w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, clipY);
  ctx.clip();
  ctx.lineWidth = Math.max(1, wide * 0.04);
  ctx.strokeStyle = C.ink;
  if (ob.kind === 'rock') {
    ctx.fillStyle = '#7a6750';
    ctx.beginPath();
    ctx.ellipse(sx, p.y - tall / 2, wide / 2, tall / 2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9c8a70';
    ctx.beginPath();
    ctx.ellipse(sx - wide * 0.14, p.y - tall * 0.66, wide * 0.16, tall * 0.12, -0.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#b08a4a';
    ctx.fillRect(sx - wide / 2, p.y - tall, wide, tall);
    ctx.strokeRect(sx - wide / 2, p.y - tall, wide, tall);
    ctx.beginPath();
    ctx.moveTo(sx - wide / 2, p.y - tall); ctx.lineTo(sx + wide / 2, p.y);
    ctx.moveTo(sx + wide / 2, p.y - tall); ctx.lineTo(sx - wide / 2, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTree(item, p, clipY) {
  const x = p.x + item.x * p.w;
  const size = p.w * (item.kind === 'tree' ? 0.7 : 0.3);
  if (x < -size || x > canvas.width + size) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, clipY);
  ctx.clip();
  if (item.kind === 'tree') {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x - size * 0.05, p.y - size * 0.5, size * 0.1, size * 0.5);
    for (const [dx, dy, r, color] of [[0, -0.75, 0.32, '#33532b'], [-0.18, -0.55, 0.24, '#3e6332'], [0.18, -0.58, 0.24, '#2b4a25'], [0, -1, 0.22, '#3e6332']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + dx * size, p.y + dy * size, r * size, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (const [dx, r, color] of [[-0.3, 0.32, '#3f5f2e'], [0.3, 0.3, '#375529'], [0, 0.4, '#4a6b35']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + dx * size, p.y - r * size * 0.8, r * size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Telegraph poles every 25 m along both sides: they rush past and make the speed readable.
function drawPole(x, y, scale, clipY) {
  const tall = scale * 1.1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, clipY);
  ctx.clip();
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = Math.max(1, scale * 0.03);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x, y - tall);
  ctx.moveTo(x - scale * 0.14, y - tall * 0.9); ctx.lineTo(x + scale * 0.14, y - tall * 0.9);
  ctx.stroke();
  ctx.restore();
}

function drawTrack(w, h) {
  const base = Math.floor(run.z / SEG);
  const frac = (run.z % SEG) / SEG;
  const camX = run.x * ROAD;
  const hz = horizonOf(w, h);
  const project = (z, offset) => {
    const cz = z - run.z;
    const sc = DEPTH / cz;
    return { x: w / 2 - sc * offset * w / 2, y: hz + sc * CAM_H * h / 2, w: sc * ROAD * w / 2, cz };
  };
  let x = 0;
  let dx = -segAt(base).curve * frac;
  let maxY = h;
  const shown = [];
  for (let n = 0; n < DRAW; n++) {
    const abs = base + n;
    const seg = segAt(abs);
    const p1 = project(abs * SEG, camX - x);
    const p2 = project((abs + 1) * SEG, camX - x - dx);
    x += dx;
    dx += seg.curve;
    if (p1.cz <= 1 || p2.y >= maxY) continue;
    const clip = maxY;
    ctx.fillStyle = Math.floor(abs / 4) % 2 ? '#647538' : '#5c6c33';
    ctx.fillRect(0, p2.y, w, p1.y - p2.y + 1);
    strip(p1, p2, 0, 1, '#bfa982');
    // A sleeper under the front of each nearby segment; far away they would only flicker.
    if (n < 70) {
      const mid = { x: p1.x + (p2.x - p1.x) * 0.3, y: p1.y + (p2.y - p1.y) * 0.3, w: p1.w + (p2.w - p1.w) * 0.3 };
      strip(p1, mid, 0, 0.9, '#9a8058');
    }
    for (const lane of LANES) for (const side of [-0.11, 0.11]) strip(p1, p2, lane + side, 0.018, '#4a3b2a');
    maxY = p2.y;
    if (seg.obstacles.length || seg.scenery.length || abs % 25 === 0) shown.push({ seg, abs, p1, clip });
  }
  for (let i = shown.length - 1; i >= 0; i--) {
    const { seg, abs, p1, clip } = shown[i];
    if (abs % 25 === 0) for (const side of [-1.35, 1.35]) drawPole(p1.x + side * p1.w, p1.y, p1.w, clip);
    for (const item of seg.scenery) drawTree(item, p1, clip);
    for (const ob of seg.obstacles) if (!ob.hit) drawObstacle(ob, p1, clip);
  }
}

function drawMonster(cx, baseY, size) {
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.ellipse(cx, baseY - size * 0.42, size * 0.5, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * size * 0.22, baseY - size * 0.7);
    ctx.lineTo(cx + s * size * 0.42, baseY - size * 1.05);
    ctx.lineTo(cx + s * size * 0.36, baseY - size * 0.62);
    ctx.fill();
    ctx.fillStyle = '#ffcf5a';
    ctx.beginPath();
    ctx.ellipse(cx + s * size * 0.17, baseY - size * 0.55, size * 0.09, size * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(cx + s * size * 0.15, baseY - size * 0.55, size * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = C.face;
  ctx.beginPath();
  const teeth = 7;
  for (let i = 0; i <= teeth; i++) {
    const tx = cx - size * 0.28 + (i / teeth) * size * 0.56;
    ctx.lineTo(tx, baseY - size * (i % 2 ? 0.2 : 0.3));
  }
  ctx.lineTo(cx + size * 0.28, baseY - size * 0.33);
  ctx.lineTo(cx - size * 0.28, baseY - size * 0.33);
  ctx.fill();
}

// The rear-view mirror: an iron frame with brass rivets, a sunset reflection, and the monster growing as it closes in.
// Canvas pixels per CSS pixel; falls back to 1 when the page has no width (a hidden or collapsed tab).
const pixelRatio = () => canvas.width / canvas.clientWidth || 1;
const mirrorWidth = (w) => Math.min(w * 0.26, 260 * pixelRatio());

function drawMirror(w, h) {
  const mw = mirrorWidth(w);
  const mh = mw * 0.42;
  const mx = w / 2 - mw / 2;
  const my = mirrorTop;
  const rim = mw * 0.03;
  ctx.save();
  ctx.fillStyle = '#2c3035';
  roundRect(mx - rim, my - rim, mw + rim * 2, mh + rim * 2, rim);
  ctx.fill();
  ctx.strokeStyle = '#c9a04a';
  ctx.lineWidth = Math.max(1.5, rim * 0.3);
  ctx.stroke();
  ctx.fillStyle = '#e8c878';
  for (const fx of [0.02, 0.98]) for (const fy of [0.05, 0.95]) {
    ctx.beginPath();
    ctx.arc(mx - rim + fx * (mw + rim * 2), my - rim + fy * (mh + rim * 2), rim * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.rect(mx, my, mw, mh);
  ctx.clip();
  const glass = ctx.createLinearGradient(0, my, 0, my + mh * 0.45);
  glass.addColorStop(0, '#5a3352');
  glass.addColorStop(1, '#f0925a');
  ctx.fillStyle = glass;
  ctx.fillRect(mx, my, mw, mh * 0.45);
  ctx.fillStyle = '#3a2f2c';
  ctx.fillRect(mx, my + mh * 0.45, mw, mh * 0.55);
  ctx.strokeStyle = '#c9a04a';
  ctx.lineWidth = 2;
  for (const off of [-0.3, -0.12, 0.12, 0.3]) {
    ctx.beginPath();
    ctx.moveTo(mx + mw / 2 + off * mw * 0.15, my + mh * 0.45);
    ctx.lineTo(mx + mw / 2 + off * mw * 1.6, my + mh);
    ctx.stroke();
  }
  const near = 1 - clamp(run.gap / GAP_MAX, 0, 1);
  drawMonster(mx + mw / 2, my + mh * (0.55 + near * 0.45), mh * (0.18 + near * 0.95));
  ctx.restore();

  // Distance label above the mirror, no panel: light text with a dark outline reads over any sky.
  const ratio = pixelRatio();
  const gap = Math.max(0, Math.round(run.gap));
  ctx.save();
  ctx.font = `600 ${18 * ratio}px 'Source Serif 4', Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4 * ratio;
  ctx.strokeStyle = 'rgba(28, 22, 36, 0.85)';
  ctx.fillStyle = gap < 30 ? '#ffcf5a' : C.face; // amber once the monster is close
  const y = my - rim - 6 * ratio;
  ctx.strokeText(`${gap} m away`, w / 2, y);
  ctx.fillText(`${gap} m away`, w / 2, y);
  ctx.restore();
}

// The mirror goes at the top of the screen unless a HUD group sits in its column (as on narrow
// screens), in which case it drops below that group. Room is kept above it for the distance label.
function placeMirror() {
  const ratio = pixelRatio();
  const half = mirrorWidth(canvas.width) / ratio / 2 + 12;
  const left = canvas.clientWidth / 2 - half;
  const right = canvas.clientWidth / 2 + half;
  let top = 8;
  for (const group of document.querySelectorAll('.hud-group')) {
    const r = group.getBoundingClientRect();
    if (r.right > left && r.left < right) top = Math.max(top, r.bottom + 6);
  }
  mirrorTop = (top + MIRROR_LABEL) * ratio;
}

function drawClaws(w, h, t) {
  ctx.fillStyle = C.ink;
  for (const side of [-1, 1]) {
    const ox = side < 0 ? 0 : w;
    for (let i = 0; i < 3; i++) {
      const y0 = h * (0.55 + i * 0.12);
      const reach = w * 0.16 * t;
      ctx.beginPath();
      ctx.moveTo(ox, y0 - h * 0.03);
      ctx.quadraticCurveTo(ox - side * reach * 0.6, y0 - h * 0.08, ox - side * reach, y0);
      ctx.quadraticCurveTo(ox - side * reach * 0.5, y0 - h * 0.01, ox, y0 + h * 0.03);
      ctx.fill();
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawGear(x, y, r, teeth) {
  ctx.fillStyle = '#c9a04a';
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 + run.z * 0.0004; // the cogs turn as the train moves
    const rr = i % 2 ? r * 0.78 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5a3d14';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

// Where the locomotive sits on screen: its wheels rest on the track at the train's own distance ahead.
function trainFrame(w, h) {
  const sc = DEPTH / AHEAD;
  const roadHalf = sc * ROAD * w / 2;
  const u = (roadHalf * 0.27) / 100; // drawing unit: the train is about 100u wide, a little over a lane
  return { cx: w / 2, by: horizonOf(w, h) + sc * CAM_H * h / 2 - u * 6, u };
}

// The player's steampunk locomotive, seen from just behind and above. The grey body runs from the cab
// all the way to the bottom of the screen, as if the camera rides on the train. It leans into steering.
function drawTrain(w, h) {
  const { cx, by, u } = trainFrame(w, h);
  const pct = run.speed / run.cfg.maxSpeed;
  const bob = calm ? 0 : Math.sin(run.z * 0.004) * u * 0.6 * pct;
  const low = h - by + 40 * u; // past the bottom edge even while leaning
  ctx.save();
  ctx.translate(cx, by + bob);
  ctx.rotate((keys.right - keys.left) * 0.035);

  // Chimney and steam dome stand on the boiler ahead of the cab, so they show above the roof.
  ctx.fillStyle = '#1c1c1f';
  ctx.beginPath();
  ctx.moveTo(-6 * u, -104 * u); ctx.lineTo(-6 * u, -128 * u); ctx.lineTo(-11 * u, -141 * u);
  ctx.lineTo(11 * u, -141 * u); ctx.lineTo(6 * u, -128 * u); ctx.lineTo(6 * u, -104 * u);
  ctx.fill();
  ctx.fillStyle = '#c9a04a';
  ctx.fillRect(-7 * u, -131 * u, 14 * u, 3 * u);
  ctx.beginPath();
  ctx.arc(18 * u, -110 * u, 7 * u, Math.PI, 0);
  ctx.fill();

  // Body: widens slightly toward the viewer, gunmetal grey with a lighter middle.
  const body = ctx.createLinearGradient(-47 * u, 0, 47 * u, 0);
  body.addColorStop(0, '#3e4349');
  body.addColorStop(0.5, '#858c94');
  body.addColorStop(1, '#3e4349');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-44 * u, -104 * u); ctx.lineTo(44 * u, -104 * u);
  ctx.lineTo(48 * u, low); ctx.lineTo(-48 * u, low);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c9a04a';
  ctx.lineWidth = 2.2 * u;
  ctx.stroke();

  // Brass bands with rivets, repeating down the length of the body.
  const bands = [-86, -42];
  for (let y = 0; y * u < low; y += 42) bands.push(y);
  ctx.lineWidth = 2 * u;
  for (const y of bands) {
    const half = 44 + (4 * (y + 104)) / ((low / u) + 104);
    ctx.strokeStyle = '#c9a04a';
    ctx.beginPath();
    ctx.moveTo(-half * u, y * u); ctx.lineTo(half * u, y * u);
    ctx.stroke();
    ctx.fillStyle = '#e8c878';
    for (let x = -half + 4; x <= half - 4; x += 8) {
      ctx.beginPath();
      ctx.arc(x * u, y * u, 1.1 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Panel seams running toward the viewer.
  ctx.strokeStyle = 'rgba(28, 28, 31, 0.55)';
  ctx.lineWidth = 1.4 * u;
  for (const x of [-26, 26]) {
    ctx.beginPath();
    ctx.moveTo(x * u, -42 * u); ctx.lineTo(x * 1.06 * u, low);
    ctx.stroke();
  }

  // Lit rear window with a centre bar.
  const glow = ctx.createRadialGradient(0, -78 * u, 2 * u, 0, -78 * u, 24 * u);
  glow.addColorStop(0, '#ffe4a3');
  glow.addColorStop(1, '#d9902f');
  ctx.fillStyle = glow;
  roundRect(-17 * u, -97 * u, 34 * u, 24 * u, [9 * u, 9 * u, 2 * u, 2 * u]);
  ctx.fill();
  ctx.strokeStyle = '#c9a04a';
  ctx.lineWidth = 2.5 * u;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -97 * u); ctx.lineTo(0, -73 * u);
  ctx.stroke();

  // Cogs and a pressure gauge; the gauge reads the train's speed.
  drawGear(-27 * u, -60 * u, 10 * u, 8);
  drawGear(-12 * u, -53 * u, 6 * u, 6);
  drawGear(30 * u, -14 * u, 8 * u, 7);
  ctx.fillStyle = '#f8f2e4';
  ctx.strokeStyle = '#c9a04a';
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.arc(26 * u, -60 * u, 8 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#a3361f';
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.moveTo(26 * u, -60 * u);
  const needle = -Math.PI * 0.85 + pct * Math.PI * 0.7;
  ctx.lineTo(26 * u + Math.cos(needle) * 6 * u, -60 * u + Math.sin(needle) * 6 * u);
  ctx.stroke();

  // Copper steam pipes with joints.
  ctx.strokeStyle = '#b8642f';
  ctx.lineWidth = 3.5 * u;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-40 * u, -36 * u); ctx.lineTo(40 * u, -36 * u);
  ctx.moveTo(-36 * u, -36 * u); ctx.lineTo(-38 * u, low);
  ctx.stroke();
  ctx.fillStyle = '#d98a4f';
  for (const [x, y] of [[-30, -36], [0, -36], [30, -36], [-36.5, 10], [-37, 50]]) {
    ctx.beginPath();
    ctx.arc(x * u, y * u, 2.6 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // Curved roof with an overhang, and two lamps on its corners.
  ctx.fillStyle = '#2c3035';
  ctx.beginPath();
  ctx.moveTo(-49 * u, -102 * u);
  ctx.quadraticCurveTo(0, -126 * u, 49 * u, -102 * u);
  ctx.lineTo(49 * u, -98 * u);
  ctx.lineTo(-49 * u, -98 * u);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c9a04a';
  ctx.lineWidth = 1.8 * u;
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#c9a04a';
    ctx.fillRect(side * 40 * u - 4 * u, -112 * u, 8 * u, 9 * u);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.arc(side * 40 * u, -107.5 * u, 2.6 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Smoke from the chimney rises, spreads and drifts back over the train.
function stepSmoke(dt, w, h) {
  const { cx, by, u } = trainFrame(w, h);
  const pct = run.speed / run.cfg.maxSpeed;
  if (!run.paused && Math.random() < dt * (5 + 8 * pct)) run.smoke.push({ x: rand(-2, 2), y: 0, vx: rand(-8, 8), r: 5, a: 0.7 });
  for (const p of run.smoke) {
    p.y += dt * (35 + 45 * pct);
    p.x += dt * p.vx;
    p.r += dt * 12;
    p.a -= dt * 1.6;
  }
  run.smoke = run.smoke.filter((p) => p.a > 0);
  for (const p of run.smoke) {
    ctx.fillStyle = `rgba(236, 236, 232, ${p.a})`;
    ctx.beginPath();
    ctx.arc(cx + p.x * u, by - 141 * u - p.y * u, p.r * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render(dt) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  if (run.shake > 0 && !calm) ctx.translate((Math.random() - 0.5) * run.shake * w * 0.015, (Math.random() - 0.5) * run.shake * h * 0.015);
  drawSky(w, h);
  drawTrack(w, h);
  drawTrain(w, h);
  stepSmoke(dt, w, h);
  if (run.gap < 20) drawClaws(w, h, 1 - run.gap / 20);
  drawMirror(w, h);
  ctx.restore();
}

// ---- HUD and screens -------------------------------------------------------

// The speedometer dial sweeps 270 degrees clockwise from bottom left (135) to bottom right (405).
const dialAngle = (mph) => 135 + (clamp(mph, 0, MPH_MAX) / MPH_MAX) * 270;

// Builds the steampunk speedometer once: brass bezel with rivets, cream face, ticks every 5 mph,
// numbers every 20, a red zone from 100 mph, and a red needle on a brass hub.
function buildSpeedo() {
  const NS = 'http://www.w3.org/2000/svg';
  const dial = el('speedo');
  const add = (tag, attrs, parent = dial) => {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    parent.append(node);
    return node;
  };
  const at = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
  const defs = add('defs', {});
  const grad = add('radialGradient', { id: 'speedo-brass', cx: '35%', cy: '30%', r: '75%' }, defs);
  add('stop', { offset: '0', 'stop-color': '#e8c878' }, grad);
  add('stop', { offset: '1', 'stop-color': '#7a5a20' }, grad);
  add('circle', { r: 48, fill: 'url(#speedo-brass)' });
  add('circle', { r: 40, fill: '#f8f2e4', stroke: '#5a3d14', 'stroke-width': 1.5 });
  for (let i = 0; i < 8; i++) {
    const [x, y] = at(i * 45 + 22.5, 44);
    add('circle', { cx: x, cy: y, r: 1.6, fill: '#5a3d14' });
  }
  const [rx1, ry1] = at(dialAngle(100), 34);
  const [rx2, ry2] = at(dialAngle(MPH_MAX), 34);
  add('path', { d: `M${rx1} ${ry1} A34 34 0 0 1 ${rx2} ${ry2}`, fill: 'none', stroke: '#a3361f', 'stroke-width': 5 });
  for (let mph = 0; mph <= MPH_MAX; mph += 5) {
    const major = mph % 20 === 0;
    const [x1, y1] = at(dialAngle(mph), major ? 30 : 33);
    const [x2, y2] = at(dialAngle(mph), 37);
    add('line', { x1, y1, x2, y2, stroke: '#2b2118', 'stroke-width': major ? 1.8 : 0.9 });
    if (major) {
      const [tx, ty] = at(dialAngle(mph), 22);
      add('text', { x: tx, y: ty + 3, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 600, fill: '#2b2118' }).textContent = mph;
    }
  }
  add('text', { y: 22, 'text-anchor': 'middle', 'font-size': 7, fill: '#5a4630', 'font-style': 'italic' }).textContent = 'mph';
  const needle = add('g', { id: 'speedo-needle', transform: `rotate(${dialAngle(0)})` });
  add('path', { d: 'M-6 -2 L32 0 L-6 2 Z', fill: '#a3361f' }, needle);
  add('circle', { r: 5, fill: 'url(#speedo-brass)', stroke: '#5a3d14', 'stroke-width': 1 });
}
buildSpeedo();

function hud() {
  el('hud-distance').textContent = `${Math.floor(run.z / SEG).toLocaleString()} m`;
  const mph = run.speed * MPH_PER_UNIT;
  el('hud-speed').textContent = `${Math.round(mph)} mph`;
  el('speedo-needle').setAttribute('transform', `rotate(${dialAngle(mph)})`);
  el('hud-gap').textContent = `Monster ${Math.max(0, Math.round(run.gap))} m behind`;
  const counting = run.paused === 'countdown';
  const c = counting ? String(Math.ceil(run.countdown)) : run.callout && run.callout.until > run.time ? run.callout.text : '';
  if (el('callout').textContent !== c) el('callout').textContent = c;
  el('callout').classList.toggle('count', counting);
  const sign = el('turn-sign');
  sign.hidden = !run.turn || !!run.paused;
  if (run.turn) {
    sign.dataset.dir = run.turn > 0 ? 'right' : 'left';
    el('turn-text').textContent = run.turn > 0 ? 'Bend right' : 'Bend left';
  }
  el('hud-fault').hidden = !run.warned || !!run.paused;
  placeMirror(); // the HUD can gain a row when the fault notice shows
}

function frame(t) {
  // Clamped at both ends: a frame timestamp can be earlier than the performance.now() taken on resume.
  const dt = clamp((t - last) / 1000 || 0, 0, 0.05);
  last = t;
  if (!run.paused) update(dt);
  else if (run.paused === 'countdown') tickCountdown(dt);
  if (run.over) return;
  render(run.paused === 'menu' ? 0 : dt);
  run.hud += dt;
  if (run.hud > 0.1 || run.paused) { run.hud = 0; hud(); }
  raf = requestAnimationFrame(frame);
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  placeMirror();
}

function show(screen) {
  for (const id of ['menu', 'briefing', 'drive', 'practice']) el(id).hidden = id !== screen;
}

function selectedMode() {
  return document.querySelector('input[name="difficulty"]:checked').value;
}
function selectedCategory() {
  return document.querySelector('input[name="category"]:checked').value;
}

const FAULT_HOW = {
  circuits: 'A signal circuit opens. Pick a signal box from the drawer, place it in a slot, then press Run the test cycle. Every row in the ledger must match.',
  coding: 'A short Python snippet opens. Read it and pick what it prints from four answers. A wrong pick costs nothing but time.',
  mixed: 'Each fault is either a signal circuit (place signal boxes, then run the test cycle) or a Python snippet (pick what it prints).',
};

// The controls briefing shown before every run started from the menu.
function showBriefing() {
  const mode = MODES[selectedMode()];
  const category = selectedCategory();
  el('brief-setup').textContent = `${mode.label} difficulty, ${document.querySelector(`input[name="category"][value="${category}"]`).dataset.label} questions, ${mode.repair} seconds for each repair.`;
  el('brief-fault').textContent = FAULT_HOW[category];
  show('briefing');
  el('go').focus();
}

function renderBest() {
  const best = loadBest();
  for (const mode of Object.keys(MODES)) {
    el(`best-${mode}`).textContent = best[mode] ? `Your best: ${best[mode].toLocaleString()} m` : 'No run yet';
  }
}

function startRun() {
  newRun(selectedMode(), selectedCategory());
  show('drive');
  resize();
  el('paused').hidden = true;
  announce(`${run.cfg.label} run started. Steer with the arrow keys.`);
  shout('Full steam ahead!', 2);
  canvas.focus();
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function finish() {
  if (run.over) return;
  run.over = true;
  cancelAnimationFrame(raf);
  const metres = Math.floor(run.z / SEG);
  const best = loadBest();
  const record = metres > (best[run.mode] || 0);
  if (record) { best[run.mode] = metres; saveBest(best); }
  el('over-distance').textContent = `${metres.toLocaleString()} m`;
  announce(`The monster caught the train after ${metres} metres.`);
  el('over').showModal();
}

function pause(on) {
  if (!run || run.over || run.paused === 'repair' || run.paused === 'countdown') return;
  run.paused = on ? 'menu' : null;
  el('paused').hidden = !on;
  keys.left = keys.right = false;
  if (on) el('resume').focus();
  else { last = performance.now(); canvas.focus(); }
}

function toMenu() {
  if (run) { run.over = true; cancelAnimationFrame(raf); }
  if (el('over').open) el('over').close();
  renderBest();
  show('menu');
  el('start').focus();
}

// ---- Controls --------------------------------------------------------------

const steerKeys = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
document.addEventListener('keydown', (e) => {
  if (el('drive').hidden || !run || run.over || run.paused === 'repair') return;
  if (steerKeys[e.key]) { keys[steerKeys[e.key]] = true; e.preventDefault(); }
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') pause(run.paused !== 'menu');
});
document.addEventListener('keyup', (e) => {
  if (steerKeys[e.key]) keys[steerKeys[e.key]] = false;
});
for (const [id, dir] of [['steer-left', 'left'], ['steer-right', 'right']]) {
  const b = el(id);
  const set = (on) => (e) => { e.preventDefault(); keys[dir] = on; };
  b.addEventListener('pointerdown', set(true));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, set(false));
}
document.addEventListener('visibilitychange', () => { if (document.hidden && run && !run.paused) pause(true); });
window.addEventListener('resize', () => { if (!el('drive').hidden) resize(); });

el('start').addEventListener('click', showBriefing);
el('go').addEventListener('click', startRun);
el('brief-back').addEventListener('click', toMenu);
el('again').addEventListener('click', () => { el('over').close(); startRun(); });
el('to-menu').addEventListener('click', toMenu);
el('over').addEventListener('cancel', (e) => { e.preventDefault(); toMenu(); });
el('pause-btn').addEventListener('click', () => pause(true));
el('resume').addEventListener('click', () => pause(false));
el('quit').addEventListener('click', toMenu);
el('to-practice').addEventListener('click', () => { show('practice'); el('practice-back').focus(); });
el('practice-back').addEventListener('click', toMenu);

// ---- Solana ------------------------------------------------------------------

const short = (key) => `${key.slice(0, 4)}…${key.slice(-4)}`;
const link = (href, text) => Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener' });

el('record').addEventListener('click', async () => {
  const note = el('record-note');
  const mode = selectedMode();
  const best = loadBest()[mode];
  if (!best) {
    note.textContent = `Finish a run on ${MODES[mode].label} first, then record it here.`;
    return;
  }
  note.textContent = `Recording your best ${MODES[mode].label} run (${best.toLocaleString()} m). Approve the transaction in Phantom.`;
  el('record').hidden = true;
  try {
    const sig = await Chain.record(mode, best);
    note.replaceChildren('Recorded on the Solana devnet. ', link(Chain.explorer(sig), 'View the transaction on Solana Explorer'));
  } catch (err) {
    note.textContent = Chain.explain(err);
    el('record').hidden = false;
  }
});

el('board-load').addEventListener('click', async () => {
  const list = el('board-list');
  const note = el('board-note');
  list.replaceChildren();
  note.textContent = 'Reading the devnet ledger…';
  try {
    const runs = await Chain.leaderboard();
    note.textContent = runs.length ? 'Best recorded runs, read live from the Solana devnet.' : 'No runs recorded yet. Finish a run and record it to claim the top spot.';
    list.replaceChildren(...runs.map((r) => {
      const li = document.createElement('li');
      li.append(`${r.metres.toLocaleString()} m, ${MODES[r.difficulty].label}, ${r.player ? short(r.player) : 'unknown wallet'} `, link(Chain.explorer(r.signature), 'proof'));
      return li;
    }));
  } catch (err) {
    note.textContent = Chain.explain(err);
  }
});

renderBest();
// Test hook for driving the game from the browser console; only exists when the URL ends in #debug.
if (location.hash === '#debug') window.sjDebug = { get run() { return run; }, keys, segAt: (a) => segAt(a), SEG, AHEAD };
})();
