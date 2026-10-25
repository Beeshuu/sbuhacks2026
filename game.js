// The endless run: a chase view from behind the steamboat, drawn segment by segment on a canvas
// (the pseudo-3D method of classic arcade racers). Uses Workshop (app.js) for engine faults
// and Chain (solana.js) for the devnet leaderboard.
// Wrapped in a function so its names (update, say, ...) don't collide with app.js.
(() => {

const SEG = 200; // one river segment in world units; shown to the player as 1 metre
const ROAD = 1600; // half-width of the river channel; about the screen width at the bottom edge
const CAM_H = 1400;
const DEPTH = 0.84; // camera depth, roughly a 100 degree field of view
const DRAW = 170; // segments drawn ahead
const RING = 600; // segments kept in memory; older ones are rewritten ahead of the boat
const AHEAD = CAM_H * DEPTH; // the boat's bow sits this far in front of the camera
const LANES = [-0.66, 0, 0.66];
const GAP_MAX = 120; // metres: the furthest the monster falls behind
const HIT_RANGE = 0.42; // obstacle half-width plus boat half-width, in river half-widths
const BANK = 0.74; // furthest the boat's centre can go from mid-river: its paddle boxes then stay on the water
const FAULT_EVERY = [750, 1500]; // metres between engine faults, on every difficulty
const FAULT_WARN = 200; // metres of warning before a fault
const COUNTDOWN = 3; // seconds before the boat moves again after a repair
const ROCK_DELAY = 3; // seconds between hitting a rock and its engine fault
const POOL_LENGTH = 6; // metres of river a whirlpool covers: long enough to read from a distance
const POOL_FROM = 400; // no whirlpools in the first 400 m, while new players learn to steer
const MPH_PER_UNIT = 2.23694 / SEG; // world units per second to miles per hour (1 segment = 1 metre)
const MPH_MAX = 120; // top of the speedometer dial; Hard tops out near 112 mph

// Every number a player feels comes from here. Keep pull * curve below 1 so full steering always beats a bend:
// at the sharpest bend that ratio is 0.45 (Easy), 0.6 (Medium) and 0.7 (Hard).
const MODES = {
  easy: { label: 'Easy', maxSpeed: 7000, monster: 0.74, curve: 3, obstacles: 0.012, mix: { crate: 0.53, rock: 0.25, wave: 0.2, whirlpool: 0.02 }, pull: 0.15, repair: 40, plates: [0, 1, 2, 3] },
  medium: { label: 'Medium', maxSpeed: 8500, monster: 0.82, curve: 5, obstacles: 0.018, mix: { crate: 0.46, rock: 0.27, wave: 0.23, whirlpool: 0.04 }, pull: 0.12, repair: 32, plates: [2, 3, 4, 5, 6] },
  hard: { label: 'Hard', maxSpeed: 10000, monster: 0.88, curve: 7, obstacles: 0.024, mix: { crate: 0.44, rock: 0.27, wave: 0.23, whirlpool: 0.06 }, pull: 0.1, repair: 26, plates: [5, 6, 7, 8, 9, 10] },
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
const SCORES_KEY = 'steel-junction-scores';
const NAME_KEY = 'steel-junction-name';
const TOP = 5;
const NAME_OK = /^[A-Za-z0-9 _.-]{1,16}$/; // also keeps '|' out of the Solana memo

function loadScores() {
  try { return JSON.parse(localStorage.getItem(SCORES_KEY)) || {}; } catch { return {}; }
}
function saveScores(scores) {
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(scores)); } catch { /* blocked storage: scores last this visit only */ }
}
const topFive = (mode) => (loadScores()[mode] || []).slice(0, TOP);
const makesTopFive = (mode, metres) => {
  const list = topFive(mode);
  return metres > 0 && (list.length < TOP || metres > list[TOP - 1].metres);
};
function lastName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

function saveBest(best) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* blocked storage: best distance lasts this visit only */ }
}

const canvas = el('view');
let ctx = canvas.getContext('2d'); // let: the boat is drawn to its own layer at night (drawBoatLit)
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
    faultAt: rand(...FAULT_EVERY), warned: false, pendingFault: 0, pool: null, countdown: 0, resume: '', turn: 0, repairs: 0, hits: 0,
    paused: null, over: false, shake: 0, flash: 0, needle: 0, demo: false, callout: null, smoke: [], hills: 0, hud: 0,
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
  // Leave one lane clear in every row, and space rows out so there is always time to react.
  if (run.pool) {
    // A whirlpool covers several segments; it is drawn once, at its middle one.
    seg.obstacles.push({ x: run.pool.x, kind: 'whirlpool', hit: false, mid: run.pool.i === Math.floor(POOL_LENGTH / 2) });
    if (++run.pool.i === POOL_LENGTH) run.pool = null;
  } else if (abs > 70 && abs - run.lastObstacle > 14 && Math.random() < run.cfg.obstacles) {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.3 ? 2 : 1);
    let poolPlaced = false;
    for (const l of lanes) {
      let kind = pickKind(run.cfg.mix);
      if (kind === 'whirlpool' && (poolPlaced || abs < POOL_FROM)) kind = 'crate'; // never two in a row, none early on
      if (kind === 'whirlpool') {
        poolPlaced = true;
        run.pool = { x: LANES[l], i: 1 };
        seg.obstacles.push({ x: LANES[l], kind, hit: false });
      } else {
        seg.obstacles.push({ x: LANES[l], kind, hit: false });
      }
    }
    run.lastObstacle = abs;
  }
  // Trees and bushes beside the line, for colour and a sense of speed. Purely visual.
  seg.scenery = Math.random() < 0.14
    ? [{ x: (Math.random() < 0.5 ? -1 : 1) * rand(1.6, 3.4), kind: Math.random() < 0.6 ? 'tree' : 'bush' }]
    : [];
  run.segs[abs % RING] = seg;
}

