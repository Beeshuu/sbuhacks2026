// Run with: node questions.test.js
// Runs every coding question's snippet in Python and checks the marked answer is what it really prints.
const assert = require('assert');
const { execFileSync } = require('child_process');
const { CODING } = require('./questions.js');

const python = ['python3', 'python'].find((cmd) => {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!python) {
  console.log('Python not found, so the snippets were not run.');
  process.exit(0);
}

const words = (text) => text.trim().split(/\s+/).join(' ');
let count = 0;
for (const [level, list] of Object.entries(CODING)) {
  list.forEach((q, i) => {
    const where = `${level} #${i + 1}`;
    assert.strictEqual(q.choices.length, 4, `${where}: needs four choices`);
    assert.strictEqual(new Set(q.choices).size, 4, `${where}: choices repeat`);
    assert(q.answer >= 0 && q.answer < 4, `${where}: answer index out of range`);
    const printed = execFileSync(python, ['-c', q.code], { encoding: 'utf8' });
    assert.strictEqual(words(printed), words(q.choices[q.answer]), `${where}: prints "${words(printed)}" but the answer says "${q.choices[q.answer]}"`);
    count++;
  });
}
console.log(`All ${count} coding questions print exactly their marked answer.`);
