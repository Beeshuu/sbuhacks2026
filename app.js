const NS = 'http://www.w3.org/2000/svg';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
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
const word = (hot) => (hot ? 'hot' : 'cold');
const pipes = (n) => (n === 1 ? 'one pipe' : 'two pipes');
const slotNo = (id) => id.slice(1);

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state.done)); } catch { /* blocked storage: progress lasts this visit only */ }
}

const state = { plate: 0, valves: {}, boilers: {}, part: null, running: false, rows: null, testing: -1, done: load() };

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

// Board geometry: pipes leave a node's right edge and enter the next node's left edge.
const outPort = (n) => [n.x + (n.kind === 'boiler' ? R : SLOT_W / 2), n.y];
const inPort = (n, i, count) =>
  n.kind === 'piston' ? [n.x - 44, n.y] : [n.x - SLOT_W / 2, n.y + (count === 2 ? (i ? 16 : -16) : 0)];
const pathFor = ([x1, y1], [x2, y2]) => {
  const mx = Math.round((x1 + x2) / 2);
  return `M${x1} ${y1} H${mx} V${y2} H${x2}`;
};

function buildBoard() {
  const lv = level();
  const board = $('board');
  board.replaceChildren();
  // One-boiler plates sit on a single row, so crop the empty top and bottom.
  const big = narrow.matches;
  const [labelDy, stateDy] = big ? [29, 62] : [22, 46];
  board.setAttribute('viewBox', idsOf(lv, 'boiler').length > 1 ? `0 0 560 ${big ? 326 : 308}` : `0 100 560 ${big ? 162 : 142}`);

  lv.wires.forEach((wire) => {
    const [from, to] = wire;
    const into = lv.wires.filter((w) => w[1] === to);
    const d = pathFor(outPort(lv.nodes[from]), inPort(lv.nodes[to], into.indexOf(wire), into.length));
    const g = svg('g', { class: 'pipe', 'data-from': from, 'aria-hidden': 'true' }, board);
    ['tube', 'bore', 'flow'].forEach((c) => svg('path', { d, class: c }, g));
  });

  for (const [id, n] of Object.entries(lv.nodes)) {
    const g = svg('g', { 'data-id': id }, board);
    if (n.kind === 'boiler') {
      g.setAttribute('class', 'boiler');
      g.setAttribute('role', 'switch');
      g.setAttribute('aria-label', `Boiler ${id}`);
      svg('circle', { cx: n.x, cy: n.y, r: R + 7, class: 'ring' }, g);
      svg('circle', { cx: n.x, cy: n.y, r: R, class: 'face' }, g);
      [-60, 0, 60].forEach((deg) => {
        const a = (deg * Math.PI) / 180;
        const at = (r) => [n.x + r * Math.sin(a), n.y - r * Math.cos(a)];
        const [x1, y1] = at(R - 9);
        const [x2, y2] = at(R - 3);
        svg('line', { x1, y1, x2, y2, class: 'tick' }, g);
      });
      svg('line', { x1: n.x, y1: n.y, x2: n.x, y2: n.y - 22, class: 'needle' }, g);
      svg('circle', { cx: n.x, cy: n.y, r: 4, class: 'hub' }, g);
      svg('text', { x: n.x, y: n.y + R + labelDy, class: 'label' }, g).textContent = `Boiler ${id}`;
      svg('text', { x: n.x, y: n.y + R + stateDy, class: 'state' }, g);
      pressable(g, () => toggleBoiler(id));
    } else if (n.kind === 'slot') {
      g.setAttribute('class', 'slot');
      g.setAttribute('role', 'button');
      svg('rect', { x: n.x - 44, y: n.y - 34, width: 88, height: 68, rx: 5, class: 'ring' }, g);
      svg('rect', { x: n.x - SLOT_W / 2, y: n.y - 28, width: SLOT_W, height: 56, rx: 3, class: 'body' }, g);
      svg('text', { x: n.x, y: n.y + 6, class: 'name' }, g);
      pressable(g, () => useSlot(id));
      g.addEventListener('dragover', (e) => { e.preventDefault(); g.classList.add('target'); });
      g.addEventListener('dragleave', () => syncParts());
      g.addEventListener('drop', (e) => { e.preventDefault(); place(id, e.dataTransfer.getData('text/plain')); });
    } else {
      g.setAttribute('class', 'piston');
      g.setAttribute('role', 'img');
      svg('rect', { x: n.x - 44, y: n.y - 24, width: 60, height: 48, rx: 4, class: 'face' }, g);
      const rod = svg('g', { class: 'rod' }, g);
      svg('rect', { x: n.x + 16, y: n.y - 6, width: 30, height: 12, class: 'rodbar' }, rod);
      svg('rect', { x: n.x + 46, y: n.y - 20, width: 10, height: 40, class: 'head' }, rod);
      svg('text', { x: n.x - 4, y: n.y + 24 + labelDy, class: 'label' }, g).textContent = 'Piston';
      svg('text', { x: n.x - 4, y: n.y + 24 + stateDy, class: 'state' }, g);
    }
  }
}

