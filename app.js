const NS = 'http://www.w3.org/2000/svg';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
const STORE = 'steel-mill-done';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = matchMedia('(max-width: 560px)'); // phones get larger board text (see style.css), so labels sit lower
const SLOT_W = 76;
const R = 32;

const $ = (id) => document.getElementById(id);
const level = () => LEVELS[state.plate];
const say = (msg) => { $('status').textContent = msg; };
const busy = () => say('The inspector is mid-test. Wait for the cycle to finish.');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const word = (hot) => (hot ? 'ready' : 'idle');
const pipes = (n) => (n === 1 ? 'one track' : 'two tracks');
const slotNo = (id) => id.slice(1);

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state.done)); } catch { /* blocked storage: progress lasts this visit only */ }
}

// repair is set while the driving game has a timed engine fault open (see Workshop.repair below).
const state = { plate: 0, valves: {}, boilers: {}, part: null, running: false, rows: null, testing: -1, done: load(), repair: null };

function svg(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

function html(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function pressable(g, fn) {
  g.setAttribute('tabindex', '0');
  g.addEventListener('click', fn);
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  });
}

// Board geometry: tracks leave a node's right edge and enter the next node's left edge.
const outPort = (n) => [n.x + (n.kind === 'boiler' ? R : SLOT_W / 2), n.y];
const inPort = (n, i, count) =>
  n.kind === 'piston' ? [n.x - 50, n.y] : [n.x - SLOT_W / 2, n.y + (count === 2 ? (i ? 16 : -16) : 0)];
const pathFor = ([x1, y1], [x2, y2], turnX) => {
  const mx = turnX ?? Math.round((x1 + x2) / 2);
  return `M${x1} ${y1} H${mx} V${y2} H${x2}`;
};

// A steam engine facing right, toward its track. Drawn back to front so nearer parts overlap.
function drawEngine(g, x, y) {
  // Smoke drifts up and back from the chimney, as if the engine is moving.
  [[x + 9, y - 44, 6], [x + 16, y - 38, 5], [x + 22, y - 33, 4]].forEach(([cx, cy, r]) => svg('circle', { cx, cy, r, class: 'puff' }, g));
  svg('rect', { x: x - 36, y: y - 22, width: 22, height: 30, class: 'loco' }, g); // cab
  svg('rect', { x: x - 31, y: y - 17, width: 11, height: 9, class: 'window' }, g);
  svg('rect', { x: x - 40, y: y - 27, width: 30, height: 5, rx: 1, class: 'iron' }, g); // cab roof
  svg('path', { d: `M${x - 2} ${y - 11} a6 6 0 0 1 12 0 z`, class: 'loco' }, g); // steam dome
  svg('path', { d: `M${x + 19} ${y - 12} V${y - 24} H${x + 17} V${y - 29} H${x + 29} V${y - 24} H${x + 27} V${y - 12} z`, class: 'iron' }, g); // chimney
  svg('rect', { x: x - 15, y: y - 12, width: 38, height: 18, rx: 2, class: 'loco' }, g); // boiler
  [-6, 6, 14].forEach((dx) => svg('line', { x1: x + dx, y1: y - 12, x2: x + dx, y2: y + 6, class: 'band' }, g));
  svg('rect', { x: x + 22, y: y - 14, width: 9, height: 22, rx: 2, class: 'iron' }, g); // smokebox
  svg('rect', { x: x - 39, y: y + 6, width: 72, height: 4, class: 'frame' }, g); // running board
  svg('path', { d: `M${x + 30} ${y + 10} L${x + 39} ${y + 25} H${x + 27} z`, class: 'iron' }, g); // cowcatcher
  // Two spoked driving wheels joined by a coupling rod, and a small leading wheel. All sit on y + 26.
  [[x - 24, 8], [x - 5, 8], [x + 18, 5]].forEach(([cx, r]) => {
    const cy = y + 26 - r;
    svg('circle', { cx, cy, r, class: 'wheel' }, g);
    [0, 45, 90, 135].forEach((deg) => {
      const dx = Math.cos((deg * Math.PI) / 180) * (r - 1.5);
      const dy = Math.sin((deg * Math.PI) / 180) * (r - 1.5);
      svg('line', { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, class: 'spoke' }, g);
    });
  });
  svg('line', { x1: x - 24, y1: y + 18, x2: x - 5, y2: y + 18, class: 'rod-bar' }, g); // coupling rod
}

