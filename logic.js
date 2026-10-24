// Game rules with no DOM, so logic.test.js can run them in Node.
// Board kinds: 'boiler' is an engine (input), 'slot' takes a signal box, 'piston' is the station (output).

const PARTS = {
  pipe: { label: 'Track', inputs: 1, run: ([a]) => a },
  not: { label: 'NOT', inputs: 1, run: ([a]) => !a },
  and: { label: 'AND', inputs: 2, run: ([a, b]) => a && b },
  or: { label: 'OR', inputs: 2, run: ([a, b]) => a || b },
  xor: { label: 'XOR', inputs: 2, run: ([a, b]) => a !== b, from: 6 }, // appears in the drawer from plate VII
};

// Engines sit 155 to 160 apart so one engine's labels clear the smoke of the engine below.
const pair = { A: { kind: 'boiler', x: 80, y: 70 }, B: { kind: 'boiler', x: 80, y: 230 } };
const trio = { A: { kind: 'boiler', x: 80, y: 60 }, B: { kind: 'boiler', x: 80, y: 215 }, C: { kind: 'boiler', x: 80, y: 370 } };
// Two boxes in a row: A and B meet first, then C joins.
const chain = {
  nodes: { ...trio, s1: { kind: 'slot', inputs: 2, x: 230, y: 138 }, s2: { kind: 'slot', inputs: 2, x: 370, y: 235 }, P: { kind: 'piston', x: 520, y: 235 } },
  wires: [['A', 's1'], ['B', 's1'], ['s1', 's2'], ['C', 's2'], ['s2', 'P']],
};

