// Game rules with no DOM, so logic.test.js can run them in Node.

const PARTS = {
  pipe: { label: 'Pipe', inputs: 1, run: ([a]) => a },
  not: { label: 'NOT', inputs: 1, run: ([a]) => !a },
  and: { label: 'AND', inputs: 2, run: ([a, b]) => a && b },
  or: { label: 'OR', inputs: 2, run: ([a, b]) => a || b },
  xor: { label: 'XOR', inputs: 2, run: ([a, b]) => a !== b, from: 6 }, // appears in the drawer from plate VII
};

const pair = { A: { kind: 'boiler', x: 80, y: 80 }, B: { kind: 'boiler', x: 80, y: 220 } };
const trio = { A: { kind: 'boiler', x: 80, y: 60 }, B: { kind: 'boiler', x: 80, y: 190 }, C: { kind: 'boiler', x: 80, y: 320 } };
// Two valves in a row: A and B meet first, then C joins.
const chain = {
  nodes: { ...trio, s1: { kind: 'slot', inputs: 2, x: 230, y: 125 }, s2: { kind: 'slot', inputs: 2, x: 370, y: 190 }, P: { kind: 'piston', x: 520, y: 190 } },
  wires: [['A', 's1'], ['B', 's1'], ['s1', 's2'], ['C', 's2'], ['s2', 'P']],
};

