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

// Leaderboard memos come from a public chain, so the parser must reject anything off-format.
const { parseRunMemo } = require('./solana.js');
assert.deepStrictEqual(parseRunMemo('[13] SJ1|hard|1234'), { difficulty: 'hard', metres: 1234, name: '' });
assert.deepStrictEqual(parseRunMemo('SJ1|easy|0'), { difficulty: 'easy', metres: 0, name: '' });
assert.deepStrictEqual(parseRunMemo('[22] SJ1|medium|880|Ada Lovelace'), { difficulty: 'medium', metres: 880, name: 'Ada Lovelace' });
for (const bad of ['SJTEST|easy|1', 'SJ1|insane|5', 'SJ1|hard|-3', 'SJ1|hard|99999999', 'SJ1|hard|12<script>', 'SJ1|hard|5|<b>x</b>', 'SJ1|hard|5|this-name-is-far-too-long', '']) {
  assert.strictEqual(parseRunMemo(bad), null, `accepted bad memo: ${bad}`);
}

console.log(`All ${LEVELS.length} plates check out, and the leaderboard parser rejects bad memos.`);