function buildBoard() {
  const lv = level();
  const board = $('board');
  board.replaceChildren();
  const big = narrow.matches;
  const [labelDy, stateDy] = big ? [29, 62] : [22, 46];
  // Fit the viewBox to the pieces: engine smoke and box roofs on top, state labels at the bottom, the departed train on the right.
  const nodes = Object.values(lv.nodes);
  const top = Math.min(...nodes.map((n) => n.y)) - 58;
  const bottom = Math.max(...nodes.map((n) => n.y)) + R + stateDy + 10;
  const right = Math.max(...nodes.map((n) => n.x + (n.kind === 'piston' ? 112 : 50)));
  board.setAttribute('viewBox', `0 ${top} ${right} ${bottom - top}`);

  lv.wires.forEach((wire) => {
    const [from, to, turnX] = wire;
    const into = lv.wires.filter((w) => w[1] === to);
    const d = pathFor(outPort(lv.nodes[from]), inPort(lv.nodes[to], into.indexOf(wire), into.length), turnX);
    const g = svg('g', { class: 'pipe', 'data-from': from, 'aria-hidden': 'true' }, board);
    ['sleepers', 'tube', 'bore', 'flow'].forEach((c) => svg('path', { d, class: c }, g));
  });

  for (const [id, n] of Object.entries(lv.nodes)) {
    const g = svg('g', { 'data-id': id }, board);
    const { x, y } = n;
    if (n.kind === 'boiler') {
      g.setAttribute('class', 'boiler');
      g.setAttribute('role', 'switch');
      g.setAttribute('aria-label', `Engine ${id}`);
      svg('rect', { x: x - 45, y: y - 56, width: 90, height: 92, rx: 6, class: 'ring' }, g);
      drawEngine(g, x, y);
      svg('text', { x, y: y + R + labelDy, class: 'label' }, g).textContent = `Engine ${id}`;
      svg('text', { x, y: y + R + stateDy, class: 'state' }, g);
      pressable(g, () => toggleBoiler(id));
    } else if (n.kind === 'slot') {
      g.setAttribute('class', 'slot');
      g.setAttribute('role', 'button');
      svg('rect', { x: x - 46, y: y - 52, width: 92, height: 88, rx: 5, class: 'ring' }, g);
      svg('polygon', { points: `${x - 42},${y - 28} ${x},${y - 46} ${x + 42},${y - 28}`, class: 'roof' }, g);
      svg('rect', { x: x - SLOT_W / 2, y: y - 28, width: SLOT_W, height: 56, rx: 3, class: 'body' }, g);
      svg('text', { x: n.x, y: n.y + 6, class: 'name' }, g);
      pressable(g, () => useSlot(id));
      g.addEventListener('dragover', (e) => { e.preventDefault(); g.classList.add('target'); });
      g.addEventListener('dragleave', () => syncParts());
      g.addEventListener('drop', (e) => { e.preventDefault(); place(id, e.dataTransfer.getData('text/plain')); });
    } else {
      g.setAttribute('class', 'piston');
      g.setAttribute('role', 'img');
      // The station: a platform and the express (a carriage behind an engine) that pulls away when the line clears.
      svg('rect', { x: x - 50, y: y + 26, width: 124, height: 5, class: 'frame' }, g);
      const train = svg('g', { class: 'rod' }, g);
      svg('rect', { x: x - 48, y: y - 16, width: 32, height: 26, rx: 2, class: 'loco' }, train);
      svg('rect', { x: x - 50, y: y - 20, width: 36, height: 4, rx: 1, class: 'iron' }, train);
      [-44, -30].forEach((dx) => svg('rect', { x: x + dx, y: y - 11, width: 10, height: 9, class: 'window' }, train));
      [-42, -22].forEach((dx) => svg('circle', { cx: x + dx, cy: y + 21, r: 5, class: 'wheel' }, train));
      drawEngine(train, x + 24, y);
      svg('text', { x: x + 8, y: y + R + labelDy, class: 'label' }, g).textContent = 'Express';
      svg('text', { x: x + 8, y: y + R + stateDy, class: 'state' }, g);
    }
  }
}