// Redraws steam, gauges, valves and piston from state. Returns the simulation.
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
      g.querySelector('.state').textContent = sim.P ? 'fired' : 'at rest';
      g.setAttribute('aria-label', `Piston, ${sim.P ? 'fired' : 'at rest'}`);
    }
  }
  return sim;
}

function renderLedger() {
  const lv = level();
  const ids = idsOf(lv, 'boiler');
  const head = html('tr', {},
    ...ids.map((id) => html('th', { scope: 'col' }, html('span', { className: 'sr-only', textContent: 'Boiler ' }), id)),
    html('th', { scope: 'col', textContent: 'Wanted' }),
    html('th', { scope: 'col', textContent: 'Got' }),
    html('th', { scope: 'col', textContent: 'Check' }));
  const body = settings(lv).map((b, i) => {
    const r = state.rows && state.rows[i];
    const tr = html('tr', {},
      ...ids.map((id) => html('td', { textContent: word(b[id]) })),
      html('td', { textContent: lv.target(b) ? 'fires' : 'rests' }),
      html('td', {}, r ? (r.got ? 'fires' : 'rests') : html('span', { className: 'sr-only', textContent: 'not tested' })),
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
      ? 'Run the test cycle and the inspector fills in what the piston actually did.'
      : wrong
        ? `${wrong} of ${total} settings are wrong. Change a valve and run the cycle again.`
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

// Marks the picked valve and outlines the slots it fits.
function syncParts() {
  $('parts').querySelectorAll('.part').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === state.part)));
  const fits = state.part && PARTS[state.part].inputs;
  $('board').querySelectorAll('.slot').forEach((g) => g.classList.toggle('target', fits === level().nodes[g.dataset.id].inputs));
}

function pick(key) {
  state.part = key;
  syncParts();
  say(key ? `${PARTS[key].label} picked up. Choose a slot to fit it.` : 'Valve put back in the drawer.');
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
  } else say('Pick a valve from the drawer first, then choose this slot.');
}

function toggleBoiler(id) {
  if (state.running) return busy();
  state.boilers[id] = !state.boilers[id];
  const sim = update();
  say(`Boiler ${id} is ${word(sim[id])}. The piston ${sim.P ? 'fires' : 'stays at rest'}.`);
}

async function runCycle() {
  if (state.running) return busy();
  const lv = level();
  const empty = idsOf(lv, 'slot').filter((id) => !state.valves[id]);
  if (empty.length) {
    return say(`Fit a valve in every slot first. ${empty.length === 1 ? `Slot ${slotNo(empty[0])} is` : `${empty.length} slots are`} still empty.`);
  }

  const all = settings(lv);
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
    await wait(reduced ? 300 : 1000);
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
  const setting = idsOf(lv, 'boiler').map((id) => `${id} ${word(b[id])}`).join(' and ');
  say(`Not yet. With ${setting}, the order wants the piston to ${lv.target(b) ? 'fire' : 'rest'}, but it ${state.rows[bad].got ? 'fired' : 'stayed at rest'}.`);
}

function win() {
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
    parts.push(html('p', { textContent: 'Every plate in the mill is done. You have built NOT, AND, OR, and two of their combinations by hand.' }));
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
  document.title = `Plate ${ROMAN[i]}: ${lv.title} · Steel Mill`;
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
  changed('Valves cleared. Every slot is empty.');
});
narrow.addEventListener('change', () => {
  buildBoard();
  update();
  syncParts();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.part) pick(null);
});

$('howto').open = state.done.length === 0;
const firstOpen = LEVELS.findIndex((_, i) => !state.done.includes(i));
goTo(firstOpen >= 0 ? firstOpen : 0);
