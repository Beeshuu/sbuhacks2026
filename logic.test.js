// Run with: node logic.test.js
const assert = require('assert');
const { PARTS, LEVELS, inspect } = require('./logic.js');

LEVELS.forEach((level, i) => {
  const plate = `plate ${i + 1}`;
  assert(inspect(level, level.solution).every((r) => r.ok), `${plate}: the intended solution fails`);
  assert(!inspect(level, {}).every((r) => r.ok), `${plate}: passes with every slot empty`);
  for (const [slot, part] of Object.entries(level.solution)) {
    assert.strictEqual(PARTS[part].inputs, level.nodes[slot].inputs, `${plate}: solution part does not fit ${slot}`);
  }
});

// Near misses that must not pass.
assert(!inspect(LEVELS[2], { s1: 'or' }).every((r) => r.ok), 'OR passes the AND plate');
assert(!inspect(LEVELS[5], { s1: 'and', s2: 'not' }).every((r) => r.ok), 'NAND passes the NOR plate');
assert(!inspect(LEVELS[6], { s1: 'or' }).every((r) => r.ok), 'OR passes the XOR plate');
assert(!inspect(LEVELS[10], { s1: 'or', s2: 'and', s3: 'and', s4: 'or' }).every((r) => r.ok), 'swapped valves pass majority');
assert.strictEqual(inspect(LEVELS[7], {}).length, 8, 'three boilers should give eight rows');
assert.deepStrictEqual(inspect(LEVELS[2], {}).map((r) => r.boilers), [
  { A: false, B: false }, { A: false, B: true }, { A: true, B: false }, { A: true, B: true },
]);

console.log(`All ${LEVELS.length} plates check out.`);