// Redraws tracks, engines, boxes and the express from state. Returns the simulation.
function update() {
  const lv = level();
  const sim = simulate(lv, state.boilers, state.valves);
  const board = $('board');
  board.querySelectorAll('.pipe').forEach((g) => g.classList.toggle('hot', sim[g.dataset.from]));
  for (const [id, n] of Object.entries(lv.nodes)) {
    const g = board.querySelector(`[data-id="${id}"]`);
    if (n.kind === 'boiler') {
      g.classList.toggle('hot', sim[id]);
      g.setAttribute('aria-checked', String(sim[id]));
      g.querySelector('.state').textContent = word(sim[id]);
    } else if (n.kind === 'slot') {
      const v = state.valves[id];
      g.classList.toggle('filled', !!v);
      g.querySelector('.name').textContent = v ? PARTS[v].label : 'empty';
      g.setAttribute('aria-label', `Slot ${slotNo(id)}, takes ${pipes(n.inputs)}, ${v ? `${PARTS[v].label} fitted` : 'empty'}`);
    } else {
      g.classList.toggle('fired', sim.P);
      g.querySelector('.state').textContent = sim.P ? 'departed' : 'waiting';
      g.setAttribute('aria-label', `Express, ${sim.P ? 'departed' : 'waiting'}`);
    }
  }
  return sim;
}

function renderLedger() {
  const lv = level();
  const ids = idsOf(lv, 'boiler');
  const head = html('tr', {},
    ...ids.map((id) => html('th', { scope: 'col' }, html('span', { className: 'sr-only', textContent: 'Engine ' }), id)),
    html('th', { scope: 'col', textContent: 'Wanted' }),
    html('th', { scope: 'col', textContent: 'Got' }),
    html('th', { scope: 'col', textContent: 'Check' }));
  const body = settings(lv).map((b, i) => {
    const r = state.rows && state.rows[i];
    const tr = html('tr', {},
      ...ids.map((id) => html('td', { textContent: word(b[id]) })),
      html('td', { textContent: lv.target(b) ? 'departs' : 'waits' }),
      html('td', {}, r ? (r.got ? 'departs' : 'waits') : html('span', { className: 'sr-only', textContent: 'not tested' })),
      html('td', { textContent: r ? (r.ok ? '✓ match' : '✗ wrong') : '' }));
    tr.classList.toggle('testing', i === state.testing);
    tr.classList.toggle('wrong', !!r && !r.ok);
    return tr;
  });
  $('ledger').replaceChildren(html('thead', {}, head), html('tbody', {}, ...body));

  const total = body.length;
  const wrong = state.rows ? state.rows.filter((r) => r && !r.ok).length : 0;
  $('ledger-note').textContent = state.running
    ? `Testing setting ${state.testing + 1} of ${total}…`
    : !state.rows
      ? 'Run the test cycle and the inspector fills in what the express actually did.'
      : wrong
        ? `${wrong} of ${total} settings are wrong. Change a box and run the cycle again.`
        : `All ${total} settings match.`;
}

function syncPlates() {
  $('plates').querySelectorAll('button').forEach((b, i) => {
    const done = state.done.includes(i);
    b.replaceChildren(ROMAN[i], ...(done ? [html('span', { className: 'done', textContent: '✓' })] : []));
    if (done) b.lastChild.setAttribute('aria-hidden', 'true');
    b.setAttribute('aria-label', `Plate ${i + 1}, ${LEVELS[i].title}${done ? ', done' : ''}`);
    if (i === state.plate) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
}

// Marks the picked part and outlines the slots it fits.
function syncParts() {
  $('parts').querySelectorAll('.part').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.key === state.part));
    b.hidden = (PARTS[b.dataset.key].from || 0) > state.plate;
  });
  const fits = state.part && PARTS[state.part].inputs;
  $('board').querySelectorAll('.slot').forEach((g) => g.classList.toggle('target', fits === level().nodes[g.dataset.id].inputs));
}