const LEVELS = [
  {
    title: 'Straight through',
    order: 'Send the express when engine A is ready.',
    lesson: { name: 'Plain track', text: 'Plain track passes the signal straight along. Clear in, clear out. Real signal boxes did this kind of logic with iron levers in the 1800s, long before computers.' },
    nodes: { A: { kind: 'boiler', x: 80, y: 150 }, s1: { kind: 'slot', inputs: 1, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['s1', 'P']],
    target: (s) => s.A,
    solution: { s1: 'pipe' },
  },
  {
    title: 'The inverter',
    order: 'Send the express when engine A is idle. The line is only free while A stays in the shed.',
    lesson: { name: 'The NOT box', text: 'A NOT box flips the signal. A clear track in gives a blocked track out, and blocked in gives clear out. In code it is written !a.' },
    nodes: { A: { kind: 'boiler', x: 80, y: 150 }, s1: { kind: 'slot', inputs: 1, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['s1', 'P']],
    target: (s) => !s.A,
    solution: { s1: 'not' },
  },
  {
    title: 'Both or nothing',
    order: 'Send the express only when engines A and B are both ready.',
    lesson: { name: 'The AND box', text: 'An AND box clears the line only when both tracks coming in are clear. One clear track is not enough. In code: a && b.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 'P']],
    target: (s) => s.A && s.B,
    solution: { s1: 'and' },
  },
  {
    title: 'Either will do',
    order: 'Send the express when engine A or engine B is ready.',
    lesson: { name: 'The OR box', text: 'An OR box clears the line when either track is clear, or both are. It blocks only when both are blocked. In code: a || b.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 'P']],
    target: (s) => s.A || s.B,
    solution: { s1: 'or' },
  },
  {
    title: 'The shunter',
    order: 'Send the express when engine A is ready, but never while B, the shunter, is ready. A ready shunter is still working the line.',
    lesson: { name: 'Boxes in a chain', text: 'The signal leaving one box can feed the next. Work backwards from the station: what does the last box need to receive?' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 1, x: 200, y: 230 }, s2: { kind: 'slot', inputs: 2, x: 330, y: 150 }, P: { kind: 'piston', x: 460, y: 150 } },
    wires: [['A', 's2'], ['B', 's1'], ['s1', 's2'], ['s2', 'P']],
    target: (s) => s.A && !s.B,
    solution: { s1: 'not', s2: 'and' },
  },
  {
    title: 'Quiet yard',
    order: 'Send the express only when both engines are idle.',
    lesson: { name: 'Two boxes, one idea', text: 'Some orders need two boxes working together. Read the order slowly: the express goes when neither engine is ready.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 210, y: 150 }, s2: { kind: 'slot', inputs: 1, x: 330, y: 150 }, P: { kind: 'piston', x: 460, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 's2'], ['s2', 'P']],
    target: (s) => !s.A && !s.B,
    solution: { s1: 'or', s2: 'not' },
  },
  {
    title: 'One or the other',
    order: 'Send the express when exactly one engine is ready. Two ready engines jam the junction.',
    lesson: { name: 'The XOR box', text: 'An XOR box clears the line when its two tracks disagree: one clear, one blocked. Two clear tracks keep it blocked. In code: a !== b.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 'P']],
    target: (s) => s.A !== s.B,
    solution: { s1: 'xor' },
  },
  {
    title: 'Triple header',
    order: 'Send the express only when all three engines are ready to pull it.',
    lesson: { name: 'Three engines, two boxes', text: 'A box takes two tracks at most, so three engines need two boxes in a row. The ledger now has eight rows, one for every mix of three engines.' },
    ...chain,
    target: (s) => s.A && s.B && s.C,
    solution: { s1: 'and', s2: 'and' },
  },
  {
    title: 'Odd one out',
    order: 'Send the express when an odd number of engines are ready: exactly one, or all three.',
    lesson: { name: 'Chaining XOR', text: 'Every extra clear track flips an XOR answer. Follow the signal one box at a time and count the ready engines.' },
    ...chain,
    target: (s) => (s.A + s.B + s.C) % 2 === 1,
    solution: { s1: 'xor', s2: 'xor' },
  },
  {
    title: 'The breakdown crane',
    order: 'Send the express when engine A or engine B is ready, unless C, the breakdown crane, is ready. When the crane is out, the line is closed.',
    lesson: { name: 'Breaking an order apart', text: 'Split the order into pieces. Which part is OR, which part is NOT, and what joins them together?' },
    nodes: { ...trio, s1: { kind: 'slot', inputs: 2, x: 230, y: 138 }, s2: { kind: 'slot', inputs: 1, x: 230, y: 370 }, s3: { kind: 'slot', inputs: 2, x: 370, y: 235 }, P: { kind: 'piston', x: 520, y: 235 } },
    wires: [['A', 's1'], ['B', 's1'], ['C', 's2'], ['s1', 's3'], ['s2', 's3'], ['s3', 'P']],
    target: (s) => (s.A || s.B) && !s.C,
    solution: { s1: 'or', s2: 'not', s3: 'and' },
  },
  {
    title: 'Majority vote',
    order: 'Send the express when at least two of the three engines are ready.',
    lesson: { name: 'Split tracks', text: 'One engine can feed two boxes at once. Trace where every track goes before you choose, then check the ledger row by row.' },
    nodes: {
      ...trio,
      s1: { kind: 'slot', inputs: 2, x: 232, y: 60 },
      s2: { kind: 'slot', inputs: 2, x: 232, y: 190 },
      s3: { kind: 'slot', inputs: 2, x: 350, y: 295 },
      s4: { kind: 'slot', inputs: 2, x: 470, y: 140 },
      P: { kind: 'piston', x: 610, y: 140 },
    },
    // Third item is the x where a track turns, set by hand so crossing tracks never share a segment
    // and parallel runs stay at least one sleeper-width (22) apart.
    wires: [['A', 's1'], ['B', 's1', 176], ['A', 's2', 146], ['B', 's2'], ['s2', 's3'], ['C', 's3'], ['s1', 's4'], ['s3', 's4'], ['s4', 'P']],
    target: (s) => s.A + s.B + s.C >= 2,
    solution: { s1: 'and', s2: 'or', s3: 'and', s4: 'or' },
  },
];

const idsOf = (level, kind) => Object.keys(level.nodes).filter((id) => level.nodes[id].kind === kind);

// Signal state of every node for one engine setting. An empty slot passes no signal.
function simulate(level, boilers, valves) {
  const out = {};
  const value = (id) => {
    if (id in out) return out[id];
    const node = level.nodes[id];
    const ins = level.wires.filter((w) => w[1] === id).map((w) => value(w[0]));
    if (node.kind === 'boiler') out[id] = !!boilers[id];
    else if (node.kind === 'piston') out[id] = ins[0];
    else out[id] = valves[id] ? PARTS[valves[id]].run(ins) : false;
    return out[id];
  };
  Object.keys(level.nodes).forEach(value);
  return out;
}

// Every engine setting in truth-table order: all idle first, all ready last.
function settings(level) {
  const ids = idsOf(level, 'boiler');
  return Array.from({ length: 1 << ids.length }, (_, i) =>
    Object.fromEntries(ids.map((id, j) => [id, !!((i >> (ids.length - 1 - j)) & 1)])));
}

function inspect(level, valves) {
  return settings(level).map((boilers) => {
    const wanted = level.target(boilers);
    const got = simulate(level, boilers, valves).P;
    return { boilers, wanted, got, ok: wanted === got };
  });
}

if (typeof module !== 'undefined') module.exports = { PARTS, LEVELS, idsOf, simulate, settings, inspect };