const LEVELS = [
  {
    title: 'Straight through',
    order: 'Fire the piston when boiler A is hot.',
    lesson: { name: 'The pipe', text: 'A pipe carries steam along unchanged. Hot goes in, hot comes out. Cold goes in, cold comes out.' },
    nodes: { A: { kind: 'boiler', x: 80, y: 150 }, s1: { kind: 'slot', inputs: 1, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['s1', 'P']],
    target: (s) => s.A,
    solution: { s1: 'pipe' },
  },
  {
    title: 'The inverter',
    order: 'Fire the piston when boiler A is cold.',
    lesson: { name: 'The NOT valve', text: 'A NOT valve flips the steam. Hot in gives cold out, and cold in gives hot out. In code it is written !a.' },
    nodes: { A: { kind: 'boiler', x: 80, y: 150 }, s1: { kind: 'slot', inputs: 1, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['s1', 'P']],
    target: (s) => !s.A,
    solution: { s1: 'not' },
  },
  {
    title: 'Both or nothing',
    order: 'Fire the piston only when boilers A and B are both hot.',
    lesson: { name: 'The AND valve', text: 'An AND valve opens only when both pipes coming in are hot. One hot pipe is not enough. In code: a && b.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 'P']],
    target: (s) => s.A && s.B,
    solution: { s1: 'and' },
  },
  {
    title: 'Either will do',
    order: 'Fire the piston when boiler A or boiler B is hot.',
    lesson: { name: 'The OR valve', text: 'An OR valve opens when either pipe is hot, or both are. It stays shut only when both are cold. In code: a || b.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 'P']],
    target: (s) => s.A || s.B,
    solution: { s1: 'or' },
  },
  {
    title: 'The safety guard',
    order: 'Fire the press when the furnace (A) is hot, but never while the guard (B) is hot. A hot guard means someone is standing at the press.',
    lesson: { name: 'Valves in a chain', text: 'Steam leaving one valve can feed the next. Work backwards from the piston: what does the last valve need to receive?' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 1, x: 200, y: 220 }, s2: { kind: 'slot', inputs: 2, x: 330, y: 150 }, P: { kind: 'piston', x: 460, y: 150 } },
    wires: [['A', 's2'], ['B', 's1'], ['s1', 's2'], ['s2', 'P']],
    target: (s) => s.A && !s.B,
    solution: { s1: 'not', s2: 'and' },
  },
  {
    title: 'Cold morning',
    order: 'Fire the piston only when both boilers are cold.',
    lesson: { name: 'Two valves, one idea', text: 'Some orders need two valves working together. Read the order slowly: the piston fires when neither boiler is hot.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 210, y: 150 }, s2: { kind: 'slot', inputs: 1, x: 330, y: 150 }, P: { kind: 'piston', x: 460, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 's2'], ['s2', 'P']],
    target: (s) => !s.A && !s.B,
    solution: { s1: 'or', s2: 'not' },
  },
  {
    title: 'One or the other',
    order: 'Fire the piston when exactly one boiler is hot. Both hot is too much.',
    lesson: { name: 'The XOR valve', text: 'An XOR valve opens when its two pipes disagree: one hot, one cold. Two hot pipes keep it shut. In code: a !== b.' },
    nodes: { ...pair, s1: { kind: 'slot', inputs: 2, x: 260, y: 150 }, P: { kind: 'piston', x: 430, y: 150 } },
    wires: [['A', 's1'], ['B', 's1'], ['s1', 'P']],
    target: (s) => s.A !== s.B,
    solution: { s1: 'xor' },
  },
  {
    title: 'Three keys',
    order: 'Fire the piston only when all three boilers are hot.',
    lesson: { name: 'Three boilers, two valves', text: 'A valve takes two pipes at most, so three boilers need two valves in a row. The ledger now has eight rows, one for every mix of three boilers.' },
    ...chain,
    target: (s) => s.A && s.B && s.C,
    solution: { s1: 'and', s2: 'and' },
  },
  {
    title: 'Odd one out',
    order: 'Fire the piston when an odd number of boilers are hot: exactly one, or all three.',
    lesson: { name: 'Chaining XOR', text: 'Every extra hot pipe flips an XOR answer. Follow the steam one valve at a time and count the hot boilers.' },
    ...chain,
    target: (s) => (s.A + s.B + s.C) % 2 === 1,
    solution: { s1: 'xor', s2: 'xor' },
  },
  {
    title: 'The override',
    order: 'Fire the piston when boiler A or boiler B is hot, unless boiler C, the override, is hot.',
    lesson: { name: 'Breaking an order apart', text: 'Split the order into pieces. Which part is OR, which part is NOT, and what joins them together?' },
    nodes: { ...trio, s1: { kind: 'slot', inputs: 2, x: 230, y: 125 }, s2: { kind: 'slot', inputs: 1, x: 230, y: 320 }, s3: { kind: 'slot', inputs: 2, x: 370, y: 190 }, P: { kind: 'piston', x: 520, y: 190 } },
    wires: [['A', 's1'], ['B', 's1'], ['C', 's2'], ['s1', 's3'], ['s2', 's3'], ['s3', 'P']],
    target: (s) => (s.A || s.B) && !s.C,
    solution: { s1: 'or', s2: 'not', s3: 'and' },
  },
  {
    title: 'Majority vote',
    order: 'Fire the piston when at least two of the three boilers are hot.',
    lesson: { name: 'Split pipes', text: 'One boiler can feed two valves at once. Trace where every pipe goes before you choose, then check the ledger row by row.' },
    nodes: {
      ...trio,
      s1: { kind: 'slot', inputs: 2, x: 220, y: 60 },
      s2: { kind: 'slot', inputs: 2, x: 220, y: 190 },
      s3: { kind: 'slot', inputs: 2, x: 340, y: 250 },
      s4: { kind: 'slot', inputs: 2, x: 460, y: 125 },
      P: { kind: 'piston', x: 600, y: 125 },
    },
    // Third item is the x where a pipe turns, set by hand so crossing pipes never share a segment.
    wires: [['A', 's1'], ['B', 's1', 160], ['A', 's2', 135], ['B', 's2'], ['s2', 's3'], ['C', 's3'], ['s1', 's4'], ['s3', 's4'], ['s4', 'P']],
    target: (s) => s.A + s.B + s.C >= 2,
    solution: { s1: 'and', s2: 'or', s3: 'and', s4: 'or' },
  },
];

const idsOf = (level, kind) => Object.keys(level.nodes).filter((id) => level.nodes[id].kind === kind);

// Steam state of every node for one boiler setting. An empty slot passes no steam.
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

// Every boiler setting in truth-table order: all cold first, all hot last.
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