function pickKind(mix) {
  let roll = Math.random();
  for (const [kind, chance] of Object.entries(mix)) if ((roll -= chance) < 0) return kind;
  return 'crate';
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

// In the menu's demo run the boat picks the clear lane nearest to it, looking 50 m ahead.
function demoSteer() {
  const here = Math.floor((run.z + AHEAD) / SEG);
  const blocked = new Set();
  for (let k = 0; k < 50; k++) for (const ob of segAt(here + k).obstacles) blocked.add(ob.x);
  const target = LANES.filter((l) => !blocked.has(l)).sort((a, b) => Math.abs(a - run.x) - Math.abs(b - run.x))[0] ?? 0;
  keys.left = run.x > target + 0.04;
  keys.right = run.x < target - 0.04;
}

function update(dt) {
  const { cfg } = run;
  const max = cfg.maxSpeed;
  const pct = run.speed / max;
  run.time += dt;
  if (run.demo) demoSteer();

  const before = Math.floor((run.z + AHEAD) / SEG);
  const seg = segAt(before);
  const turn = dt * 2 * Math.max(pct, 0.35);
  if (keys.left) run.x -= turn;
  if (keys.right) run.x += turn;
  run.x -= turn * pct * seg.curve * cfg.pull; // bends push the boat toward the outer bank
  // The boat can't leave the water; pressed against the bank it scrapes along it and slows down.
  run.x = clamp(run.x, -BANK, BANK);
  const off = Math.abs(run.x) >= BANK;

  if (off) run.speed = Math.max(max * 0.3, run.speed - max * 1.2 * dt);
  else run.speed = Math.min(max * (run.demo ? 0.75 : 1), run.speed + max * 0.22 * dt);

  run.z += run.speed * dt;
  fillTrack();
  run.hills += seg.curve * pct * dt * 0.02;

  const after = Math.floor((run.z + AHEAD) / SEG);
  for (let a = before; a <= after; a++) {
    for (const ob of segAt(a).obstacles) {
      if (!ob.hit && Math.abs(run.x - ob.x) < HIT_RANGE) {
        ob.hit = true;
        if (run.demo) continue; // the menu's demo boat can't be hurt
        run.hits++;
        run.shake = 1;
        run.flash = 1;
        if (ob.kind === 'whirlpool') return finish('whirlpool');
        Sound.fx[ob.kind]();
        if (ob.kind === 'crate') {
          run.speed *= 0.35;
          shout('Hit a floating crate! Speed lost.');
          announce('You hit a floating crate. The boat slowed down.');
        } else if (ob.kind === 'rock') {
          run.speed *= 0.35;
          if (!run.pendingFault) run.pendingFault = ROCK_DELAY;
          shout('Hit a rock! Engine damaged.', 2.4);
          announce(`You hit a rock. The boat slowed down and the engine will fault in ${ROCK_DELAY} seconds.`);
        } else {
          shout('Wave hit! Engine damaged.');
          announce('A wave crashed over the boat and damaged the engine.');
          startRepair();
          return;
        }
      }
    }
  }

  // The monster wakes up over the first 10 seconds, so the run doesn't open with a loss.
  if (run.demo) return;
  const chase = cfg.monster * max * Math.min(1, run.time / 10);
  run.gap = Math.min(GAP_MAX, run.gap + ((run.speed - chase) / SEG) * dt);
  if (run.gap <= 0) return finish();

  if (off) {
    say('Scraping the bank! Steer back.');
    if (run.time - (run.scraped || 0) > 0.3) { run.scraped = run.time; Sound.fx.scrape(); }
  }
  else if (Math.abs(seg.curve) > 0.5 && Math.abs(run.x) > 0.7 && run.x * seg.curve < 0) say(`Steer ${seg.curve > 0 ? 'right' : 'left'}!`);
  run.turn = 0;
  for (let k = 0; k < 70 && !run.turn; k++) {
    const c = segAt(after + k).curve;
    if (Math.abs(c) > (k ? 0.6 : 0.5)) run.turn = Math.sign(c);
  }
  if (run.gap < 20 && Math.floor(run.time * 2) % 4 === 0) say('It\'s right behind you!', 0.4);

  run.shake = Math.max(0, run.shake - dt * 2.5);
  if (run.pendingFault > 0 && (run.pendingFault -= dt) <= 0) return startRepair();
  const metres = run.z / SEG;
  if (!run.warned && run.faultAt - metres < FAULT_WARN) {
    run.warned = true;
    Sound.fx.bell();
    shout('Engine trouble ahead! Get ready.', 2.2);
    announce('Engine trouble ahead. A fault is coming up.');
  }
  if (metres >= run.faultAt) startRepair();
}

// After a repair the boat waits for a short countdown; the monster waits too.
function tickCountdown(dt) {
  const shown = Math.ceil(run.countdown);
  run.countdown -= dt;
  if (run.countdown <= 0) {
    run.paused = null;
    Sound.fx.whistle();
    shout(run.resume, 1.6);
    hud(); // swap the last number for the message right away, not on the next HUD tick
    canvas.focus();
  } else if (Math.ceil(run.countdown) !== shown) {
    Sound.fx.tick();
    announce(String(Math.ceil(run.countdown)));
  }
}

// While a fault is open everything stops, the monster included. Running out of time costs speed, not distance.
async function startRepair() {
  const { cfg } = run;
  run.pendingFault = 0;
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
  Sound.fx[ok ? 'fixed' : 'failed']();
  if (ok) {
    run.repairs++;
    run.resume = 'Full steam!';
    announce(`Engine fixed. Moving again in ${COUNTDOWN}.`);
  } else {
    run.speed = cfg.maxSpeed * 0.2;
    run.resume = 'The engine is crawling. Get the speed back up!';
    announce(`Out of time. The boat will crawl. Moving again in ${COUNTDOWN}.`);
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

// ---- Day and night -------------------------------------------------------------
// A full cycle (day, sunset, night, dawn) every CYCLE metres. Each key is a moment in the cycle (0 to 1)
// and the colours of the sky, the land and the river; in between, every colour blends smoothly.
const CYCLE = 5000;
const START_AT = 3500; // metres into the cycle where a run begins: deep night
const DAY = { water: '#3f7fa8', bank: '#8a7a52', top: '#3f7fc4', mid: '#6fa6dc', low: '#a9d0ee', hz: '#d6e9f2', far: '#9db2c7', city: '#6b6f7a', ridge: '#5f8c45', ground: '#79a650', cloud: '#ffffff', cloudA: 0.92, dark: 0, lights: 0.1 };
const SUNSET = { water: '#5a4d78', bank: '#5e4a3a', top: '#2b2a5c', mid: '#8a3f6b', low: '#e8734a', hz: '#f6b26b', far: '#7a5577', city: '#3b2b3e', ridge: '#4a3b3a', ground: '#5f6e33', cloud: '#f8a882', cloudA: 0.9, dark: 0.3, lights: 0.8 };
const NIGHT = { water: '#16264a', bank: '#262620', top: '#0b1030', mid: '#141a45', low: '#22285a', hz: '#303868', far: '#2a2f4a', city: '#161828', ridge: '#1e2420', ground: '#2b3a22', cloud: '#4a5274', cloudA: 0.6, dark: 1, lights: 1 };
const DAWN = { water: '#6a74a8', bank: '#7a6a52', top: '#3a4a8a', mid: '#b07aa8', low: '#f0a888', hz: '#f8d4a8', far: '#8a8aa8', city: '#4a4458', ridge: '#4c5a40', ground: '#607a40', cloud: '#ffcfbf', cloudA: 0.9, dark: 0.35, lights: 0.4 };
const SKY_KEYS = [[0, DAY], [0.35, DAY], [0.5, SUNSET], [0.62, NIGHT], [0.85, NIGHT], [0.95, DAWN], [1, DAY]];

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (rgb, alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// The sky palette at this distance; every colour is an [r, g, b] array.
function skyAt(metres) {
  const u = ((metres + START_AT) % CYCLE) / CYCLE;
  let k = 0;
  while (u > SKY_KEYS[k + 1][0]) k++;
  const [u0, a] = SKY_KEYS[k];
  const [u1, b] = SKY_KEYS[k + 1];
  const t = smooth(0, 1, (u - u0) / (u1 - u0));
  const out = { u };
  for (const key of Object.keys(a)) out[key] = typeof a[key] === 'number' ? a[key] + (b[key] - a[key]) * t : mixRgb(rgbOf(a[key]), rgbOf(b[key]), t);
  return out;
}

let sky = skyAt(0);

const STARS = (() => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 70 }, () => [rnd(), rnd() * 0.85, 0.6 + rnd() * 1.2]);
})();

// ---- Drawing ---------------------------------------------------------------

function quad(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

// A strip of river between two projected edges, at `off` across the channel and `half` wide (both in half-widths).
function strip(p1, p2, off, half, color) {
  quad(p1.x + (off - half) * p1.w, p1.y, p1.x + (off + half) * p1.w, p1.y,
    p2.x + (off + half) * p2.w, p2.y, p2.x + (off - half) * p2.w, p2.y, color);
}

// Tall (portrait) screens raise the horizon so more of the river shows below it.
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

// Everything beyond the river, coloured by the time of day: sky, stars, moon, sun, clouds, mountains,
// the industrial skyline, dark hills and the grass.
function drawSky(w, h) {
  const hz = horizonOf(w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, hz);
  grad.addColorStop(0, css(sky.top));
  grad.addColorStop(0.45, css(sky.mid));
  grad.addColorStop(0.8, css(sky.low));
  grad.addColorStop(1, css(sky.hz));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, hz + 1);

  if (sky.dark > 0.05) {
    ctx.fillStyle = `rgba(255, 252, 235, ${sky.dark * 0.85})`;
    for (const [sx, sy, size] of STARS) ctx.fillRect(sx * w, sy * hz, size * (w / 1000), size * (w / 1000));
    const mx = w * 0.22;
    const my = hz * 0.28;
    const mr = w * 0.028;
    const glow = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 4);
    glow.addColorStop(0, `rgba(240, 238, 220, ${sky.dark * 0.35})`);
    glow.addColorStop(1, 'rgba(240, 238, 220, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
    ctx.fillStyle = `rgba(244, 241, 222, ${sky.dark})`;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  // The sun sets through the first half of the cycle and rises again at dawn.
  const u = sky.u;
  const set = u < 0.7 ? smooth(0.3, 0.56, u) : 1 - smooth(0.86, 1, u);
  const sunX = w * 0.68 - run.hills * w * 0.6;
  const sunY = hz - h * 0.34 + set * h * 0.38;
  const r = w * 0.045;
  if (sunY - r < hz) {
    const low = smooth(0.2, 0.9, set);
    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * (0.15 + low * 0.12));
    halo.addColorStop(0, `rgba(255, 214, 140, ${(0.35 + low * 0.4) * (1 - sky.dark)})`); // gone by full night
    halo.addColorStop(1, 'rgba(255, 214, 140, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, hz);
    ctx.fillStyle = css(mixRgb([255, 246, 216], [255, 190, 110], low));
    ctx.beginPath();
    ctx.arc(sunX, sunY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const span = w * 1.4;
  const drift = run.hills * w * 3 + run.time * w * 0.006;
  const shade = mixRgb(sky.cloud, sky.top, 0.35);
  for (const [cx, cy, size] of CLOUDS) {
    const x = (((cx * w - drift) % span) + span) % span - w * 0.2;
    const y = cy * hz;
    const cr = w * 0.035 * size;
    for (const [dx, dy, k, color] of [[0, 0.15, 1, shade], [0, 0, 1, sky.cloud], [1.1, 0.2, 0.8, sky.cloud], [-1.1, 0.25, 0.75, sky.cloud]]) {
      ctx.fillStyle = css(color, sky.cloudA);
      ctx.beginPath();
      ctx.ellipse(x + dx * cr, y + dy * cr, cr * k * 1.3, cr * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const ridge = (color, amp, speed, freq) => {
    ctx.fillStyle = css(color);
    ctx.beginPath();
    ctx.moveTo(0, hz);
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * freq * Math.PI * 2 + run.hills * speed * 40;
      const rr = 0.55 + 0.27 * Math.sin(t) + 0.13 * Math.sin(t * 2.3 + 1) + 0.05 * Math.sin(t * 5.1);
      ctx.lineTo((i / 60) * w, hz - h * amp * rr);
    }
    ctx.lineTo(w, hz);
    ctx.fill();
  };
  ridge(sky.far, 0.13, 0.25, 1.3);
  drawSkyline(w, h, hz);
  ridge(sky.ridge, 0.035, 1, 3.7);
  ctx.fillStyle = css(sky.ground);
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
      ctx.fillStyle = css(sky.city);
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
          ctx.fillStyle = css(sky.city);
          ctx.fillRect(sx - bw * 0.03, hz - tall * h, bw * 0.06, tall * h);
          // Chimney smoke drifts off to the left and thins out.
          for (let k = 0; k < 4; k++) {
            const t = ((run.time * 0.25 + k / 4 + at) % 1);
            ctx.fillStyle = css(mixRgb(sky.city, sky.hz, 0.4), 0.45 * (1 - t));
            ctx.beginPath();
            ctx.arc(sx - t * w * 0.03, hz - tall * h - t * h * 0.05, w * (0.004 + t * 0.01), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = `rgba(255, 207, 106, ${sky.lights})`;
        for (let i = 0; i < 4; i++) if (b.lights[i]) ctx.fillRect(x + bw * (0.15 + i * 0.2), top + (hz - top) * 0.45, bw * 0.08, (hz - top) * 0.18);
      } else {
        ctx.fillRect(x, top, bw, hz - top);
        ctx.fillStyle = `rgba(255, 207, 106, ${sky.lights})`;
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

// A whirlpool: a dark funnel in one lane with three white foam arms spiralling into its core;
// the foam keeps it readable after dark.
function drawWhirlpool(x, y, scale, clipY) {
  const rx = scale * 0.34;
  const squash = 0.34; // the river is seen at a low angle, so circles on it read as flat ellipses
  const spin = calm ? 0 : run.time * 2.4;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, clipY);
  ctx.clip();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, squash);
  const funnel = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  funnel.addColorStop(0, '#02070e');
  funnel.addColorStop(0.3, '#0a1d33');
  funnel.addColorStop(0.7, css(mixRgb(sky.water, [0, 0, 0], 0.35)));
  funnel.addColorStop(1, css(sky.water, 0));
  ctx.fillStyle = funnel;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineCap = 'round';
  for (let a = 0; a < 3; a++) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24; // 0 at the rim, 1 at the core
      const r = rx * (1 - t * 0.88);
      const th = spin + (a * Math.PI * 2) / 3 + t * Math.PI * 2.2;
      ctx.lineTo(x + Math.cos(th) * r, y + Math.sin(th) * r * squash);
    }
    ctx.strokeStyle = 'rgba(240, 248, 255, 0.8)';
    ctx.lineWidth = Math.max(1, scale * 0.016);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(170, 215, 240, 0.55)';
  ctx.lineWidth = Math.max(1, scale * 0.008);
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 1.05, rx * squash * 1.05, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// A wave: a tall curling breaker, a darker swell behind it, a shadowed tube under the lip,
// a foam crest and spray thrown up off the top.
function drawWave(sx, y, wide) {
  const bob = calm ? 0 : Math.sin(run.time * 4 + sx * 0.01) * wide * 0.05;
  const top = y - wide * 0.66 + bob;
  ctx.fillStyle = css(mixRgb(sky.water, [0, 0, 0], 0.25));
  ctx.beginPath();
  ctx.moveTo(sx - wide * 0.78, y);
  ctx.quadraticCurveTo(sx - wide * 0.2, top + wide * 0.12, sx + wide * 0.78, y);
  ctx.closePath();
  ctx.fill();
  const body = ctx.createLinearGradient(0, top, 0, y);
  body.addColorStop(0, '#86cbe8');
  body.addColorStop(0.5, '#3f8fc0');
  body.addColorStop(1, css(mixRgb(sky.water, [0, 0, 0], 0.15)));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(sx - wide * 0.65, y);
  ctx.bezierCurveTo(sx - wide * 0.4, y - wide * 0.2, sx - wide * 0.2, top, sx + wide * 0.12, top);
  ctx.bezierCurveTo(sx + wide * 0.38, top, sx + wide * 0.48, top + wide * 0.16, sx + wide * 0.38, top + wide * 0.28);
  ctx.bezierCurveTo(sx + wide * 0.3, top + wide * 0.18, sx + wide * 0.2, top + wide * 0.2, sx + wide * 0.22, top + wide * 0.34);
  ctx.bezierCurveTo(sx + wide * 0.3, y - wide * 0.1, sx + wide * 0.5, y - wide * 0.02, sx + wide * 0.65, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(8, 28, 48, 0.4)';
  ctx.beginPath();
  ctx.ellipse(sx + wide * 0.3, top + wide * 0.3, wide * 0.07, wide * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = Math.max(1, wide * 0.025);
  ctx.lineCap = 'round';
  for (const k of [0.25, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(sx - wide * (0.5 - k * 0.3), y - wide * (0.06 + k * 0.2));
    ctx.quadraticCurveTo(sx - wide * 0.15, top + wide * (0.15 + k * 0.3), sx + wide * 0.05, top + wide * (0.08 + k * 0.25));
    ctx.stroke();
  }
  ctx.strokeStyle = '#f4fbff';
  ctx.lineWidth = Math.max(2, wide * 0.09);
  ctx.beginPath();
  ctx.moveTo(sx - wide * 0.32, top + wide * 0.12);
  ctx.bezierCurveTo(sx - wide * 0.1, top - wide * 0.03, sx + wide * 0.36, top - wide * 0.02, sx + wide * 0.38, top + wide * 0.26);
  ctx.stroke();
  ctx.fillStyle = 'rgba(244, 251, 255, 0.85)';
  for (let i = 0; i < 7; i++) {
    const t = calm ? 0.5 : (run.time * 1.5 + i / 7) % 1;
    ctx.beginPath();
    ctx.arc(sx - wide * 0.25 + i * wide * 0.1, top - t * wide * 0.3, wide * 0.035 * (1 - t), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(244, 251, 255, 0.7)';
  ctx.lineWidth = Math.max(1, wide * 0.04);
  ctx.beginPath();
  ctx.moveTo(sx - wide * 0.7, y);
  ctx.quadraticCurveTo(sx, y - wide * 0.06, sx + wide * 0.7, y);
  ctx.stroke();
}

// A water line across an object, so floating things look half sunk.
function waterLine(sx, y, wide) {
  ctx.fillStyle = css(sky.water);
  ctx.fillRect(sx - wide * 0.6, y - wide * 0.12, wide * 1.2, wide * 0.16);
  ctx.strokeStyle = 'rgba(240, 248, 255, 0.75)';
  ctx.lineWidth = Math.max(1, wide * 0.03);
  ctx.beginPath();
  ctx.ellipse(sx, y - wide * 0.12, wide * 0.6, wide * 0.06, 0, Math.PI, 0, true);
  ctx.stroke();
}

// Rings spreading out from something sitting in the water.
function ripples(sx, y, wide) {
  for (let i = 0; i < 2; i++) {
    const t = calm ? 0.4 + i * 0.3 : (run.time * 0.8 + i / 2) % 1;
    ctx.strokeStyle = `rgba(240, 248, 255, ${(1 - t) * 0.55})`;
    ctx.lineWidth = Math.max(1, wide * 0.025);
    ctx.beginPath();
    ctx.ellipse(sx, y, wide * (0.6 + t * 0.5), wide * 0.08 * (1 + t), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// A jagged slate rock: a lit face and a shadowed face, a crack, moss on top and foam round the base.
const ROCK = [[-0.5, 0], [-0.47, -0.4], [-0.3, -0.75], [-0.08, -0.88], [0.1, -1], [0.3, -0.76], [0.42, -0.52], [0.5, 0]];

function drawRock(sx, y, wide) {
  const tall = wide * 0.8;
  const at = ([px, py]) => [sx + px * wide, y + py * tall];
  const face = ctx.createLinearGradient(sx - wide / 2, 0, sx + wide / 2, 0);
  face.addColorStop(0, '#8d877a');
  face.addColorStop(0.55, '#5e5a52');
  face.addColorStop(1, '#3a3732');
  ctx.fillStyle = face;
  ctx.beginPath();
  for (const pt of ROCK) ctx.lineTo(...at(pt));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a8a092';
  ctx.beginPath();
  for (const pt of [[-0.3, -0.75], [-0.08, -0.88], [-0.12, -0.48], [-0.38, -0.36]]) ctx.lineTo(...at(pt));
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(...at([0.1, -0.98])); ctx.lineTo(...at([0.04, -0.6])); ctx.lineTo(...at([0.16, -0.32]));
  ctx.stroke();
  ctx.fillStyle = '#5d7a3a';
  ctx.beginPath();
  ctx.ellipse(sx - wide * 0.04, y - tall * 0.88, wide * 0.17, tall * 0.06, -0.3, 0, Math.PI * 2);
  ctx.fill();
  waterLine(sx, y + wide * 0.04, wide);
  ripples(sx, y, wide);
}

// A floating crate: planks inside an iron frame with brass rivets, tipping gently on ripple rings.
function drawCrate(sx, y, wide) {
  const tall = wide * 0.85;
  const tilt = calm ? 0 : Math.sin(run.time * 2 + sx * 0.03) * 0.06;
  ripples(sx, y, wide);
  ctx.save();
  ctx.translate(sx, y);
  ctx.rotate(tilt);
  ctx.fillStyle = '#a87a3e';
  ctx.fillRect(-wide / 2, -tall, wide, tall);
  ctx.strokeStyle = 'rgba(60, 36, 14, 0.6)';
  ctx.lineWidth = Math.max(1, wide * 0.02);
  for (let k = 1; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(-wide / 2, -tall * (k / 4)); ctx.lineTo(wide / 2, -tall * (k / 4));
    ctx.stroke();
  }
  ctx.fillStyle = '#3a3d42';
  const band = wide * 0.1;
  ctx.fillRect(-wide / 2, -tall, band, tall);
  ctx.fillRect(wide / 2 - band, -tall, band, tall);
  ctx.fillRect(-wide / 2, -tall, wide, band);
  ctx.fillRect(-wide / 2, -tall * 0.55, wide, band);
  ctx.fillStyle = BRASS_LIGHT;
  for (const bx of [-wide / 2 + band / 2, wide / 2 - band / 2]) {
    for (const by of [-tall + band / 2, -tall * 0.55 + band / 2]) {
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(1, wide * 0.022), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = Math.max(1, wide * 0.04);
  ctx.strokeRect(-wide / 2, -tall, wide, tall);
  ctx.restore();
  waterLine(sx, y + wide * 0.02, wide);
}

function drawObstacle(ob, p, clipY) {
  const wide = p.w * 0.48;
  const sx = p.x + ob.x * p.w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, clipY);
  ctx.clip();
  ctx.lineWidth = Math.max(1, wide * 0.04);
  ctx.strokeStyle = C.ink;
  if (ob.kind === 'wave') drawWave(sx, p.y, wide);
  else if (ob.kind === 'rock') drawRock(sx, p.y, wide);
  else drawCrate(sx, p.y + (calm ? 0 : Math.sin(run.time * 3 + sx * 0.02) * wide * 0.04), wide);
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
    ctx.fillStyle = css(Math.floor(abs / 4) % 2 ? sky.ground : mixRgb(sky.ground, [0, 0, 0], 0.08));
    ctx.fillRect(0, p2.y, w, p1.y - p2.y + 1);
    // Muddy banks, then the water in slow bands of colour so movement reads.
    strip(p1, p2, 0, 1.12, css(sky.bank));
    strip(p1, p2, 0, 1, css(Math.floor(abs / 3) % 2 ? sky.water : mixRgb(sky.water, [0, 0, 0], 0.035)));
    if (n < 80) {
      // Faint buoy lines between the lanes, and drifting ripples nearby; far away they would only flicker.
      if (abs % 6 < 2) for (const side of [-0.33, 0.33]) strip(p1, p2, side, 0.006, 'rgba(255, 255, 255, 0.14)');
      if ((abs * 7) % 5 === 0) {
        const mid = { x: p1.x + (p2.x - p1.x) * 0.2, y: p1.y + (p2.y - p1.y) * 0.2, w: p1.w + (p2.w - p1.w) * 0.2 };
        strip(p1, mid, ((abs * 53) % 100) / 100 * 1.6 - 0.8, 0.03, 'rgba(255, 255, 255, 0.12)');
      }
    }
    maxY = p2.y;
    if (n === 30) run.beamTarget = { x: p1.x + (run.x + run.lean * 0.5) * p1.w, y: p1.y, half: p1.w * 0.55 };
    if (seg.obstacles.length || seg.scenery.length || abs % 25 === 0) shown.push({ seg, abs, p1, clip });
  }
  for (let i = shown.length - 1; i >= 0; i--) {
    const { seg, abs, p1, clip } = shown[i];
    if (abs % 25 === 0) for (const side of [-1.35, 1.35]) drawPole(p1.x + side * p1.w, p1.y, p1.w, clip);
    for (const item of seg.scenery) drawTree(item, p1, clip);
    // A whirlpool spreads in front of its middle segment too; the river is flat, so it needs no clip.
    for (const ob of seg.obstacles) if (ob.kind === 'whirlpool' && ob.mid) drawWhirlpool(p1.x + ob.x * p1.w, p1.y, p1.w, h);
    for (const ob of seg.obstacles) if (!ob.hit && ob.kind !== 'whirlpool') drawObstacle(ob, p1, clip);
  }
}

// The monster is a black kraken. One tapering tentacle: `width` thick at (x, y), heading off at angle `a`
// (radians, 0 = right), curling by `curl` toward its tip; `phase` makes it writhe. Big ones get suckers.
const KRAKEN = '#0b0b12';

function tentacle(x, y, len, a, curl, width, phase) {
  const n = 14;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const dir = a + curl * t * t + Math.sin(t * 5 + phase) * 0.35 * t;
    pts.push([x, y, dir, width * (1 - t * 0.9)]);
    x += (Math.cos(dir) * len) / n;
    y += (Math.sin(dir) * len) / n;
  }
  const side = (k) => ([px, py, d, wd]) => ctx.lineTo(px + Math.cos(d + Math.PI / 2) * wd * k, py + Math.sin(d + Math.PI / 2) * wd * k);
  ctx.fillStyle = KRAKEN;
  ctx.beginPath();
  pts.forEach(side(0.5));
  pts.slice().reverse().forEach(side(-0.5));
  ctx.closePath();
  ctx.fill();
  if (width < 8) return;
  ctx.fillStyle = '#34344a';
  for (let i = 2; i < n - 2; i += 2) {
    const [px, py, d, wd] = pts[i];
    ctx.beginPath();
    ctx.arc(px + Math.cos(d - Math.PI / 2) * wd * 0.28, py + Math.sin(d - Math.PI / 2) * wd * 0.28, wd * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The kraken in the mirror: a domed black head with a faint sheen, glowing amber eyes with slit pupils,
// and six tentacles rising from the water either side.
function drawMonster(cx, baseY, size) {
  const t = calm ? 0 : run.time;
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const k = i % 3; // 0 nearest the head, 2 furthest out
    tentacle(cx + side * size * (0.12 + k * 0.08), baseY, size * (0.75 - k * 0.1), -Math.PI / 2 + side * (0.35 + k * 0.4), -side * 1.6, size * 0.13, t * 2 + i);
  }
  const head = ctx.createRadialGradient(cx - size * 0.1, baseY - size * 0.8, size * 0.02, cx, baseY - size * 0.55, size * 0.55);
  head.addColorStop(0, '#3a3a52');
  head.addColorStop(0.4, '#15151f');
  head.addColorStop(1, KRAKEN);
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.3, baseY - size * 0.15);
  ctx.bezierCurveTo(cx - size * 0.38, baseY - size * 0.75, cx - size * 0.2, baseY - size * 1.08, cx, baseY - size * 1.08);
  ctx.bezierCurveTo(cx + size * 0.2, baseY - size * 1.08, cx + size * 0.38, baseY - size * 0.75, cx + size * 0.3, baseY - size * 0.15);
  ctx.closePath();
  ctx.fill();
  for (const s of [-1, 1]) {
    const ex = cx + s * size * 0.14;
    const ey = baseY - size * 0.42;
    const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, size * 0.13);
    glow.addColorStop(0, 'rgba(255, 190, 60, 0.6)');
    glow.addColorStop(1, 'rgba(255, 190, 60, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffcf5a';
    ctx.beginPath();
    ctx.ellipse(ex, ey, size * 0.07, size * 0.045, s * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = KRAKEN;
    ctx.beginPath();
    ctx.ellipse(ex, ey, size * 0.014, size * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(240, 248, 255, 0.6)'; // foam where it breaks the surface
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath();
  ctx.ellipse(cx, baseY, size * 0.55, size * 0.06, 0, Math.PI, 0, true);
  ctx.stroke();
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
  glass.addColorStop(0, css(mixRgb(sky.top, [0, 0, 0], 0.2)));
  glass.addColorStop(1, css(sky.low));
  ctx.fillStyle = glass;
  ctx.fillRect(mx, my, mw, mh * 0.45);
  ctx.fillStyle = css(mixRgb(sky.water, [0, 0, 0], 0.25));
  ctx.fillRect(mx, my + mh * 0.45, mw, mh * 0.55);
  ctx.strokeStyle = 'rgba(240, 248, 255, 0.4)'; // the river's wake behind the boat
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

// When the kraken is close, its tentacles reach in from both sides of the screen.
function drawTentacles(w, h, t) {
  const m = Math.min(w, h);
  const phase = calm ? 0 : run.time * 3;
  for (let i = 0; i < 2; i++) {
    tentacle(0, h * (0.62 + i * 0.18), m * 0.5 * t, -0.5 + i * 0.3, -2.6, m * 0.08, phase + i);
    tentacle(w, h * (0.62 + i * 0.18), m * 0.5 * t, Math.PI + 0.5 - i * 0.3, 2.6, m * 0.08, phase + i + 2);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Where the steamboat sits on screen: its waterline at the boat's own distance ahead.
function boatFrame(w, h) {
  const sc = DEPTH / AHEAD;
  const roadHalf = sc * ROAD * w / 2;
  const u = (roadHalf * 0.23) / 100; // drawing unit: the deck is about 100u wide, paddle boxes add 40u
  return { cx: w / 2, by: horizonOf(w, h) + sc * CAM_H * h / 2 - u * 6, u };
}

const STACKS = [-17, 17]; // smokestack x positions, in boat units
const lean = () => run.lean * 0.035; // run.lean eases toward the steering (see render)
let boatPose = null; // where the boat was drawn this frame, so its lights can follow it
const BRASS = '#c9a04a';
const BRASS_LIGHT = '#e8c878';

function glassWindow(x, y, w, h, u, arch = true) {
  const glow = ctx.createRadialGradient(x + w / 2, y + h / 2, u, x + w / 2, y + h / 2, Math.max(w, h));
  glow.addColorStop(0, '#ffe8b0');
  glow.addColorStop(1, '#d58a2a');
  ctx.fillStyle = glow;
  roundRect(x, y, w, h, arch ? [w / 2, w / 2, 1.5 * u, 1.5 * u] : 1.5 * u);
  ctx.fill();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 1.6 * u;
  ctx.stroke();
}

function rivets(x1, x2, y, u, step = 8) {
  ctx.fillStyle = BRASS_LIGHT;
  for (let x = x1; x <= x2; x += step) {
    ctx.beginPath();
    ctx.arc(x * u, y * u, 1 * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The player's riverboat, seen from just behind and above: a planked deck running to the bottom of the
// screen inside steel gunwales, sunburst paddle boxes, a two-tier cabin with arched windows and
// portholes, a domed pilot house, two ornate stacks, deck lanterns and a pennant that waves.
// It rolls on the water and leans into steering. Light positions are recorded for the night glow.
function drawBoat(w, h) {
  const { cx, by, u } = boatFrame(w, h);
  const pct = run.speed / run.cfg.maxSpeed;
  const low = h - by + 40 * u;
  const roll = calm ? 0 : Math.sin(run.time * 1.6) * 0.012;
  const bob = calm ? 0 : Math.sin(run.time * 2.3) * u * 1.2;
  const spin = run.z * 0.0025;
  const angle = lean() + roll;
  boatPose = { cx, y: by + bob, angle, u, lights: [] };
  const light = (x, y, r) => boatPose.lights.push([x, y, r]);

  // Wake: foam spreading from the hull toward the viewer, drawn on the water before the boat.
  ctx.save();
  ctx.translate(cx, by);
  ctx.fillStyle = `rgba(240, 248, 255, ${0.18 + pct * 0.15})`;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 50 * u, -4 * u);
    ctx.lineTo(side * 62 * u, -4 * u);
    ctx.lineTo(side * 130 * u, low);
    ctx.lineTo(side * 76 * u, low);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, by + bob);
  ctx.rotate(angle);

  // Pennant on a staff at the stern, rippling in the wind.
  ctx.strokeStyle = '#2c3035';
  ctx.lineWidth = 1.6 * u;
  ctx.beginPath();
  ctx.moveTo(-40 * u, -26 * u); ctx.lineTo(-40 * u, -78 * u);
  ctx.stroke();
  const wave = calm ? 0 : run.time * 6;
  ctx.fillStyle = '#a3361f';
  ctx.beginPath();
  ctx.moveTo(-40 * u, -78 * u);
  for (let i = 0; i <= 6; i++) ctx.lineTo((-40 - i * 3.2) * u, (-77 + Math.sin(wave + i) * 1.6 + i * 0.6) * u);
  for (let i = 6; i >= 0; i--) ctx.lineTo((-40 - i * 3.2) * u, (-69 + Math.sin(wave + i) * 1.6 - i * 0.6) * u);
  ctx.closePath();
  ctx.fill();

  // Ornate stacks with feathered brass crowns.
  for (const sx of STACKS) {
    const body = ctx.createLinearGradient((sx - 6) * u, 0, (sx + 6) * u, 0);
    body.addColorStop(0, '#111114');
    body.addColorStop(0.5, '#3a3a40');
    body.addColorStop(1, '#111114');
    ctx.fillStyle = body;
    ctx.fillRect((sx - 5) * u, -150 * u, 10 * u, 64 * u);
    ctx.fillStyle = BRASS;
    ctx.fillRect((sx - 6) * u, -126 * u, 12 * u, 3 * u);
    ctx.fillRect((sx - 6) * u, -112 * u, 12 * u, 2 * u);
    ctx.beginPath(); // crown: a ring of brass points
    ctx.moveTo((sx - 9) * u, -150 * u);
    for (let i = 0; i <= 6; i++) ctx.lineTo((sx - 9 + i * 3) * u, (i % 2 ? -158 : -152) * u);
    ctx.lineTo((sx + 9) * u, -148 * u);
    ctx.lineTo((sx - 9) * u, -148 * u);
    ctx.closePath();
    ctx.fill();
  }

  // Paddle boxes: brass-rimmed half discs with a sunburst of slats and the wheel turning beneath.
  for (const side of [-1, 1]) {
    const px = side * 56 * u;
    const py = -6 * u;
    const r = 21 * u;
    ctx.fillStyle = '#6a1f15';
    ctx.beginPath();
    ctx.arc(px, py, r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let k = 0; k < 9; k++) {
      const a = Math.PI + (k / 8) * Math.PI;
      ctx.fillStyle = k % 2 ? '#8f2c1d' : '#6a1f15';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, r, a, a + Math.PI / 8);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(232, 200, 120, 0.55)';
    ctx.lineWidth = 1.2 * u;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + side * spin;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * r * 0.55, py + Math.sin(a) * r * 0.55);
      ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = BRASS;
    ctx.lineWidth = 2.6 * u;
    ctx.beginPath();
    ctx.arc(px, py, r, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = BRASS;
    ctx.beginPath();
    ctx.arc(px, py, 4 * u, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(240, 248, 255, 0.8)';
    for (let k = 0; k < 5; k++) {
      const t = calm ? 0.5 : (run.time * 2 + k / 5) % 1;
      ctx.beginPath();
      ctx.arc(px + (k - 2) * 8 * u, py + 6 * u - t * 9 * u, (3 - t * 2) * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Deck: steel gunwales either side of wooden planks, widening toward the viewer.
  const half = (y) => 48 + (6 * (y + 24)) / (low / u + 24);
  ctx.fillStyle = '#4a4f55';
  ctx.beginPath();
  ctx.moveTo(-48 * u, -24 * u); ctx.lineTo(48 * u, -24 * u);
  ctx.lineTo(54 * u, low); ctx.lineTo(-54 * u, low);
  ctx.closePath();
  ctx.fill();
  const deck = ctx.createLinearGradient(-40 * u, 0, 40 * u, 0);
  deck.addColorStop(0, '#6e5236');
  deck.addColorStop(0.5, '#9a7650');
  deck.addColorStop(1, '#6e5236');
  ctx.fillStyle = deck;
  ctx.beginPath();
  ctx.moveTo(-41 * u, -24 * u); ctx.lineTo(41 * u, -24 * u);
  ctx.lineTo(46 * u, low); ctx.lineTo(-46 * u, low);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 26, 14, 0.45)';
  ctx.lineWidth = 0.9 * u;
  for (let x = -36; x <= 36; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x * u, -24 * u); ctx.lineTo(x * 1.12 * u, low);
    ctx.stroke();
  }
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 2.2 * u;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 48 * u, -24 * u); ctx.lineTo(side * 54 * u, low);
    ctx.moveTo(side * 41 * u, -24 * u); ctx.lineTo(side * 46 * u, low);
    ctx.stroke();
  }
  for (let y = 10; y * u < low; y += 34) {
    rivets(-half(y) + 2, -half(y) + 6, y, u, 4);
    rivets(half(y) - 6, half(y) - 2, y, u, 4);
  }
  // Foam where the hull cuts the water.
  ctx.strokeStyle = 'rgba(240, 248, 255, 0.85)';
  ctx.lineWidth = 2.5 * u;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let y = -4; y * u < low; y += 6) {
      const wobble = calm ? 0 : Math.sin(run.time * 8 + y * 0.5) * 1.2;
      ctx.lineTo(side * (half(y) + 2 + wobble) * u, y * u);
    }
    ctx.stroke();
  }
  // Deck fittings: a brass capstan, a speed gauge, and two lanterns on posts.
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.ellipse(-20 * u, 12 * u, 7 * u, 4 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a6420';
  ctx.fillRect(-23 * u, 2 * u, 6 * u, 10 * u);
  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.ellipse(-20 * u, 2 * u, 4 * u, 2 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f8f2e4';
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.arc(20 * u, 8 * u, 7 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#a3361f';
  ctx.lineWidth = 1.4 * u;
  ctx.beginPath();
  ctx.moveTo(20 * u, 8 * u);
  const needle = -Math.PI * 0.85 + pct * Math.PI * 0.7;
  ctx.lineTo(20 * u + Math.cos(needle) * 5.5 * u, 8 * u + Math.sin(needle) * 5.5 * u);
  ctx.stroke();
  for (const side of [-1, 1]) {
    const lx = side * 36 * u;
    ctx.fillStyle = '#2c3035';
    ctx.fillRect(lx - 1 * u, 10 * u, 2 * u, 22 * u);
    ctx.fillStyle = BRASS;
    ctx.fillRect(lx - 4 * u, 2 * u, 8 * u, 10 * u);
    ctx.fillStyle = '#ffd98a';
    ctx.fillRect(lx - 2.5 * u, 4 * u, 5 * u, 6 * u);
    light(side * 36, 7, 16);
  }

  // Lower deckhouse: teak panels, brass trim, four arched lit windows.
  const teak = ctx.createLinearGradient(-38 * u, 0, 38 * u, 0);
  teak.addColorStop(0, '#4a3220');
  teak.addColorStop(0.5, '#7a5634');
  teak.addColorStop(1, '#4a3220');
  ctx.fillStyle = teak;
  roundRect(-38 * u, -74 * u, 76 * u, 52 * u, 3 * u);
  ctx.fill();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  for (const wx of [-33, -16, 2, 19]) {
    glassWindow(wx * u, -66 * u, 12 * u, 22 * u, u);
    light(wx + 6, -55, 14);
  }
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.moveTo(-38 * u, -36 * u); ctx.lineTo(38 * u, -36 * u);
  ctx.stroke();
  rivets(-34, 34, -36, u);

  // Promenade deck with a brass railing, then the upper cabin with round portholes.
  ctx.fillStyle = '#2c3035';
  ctx.fillRect(-44 * u, -80 * u, 88 * u, 6 * u);
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 1.3 * u;
  ctx.beginPath();
  ctx.moveTo(-42 * u, -88 * u); ctx.lineTo(42 * u, -88 * u);
  for (let x = -42; x <= 42; x += 7) { ctx.moveTo(x * u, -80 * u); ctx.lineTo(x * u, -88 * u); }
  ctx.stroke();
  const upper = ctx.createLinearGradient(-26 * u, 0, 26 * u, 0);
  upper.addColorStop(0, '#4a4f55');
  upper.addColorStop(0.5, '#8e959c');
  upper.addColorStop(1, '#4a4f55');
  ctx.fillStyle = upper;
  roundRect(-26 * u, -104 * u, 52 * u, 24 * u, 3 * u);
  ctx.fill();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 1.8 * u;
  ctx.stroke();
  for (const px of [-15, 0, 15]) {
    const g = ctx.createRadialGradient(px * u, -92 * u, u, px * u, -92 * u, 6 * u);
    g.addColorStop(0, '#ffe8b0');
    g.addColorStop(1, '#d58a2a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px * u, -92 * u, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = BRASS;
    ctx.lineWidth = 1.6 * u;
    ctx.stroke();
    light(px, -92, 10);
  }

  // Domed pilot house on top, with roof lanterns at the corners of the cabin roof.
  ctx.fillStyle = '#2c3035';
  ctx.fillRect(-30 * u, -108 * u, 60 * u, 4 * u);
  ctx.fillStyle = upper;
  roundRect(-11 * u, -124 * u, 22 * u, 16 * u, 2 * u);
  ctx.fill();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
  glassWindow(-8 * u, -121 * u, 16 * u, 8 * u, u, false);
  light(0, -117, 12);
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.arc(0, -124 * u, 12 * u, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.arc(-3 * u, -130 * u, 3 * u, 0, Math.PI * 2);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.fillStyle = BRASS;
    ctx.fillRect(side * 27 * u - 3 * u, -115 * u, 6 * u, 7 * u);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.arc(side * 27 * u, -111.5 * u, 2 * u, 0, Math.PI * 2);
    ctx.fill();
    light(side * 27, -111, 10);
  }
  ctx.restore();
}

// At night the boat takes the same shade as the scene, then its windows and lanterns glow on top.
const boatLayer = document.createElement('canvas');
const boatCtx = boatLayer.getContext('2d');

function drawBoatLit(w, h) {
  if (sky.dark < 0.02 || !w || !h) return drawBoat(w, h); // a zero-size canvas can't be drawn as an image
  if (boatLayer.width !== w || boatLayer.height !== h) { boatLayer.width = w; boatLayer.height = h; }
  const main = ctx;
  ctx = boatCtx;
  ctx.clearRect(0, 0, w, h);
  drawBoat(w, h);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(10, 14, 40, ${sky.dark * 0.5})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx = main;
  ctx.drawImage(boatLayer, 0, 0);
  const { cx, y, angle, u, lights } = boatPose;
  ctx.save();
  ctx.translate(cx, y);
  ctx.rotate(angle);
  ctx.globalCompositeOperation = 'lighter';
  for (const [lx, ly, r] of lights) {
    const glow = ctx.createRadialGradient(lx * u, ly * u, 0, lx * u, ly * u, r * u);
    glow.addColorStop(0, `rgba(255, 200, 110, ${0.55 * sky.dark})`);
    glow.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect((lx - r) * u, (ly - r) * u, r * 2 * u, r * 2 * u);
  }
  ctx.restore();
}

// The bow lamp's beam at night: it starts at the bow (hidden behind the cabin), points where the boat
// is heading on the river ahead, swings as you steer, and lights a shimmering pool on the water.
function drawBeam(w, h) {
  if (sky.dark < 0.05 || !run.beamTarget) return;
  const { cx, by, u } = boatFrame(w, h);
  const t = run.beamTarget;
  const sx = cx + Math.sin(lean()) * 40 * u;
  const sy = by - 40 * u;
  const half = t.half;
  const a = sky.dark;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cone = ctx.createLinearGradient(sx, sy, t.x, t.y);
  cone.addColorStop(0, `rgba(255, 232, 180, ${0.4 * a})`);
  cone.addColorStop(1, `rgba(255, 232, 180, ${0.04 * a})`);
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(sx - 6 * u, sy);
  ctx.lineTo(t.x - half, t.y);
  ctx.lineTo(t.x + half, t.y);
  ctx.lineTo(sx + 6 * u, sy);
  ctx.closePath();
  ctx.fill();
  const pool = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, half * 1.3);
  pool.addColorStop(0, `rgba(255, 236, 190, ${0.25 * a})`);
  pool.addColorStop(1, 'rgba(255, 236, 190, 0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, half * 1.3, half * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // Glints on the water inside the beam.
  ctx.fillStyle = `rgba(255, 245, 220, ${0.5 * a})`;
  for (let i = 0; i < 12; i++) {
    const s = 0.3 + (((i * 0.618) + (calm ? 0 : run.time * 0.25)) % 1) * 0.7; // how far along the beam
    const spread = 6 * u + (half - 6 * u) * s;
    const gx = sx + (t.x - sx) * s + Math.sin(i * 12.9) * spread * 0.7;
    ctx.fillRect(gx - spread * 0.08, sy + (t.y - sy) * s, spread * 0.16, Math.max(1, u * 0.6));
  }
  ctx.restore();
}

// Smoke from both stacks rises, spreads and drifts back over the boat.
function stepSmoke(dt, w, h) {
  const { cx, by, u } = boatFrame(w, h);
  const pct = run.speed / run.cfg.maxSpeed;
  if (!run.paused && Math.random() < dt * (7 + 10 * pct)) {
    const stack = STACKS[Math.floor(Math.random() * STACKS.length)];
    run.smoke.push({ x: stack + rand(-2, 2), y: 0, vx: rand(-8, 8), r: 5, a: 0.7 });
  }
  for (const p of run.smoke) {
    p.y += dt * (35 + 45 * pct);
    p.x += dt * p.vx;
    p.r += dt * 12;
    p.a -= dt * 1.6;
  }
  run.smoke = run.smoke.filter((p) => p.a > 0);
  const tint = sky.dark > 0.3 ? '150, 150, 165' : '236, 236, 232'; // smoke greys out after dark
  for (const p of run.smoke) {
    ctx.fillStyle = `rgba(${tint}, ${p.a})`;
    ctx.beginPath();
    ctx.arc(cx + p.x * u, by - 158 * u - p.y * u, p.r * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Darkens the land and water at night; the bow lamp (drawBeam) then lights the river ahead.
function drawNight(w, h) {
  const hz = horizonOf(w, h);
  ctx.fillStyle = `rgba(10, 14, 40, ${sky.dark * 0.45})`;
  ctx.fillRect(0, hz, w, h - hz);
}

function render(dt) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  if (run.shake > 0 && !calm) ctx.translate((Math.random() - 0.5) * run.shake * w * 0.015, (Math.random() - 0.5) * run.shake * h * 0.015);
  sky = skyAt(run.z / SEG);
  run.lean = (run.lean || 0) + ((keys.right - keys.left) - (run.lean || 0)) * Math.min(1, dt * 8); // eases the boat's tilt and lamp
  drawSky(w, h);
  drawTrack(w, h);
  if (sky.dark > 0.02) {
    drawNight(w, h);
    drawBeam(w, h);
  }
  drawBoatLit(w, h);
  stepSmoke(dt, w, h);
  if (!run.demo) {
    if (run.gap < 20) drawTentacles(w, h, 1 - run.gap / 20);
    drawMirror(w, h);
  }
  ctx.restore();
  // An amber glow at the screen edges on every hit, fading over half a second, so impacts are felt.
  if (run.flash > 0) {
    const edge = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    edge.addColorStop(0, 'rgba(255, 150, 40, 0)');
    edge.addColorStop(1, `rgba(255, 150, 40, ${run.flash * 0.55})`);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);
    run.flash = Math.max(0, run.flash - dt * 2);
  }
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
  el('hud-gap').textContent = `Kraken ${Math.max(0, Math.round(run.gap))} m behind`;
  const counting = run.paused === 'countdown';
  const c = counting ? String(Math.ceil(run.countdown)) : run.callout && run.callout.until > run.time ? run.callout.text : '';
  const callout = el('callout');
  if (callout.textContent !== c) {
    callout.textContent = c;
    callout.classList.remove('pop'); // restart the pop-in for each new message or number
    void callout.offsetWidth;
    callout.classList.add('pop');
  }
  el('callout').classList.toggle('count', counting);
  const sign = el('turn-sign');
  sign.hidden = !run.turn || !!run.paused;
  if (run.turn) {
    sign.dataset.dir = run.turn > 0 ? 'right' : 'left';
    el('turn-text').textContent = run.turn > 0 ? 'Bend right' : 'Bend left';
  }
  el('hud-fault').hidden = !(run.warned || run.pendingFault > 0) || !!run.paused;
  el('hud-fault').textContent = run.pendingFault > 0 ? 'Engine damaged' : 'Engine trouble ahead';
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
  Sound.setEngine(run.demo || run.paused ? null : run.speed / run.cfg.maxSpeed);
  if (run.demo && calm) return; // reduced motion: the menu shows one still frame
  if (!run.demo) {
    // The needle eases toward the true speed each frame instead of jumping with the 10 Hz HUD.
    const mph = run.speed * MPH_PER_UNIT;
    run.needle = calm ? mph : run.needle + (mph - run.needle) * Math.min(1, dt * 8);
    el('speedo-needle').setAttribute('transform', `rotate(${dialAngle(run.needle)})`);
    run.hud += dt;
    if (run.hud > 0.1 || run.paused) { run.hud = 0; hud(); }
  }
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
  circuits: 'Fit signal boxes into the circuit, then run the test cycle.',
  coding: 'Pick what a short Python snippet prints.',
  mixed: 'Fix a signal circuit or pick what a Python snippet prints.',
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

function renderBoard() {
  const mode = selectedMode();
  const list = topFive(mode);
  el('top-mode').textContent = MODES[mode].label;
  el('top-empty').hidden = list.length > 0;
  el('top-list').replaceChildren(...list.map((entry) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), { className: 'who', textContent: entry.name }),
      Object.assign(document.createElement('span'), { className: 'far', textContent: `${entry.metres.toLocaleString()} m` }));
    return li;
  }));
}

function renderBest() {
  renderBoard();
  const best = loadBest();
  for (const mode of Object.keys(MODES)) {
    el(`best-${mode}`).textContent = best[mode] ? `Your best: ${best[mode].toLocaleString()} m` : 'No run yet';
  }
}

// The menu and briefing float over a live scene: an Easy run that drives itself, opening at sunset.
function startDemo() {
  newRun('easy', 'circuits');
  run.demo = true;
  run.faultAt = Infinity;
  run.z = 3800 * SEG; // the menu's demo opens at sunset (3800 + START_AT wraps to 2300 m into the cycle)
  run.written = Math.floor(run.z / SEG);
  fillTrack();
  run.speed = run.cfg.maxSpeed * 0.75;
  keys.left = keys.right = false;
  canvas.setAttribute('aria-hidden', 'true');
  resize();
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function startRun() {
  newRun(selectedMode(), selectedCategory());
  keys.left = keys.right = false;
  canvas.removeAttribute('aria-hidden');
  show('drive');
  resize();
  el('paused').hidden = true;
  announce(`${run.cfg.label} run started. Steer with the arrow keys.`);
  shout('Full steam ahead!', 2);
  Sound.fx.whistle();
  canvas.focus();
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

// The loss screen's distance counts up from zero. The final number is set first, so it is right
// even if the timer never runs (and is all that shows with reduced motion).
function countUp(target, metres) {
  target.textContent = `${metres.toLocaleString()} m`;
  if (calm || metres < 1) return;
  const started = performance.now();
  const timer = setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / 900);
    target.textContent = `${Math.round(metres * (1 - (1 - t) ** 3)).toLocaleString()} m`;
    if (t === 1) clearInterval(timer);
  }, 30);
}

function finish(cause = 'monster') {
  if (run.over) return;
  run.over = true;
  cancelAnimationFrame(raf);
  Sound.setEngine(null);
  Sound.fx.sink();
  const metres = Math.floor(run.z / SEG);
  const best = loadBest();
  const record = metres > (best[run.mode] || 0);
  if (record) { best[run.mode] = metres; saveBest(best); }
  countUp(el('over-distance'), metres);
  run.metres = metres;
  const form = el('score-form');
  form.hidden = !makesTopFive(run.mode, metres);
  el('score-note').textContent = '';
  el('score-error').textContent = '';
  el('score-name').removeAttribute('aria-invalid');
  el('score-name').value = lastName();
  announce(cause === 'whirlpool' ? `The boat was pulled into a whirlpool after ${metres} metres.` : `The kraken caught the boat after ${metres} metres.`);
  el('over').showModal();
  if (!form.hidden) el('score-name').focus();
}

function pause(on) {
  if (!run || run.demo || run.over || run.paused === 'repair' || run.paused === 'countdown') return;
  run.paused = on ? 'menu' : null;
  el('paused').hidden = !on;
  keys.left = keys.right = false;
  if (on) el('resume').focus();
  else { last = performance.now(); canvas.focus(); }
}

function toMenu() {
  if (run) { run.over = true; cancelAnimationFrame(raf); }
  Sound.setEngine(null);
  if (el('over').open) el('over').close();
  renderBest();
  show('menu');
  startDemo();
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
window.addEventListener('resize', resize);

el('start').addEventListener('click', showBriefing);
for (const input of document.querySelectorAll('input[name="difficulty"]')) input.addEventListener('change', renderBoard);

el('score-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = el('score-name');
  const name = input.value.replace(/\s+/g, ' ').trim();
  if (!NAME_OK.test(name)) {
    el('score-error').textContent = name ? 'Use letters, numbers, spaces, dots, dashes or underscores, up to 16 characters.' : 'Type a name first.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  const scores = loadScores();
  const list = [...(scores[run.mode] || []), { name, metres: run.metres }].sort((a, b) => b.metres - a.metres).slice(0, TOP);
  scores[run.mode] = list;
  saveScores(scores);
  try { localStorage.setItem(NAME_KEY, name); } catch { /* the name just won't be remembered */ }
  el('score-form').hidden = true;
  el('score-note').textContent = `Saved. You're number ${list.findIndex((x) => x.name === name && x.metres === run.metres) + 1} on ${run.cfg.label}.`;
  el('again').focus();
});
el('score-name').addEventListener('input', () => {
  el('score-error').textContent = '';
  el('score-name').removeAttribute('aria-invalid');
});
el('go').addEventListener('click', startRun);
el('mute').checked = Sound.muted;
el('mute').addEventListener('change', () => Sound.setMuted(el('mute').checked));
el('brief-back').addEventListener('click', toMenu);
el('again').addEventListener('click', () => { el('over').close(); startRun(); });
el('to-menu').addEventListener('click', toMenu);
el('over').addEventListener('cancel', (e) => { e.preventDefault(); toMenu(); });
el('pause-btn').addEventListener('click', () => pause(true));
el('resume').addEventListener('click', () => pause(false));
el('quit').addEventListener('click', toMenu);
el('to-practice').addEventListener('click', () => {
  cancelAnimationFrame(raf); // the scene is hidden behind the practice screen
  show('practice');
  el('practice-back').focus();
});
el('practice-back').addEventListener('click', toMenu);

// ---- Solana ------------------------------------------------------------------

const short = (key) => `${key.slice(0, 4)}…${key.slice(-4)}`;
const link = (href, text) => Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener' });

el('record').addEventListener('click', async () => {
  const note = el('record-note');
  const mode = selectedMode();
  const best = topFive(mode)[0];
  if (!best) {
    note.textContent = `Finish a run on ${MODES[mode].label} and save your name first, then record it here.`;
    return;
  }
  note.textContent = `Recording ${best.name}'s ${best.metres.toLocaleString()} m on ${MODES[mode].label}. Approve the transaction in Phantom.`;
  el('record').hidden = true;
  try {
    const sig = await Chain.record(mode, best.metres, best.name);
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
    const runs = await Chain.leaderboard(TOP);
    note.textContent = runs.length ? 'Best recorded runs, read live from the Solana devnet.' : 'No runs recorded yet. Finish a run and record it to claim the top spot.';
    list.replaceChildren(...runs.map((r) => {
      const li = document.createElement('li');
      li.append(`${r.metres.toLocaleString()} m, ${MODES[r.difficulty].label}, ${r.name || (r.player ? short(r.player) : 'unknown wallet')} `, link(Chain.explorer(r.signature), 'proof'));
      return li;
    }));
  } catch (err) {
    note.textContent = Chain.explain(err);
  }
});

renderBest();
startDemo();
// Test hook for driving the game from the browser console; only exists when the URL ends in #debug.
if (location.hash === '#debug') window.sjDebug = { get run() { return run; }, keys, segAt: (a) => segAt(a), SEG, AHEAD };
})();