function pick(key) {
  state.part = key;
  syncParts();
  say(key ? `${PARTS[key].label} picked up. Choose a slot to fit it.` : 'Put back in the drawer.');
}

function changed(msg) {
  state.rows = null;
  $('verdict').replaceChildren();
  update();
  renderLedger();
  say(msg);
}

function place(id, key) {
  if (state.running) return busy();
  const p = PARTS[key];
  if (!p) return;
  const n = level().nodes[id];
  syncParts();
  if (p.inputs !== n.inputs) return say(`${p.label} needs ${pipes(p.inputs)} coming in, but slot ${slotNo(id)} has ${pipes(n.inputs)}.`);
  state.valves[id] = key;
  changed(`${p.label} fitted in slot ${slotNo(id)}.`);
}

function useSlot(id) {
  if (state.running) return busy();
  const had = state.valves[id];
  if (state.part) place(id, state.part);
  else if (had) {
    delete state.valves[id];
    changed(`Took the ${PARTS[had].label} out of slot ${slotNo(id)}.`);
  } else say('Pick a signal box from the drawer first, then choose this slot.');
}

function toggleBoiler(id) {
  if (state.running) return busy();
  state.boilers[id] = !state.boilers[id];
  const sim = update();
  say(`Engine ${id} is ${word(sim[id])}. The express ${sim.P ? 'departs' : 'waits at the platform'}.`);
}

async function runCycle() {
  if (state.running) return busy();
  const lv = level();
  const empty = idsOf(lv, 'slot').filter((id) => !state.valves[id]);
  if (empty.length) {
    return say(`Fit a box in every slot first. ${empty.length === 1 ? `Slot ${slotNo(empty[0])} is` : `${empty.length} slots are`} still empty.`);
  }

  const all = settings(lv);
  const job = state.repair;
  const before = { ...state.boilers };
  const btn = $('run');
  state.running = true;
  state.rows = [];
  $('verdict').replaceChildren();
  say('Test cycle started.');
  for (let i = 0; i < all.length; i++) {
    state.testing = i;
    btn.textContent = `Testing ${i + 1} of ${all.length}…`;
    state.boilers = { ...all[i] };
    const sim = update();
    renderLedger();
    await wait(state.repair ? 120 : reduced ? 300 : Math.min(1000, 5000 / all.length)); // repairs are on a clock, so test fast
    if (job !== state.repair) return; // the repair timer ran out mid-test
    state.rows[i] = { got: sim.P, ok: sim.P === lv.target(all[i]) };
  }
  state.running = false;
  state.testing = -1;
  btn.textContent = 'Run the test cycle';
  state.boilers = before;
  update();
  renderLedger();

  const bad = state.rows.findIndex((r) => !r.ok);
  if (bad < 0) return win();
  const b = all[bad];
  const setting = new Intl.ListFormat('en').format(idsOf(lv, 'boiler').map((id) => `${id} ${word(b[id])}`));
  say(`Not yet. With ${setting}, the order wants the express to ${lv.target(b) ? 'depart' : 'wait'}, but it ${state.rows[bad].got ? 'departed' : 'stayed at the platform'}.`);
}

function win() {
  if (state.repair) return endRepair(true);
  if (!state.done.includes(state.plate)) {
    state.done.push(state.plate);
    save();
  }
  syncPlates();
  const after = LEVELS.findIndex((_, i) => i > state.plate && !state.done.includes(i));
  const next = after >= 0 ? after : LEVELS.findIndex((_, i) => !state.done.includes(i));
  const parts = [html('p', {}, html('strong', { textContent: 'Order filled' }), `Every setting matches. Plate ${ROMAN[state.plate]} is done.`)];
  let btn = null;
  if (next >= 0) {
    btn = html('button', { type: 'button', className: 'run', textContent: `Go to plate ${ROMAN[next]}` });
    btn.addEventListener('click', () => goTo(next));
    parts.push(btn);
  } else {
    parts.push(html('p', { textContent: 'Every plate on the line is done. You have built NOT, AND, OR, XOR, and a majority vote by hand.' }));
  }
  $('verdict').replaceChildren(...parts);
  say('Order filled. Every setting matches.');
  if (btn) btn.focus();
}

function goTo(i) {
  if (state.running) return busy();
  Object.assign(state, { plate: i, valves: {}, boilers: {}, part: null, rows: null, testing: -1 });
  const lv = level();
  $('plate-no').textContent = `Plate ${ROMAN[i]} of ${ROMAN[LEVELS.length - 1]}`;
  $('plate-title').textContent = lv.title;
  $('order').textContent = lv.order;
  $('lesson-title').textContent = lv.lesson.name;
  $('lesson-text').textContent = lv.lesson.text;
  $('verdict').replaceChildren();
  buildBoard();
  update();
  renderLedger();
  syncPlates();
  syncParts();
  say('');
}

$('plates').append(...LEVELS.map((_, i) => {
  const b = html('button', { type: 'button' });
  b.addEventListener('click', () => goTo(i));
  return html('li', {}, b);
}));

$('parts').append(...Object.entries(PARTS).map(([key, p]) => {
  const b = html('button', { type: 'button', className: 'part', textContent: p.label, draggable: true });
  b.dataset.key = key;
  b.addEventListener('click', () => pick(state.part === key ? null : key));
  b.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'copy';
  });
  return b;
}));

$('run').addEventListener('click', runCycle);
$('clear').addEventListener('click', () => {
  if (state.running) return busy();
  state.valves = {};
  changed('Boxes cleared. Every slot is empty.');
});
narrow.addEventListener('change', () => {
  buildBoard();
  update();
  syncParts();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.part) pick(null);
});

// ---- Engine faults (used by game.js) ------------------------------------------
// One timed pop-up for every kind of fault. mount() fills the pop-up and returns a cleanup function.
let fault = null;

function endRepair(ok) {
  if (!fault) return;
  const job = fault;
  fault = null;
  clearInterval(job.tick);
  $('repair').close();
  job.unmount();
  job.resolve(ok);
}

// Resolves true when the fault is fixed in time, false when the clock runs out.
function openRepair(seconds, task, mount) {
  return new Promise((resolve) => {
    $('repair-task').textContent = task;
    const unmount = mount();
    const deadline = performance.now() + seconds * 1000;
    const show = () => {
      const left = Math.max(0, (deadline - performance.now()) / 1000);
      const whole = Math.ceil(left);
      $('repair-time').textContent = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
      $('repair-bar').style.width = `${(left / seconds) * 100}%`;
      // The bar turns amber, then red, as time runs out; the seconds stay visible for anyone who can't tell the colours apart.
      $('repair-bar').parentElement.classList.toggle('low', left / seconds < 0.35);
      $('repair-bar').parentElement.classList.toggle('critical', left / seconds < 0.15);
      if (left <= 0) endRepair(false);
    };
    fault = { resolve, unmount, tick: setInterval(show, 100) };
    show();
    $('repair').showModal();
  });
}

// Circuit faults borrow the practice workshop: it moves into the pop-up, then goes back.
const Workshop = {
  repair(plate, seconds) {
    return openRepair(seconds, 'Fix the signal circuit to restart the engine.', () => {
      $('repair-slot').append($('workshop'));
      state.repair = {}; // marks the workshop as on the clock (see runCycle and win)
      goTo(plate);
      say('Engine fault. Fit the right signal boxes, then run the test cycle.');
      return () => {
        state.repair = null;
        Object.assign(state, { running: false, testing: -1 });
        $('run').textContent = 'Run the test cycle';
        $('practice-slot').append($('workshop'));
      };
    });
  },
};
// A fault cannot be dismissed with Escape; Escape still drops a picked box.
$('repair').addEventListener('cancel', (e) => e.preventDefault());

$('howto').open = state.done.length === 0;
const firstOpen = LEVELS.findIndex((_, i) => !state.done.includes(i));
goTo(firstOpen >= 0 ? firstOpen : 0);
