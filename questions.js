// Coding faults: short Python snippets with one right answer each. questions.test.js runs every
// snippet with a real Python interpreter and checks the marked answer matches what it prints.

const CODING = {
  easy: [
    { code: 'x = 5\nx = x + 3\nprint(x)', choices: ['5', '8', '53', 'An error'], answer: 1, why: 'x starts at 5, then gets 5 + 3 stored back into it.' },
    { code: 'for i in range(3):\n    print(i)', choices: ['0 1 2', '1 2 3', '0 1 2 3', '3'], answer: 0, why: 'range(3) counts 0, 1, 2. It stops before 3.' },
    { code: 'speed = 40\nif speed > 50:\n    print("fast")\nelse:\n    print("slow")', choices: ['fast', 'slow', 'fast slow', 'Nothing'], answer: 1, why: '40 is not greater than 50, so the else branch runs.' },
    { code: 'name = "steam"\nprint(len(name))', choices: ['4', '5', '6', 'steam'], answer: 1, why: 'len counts the characters: s, t, e, a, m.' },
    { code: 'a = 7\nb = 2\nprint(a // b)', choices: ['3.5', '3', '4', '1'], answer: 1, why: '// is floor division: 7 / 2 is 3.5, rounded down to 3.' },
    { code: 'pressure = 0\nwhile pressure < 3:\n    pressure += 1\nprint(pressure)', choices: ['2', '3', '4', '0'], answer: 1, why: 'The loop stops as soon as pressure reaches 3.' },
    { code: 'print("coal" + "car")', choices: ['coal car', 'coalcar', 'coal+car', 'An error'], answer: 1, why: '+ joins strings with nothing in between.' },
    { code: 'boilers = ["A", "B", "C"]\nprint(boilers[0])', choices: ['A', 'B', 'C', '0'], answer: 0, why: 'Lists start counting at 0, so index 0 is the first item.' },
  ],
  medium: [
    { code: 'nums = [3, 1, 2]\nnums.sort()\nprint(nums[-1])', choices: ['2', '3', '1', 'An error'], answer: 1, why: 'After sorting the list is [1, 2, 3], and index -1 is the last item.' },
    { code: 'def double(n):\n    return n * 2\n\nprint(double(double(3)))', choices: ['6', '12', '9', '3'], answer: 1, why: 'The inner call gives 6, then the outer call doubles that to 12.' },
    { code: 'word = "engine"\nprint(word[1:4])', choices: ['eng', 'ngi', 'ngin', 'gin'], answer: 1, why: 'A slice includes the start index and stops before the end: indexes 1, 2, 3.' },
    { code: 'ready = True\nidle = False\nprint(ready and not idle)', choices: ['True', 'False', 'None', 'An error'], answer: 0, why: 'not idle is True, and True and True is True.' },
    { code: 'total = 0\nfor n in [1, 2, 3, 4]:\n    if n % 2 == 0:\n        total += n\nprint(total)', choices: ['10', '4', '6', '2'], answer: 2, why: 'Only the even numbers, 2 and 4, are added.' },
    { code: 'cars = ["coal", "water"]\ncars.append("mail")\nprint(len(cars))', choices: ['2', '3', '4', 'mail'], answer: 1, why: 'append adds one item to the end, making three.' },
    { code: 'x = 10\ndef change():\n    x = 99\nchange()\nprint(x)', choices: ['10', '99', 'None', 'An error'], answer: 0, why: 'x = 99 inside the function makes a new local x. The outer x is untouched.' },
    { code: 'd = {"A": 1, "B": 2}\nd["A"] += 5\nprint(d["A"])', choices: ['5', '6', '1', '7'], answer: 1, why: 'd["A"] was 1, and += 5 makes it 6.' },
  ],
  hard: [
    { code: 'def f(n):\n    if n <= 1:\n        return 1\n    return n * f(n - 1)\n\nprint(f(4))', choices: ['10', '24', '4', '16'], answer: 1, why: 'f is a factorial: 4 * 3 * 2 * 1 = 24.' },
    { code: 'a = [1, 2, 3]\nb = a\nb.append(4)\nprint(len(a))', choices: ['3', '4', '1', 'An error'], answer: 1, why: 'b = a does not copy the list. Both names point at the same list.' },
    { code: 'print([i * i for i in range(4) if i % 2 == 1])', choices: ['[0, 4]', '[1, 9]', '[1, 4, 9]', '[0, 1, 4, 9]'], answer: 1, why: 'Only the odd values 1 and 3 pass the filter, squared to 1 and 9.' },
    { code: 'def add(item, bag=[]):\n    bag.append(item)\n    return bag\n\nadd("coal")\nprint(add("water"))', choices: ["['water']", "['coal', 'water']", "['water', 'coal']", 'An error'], answer: 1, why: 'The default list is made once and shared between calls, so it keeps "coal".' },
    { code: 's = "steam"\nprint(s[::-1])', choices: ['steam', 'maets', 'mae', 's'], answer: 1, why: 'A step of -1 walks the string backwards.' },
    { code: 'x = 0\nfor i in range(1, 4):\n    for j in range(i):\n        x += 1\nprint(x)', choices: ['3', '6', '9', '4'], answer: 1, why: 'The inner loop runs 1, then 2, then 3 times: 6 in total.' },
    { code: 'print(bool([]), bool([0]))', choices: ['False False', 'False True', 'True True', 'True False'], answer: 1, why: 'An empty list is falsy. A list holding anything, even 0, is truthy.' },
    { code: 'nums = [5, 3, 8]\nprint(sorted(nums) == nums, nums)', choices: ['False [5, 3, 8]', 'True [3, 5, 8]', 'False [3, 5, 8]', 'True [5, 3, 8]'], answer: 0, why: 'sorted returns a new list. The original stays in its old order.' },
  ],
};

// One question as a panel: the code, four answer buttons and a note. onRight runs once the right answer is picked.
// Without a heading it is labelled by the practice page's own heading (coding-title).
function quizPanel(q, onRight, heading = true) {
      const labelId = heading ? 'quiz-title' : 'coding-title';
      const panel = Object.assign(document.createElement('section'), { className: 'quiz' });
      panel.setAttribute('aria-labelledby', labelId);
      const title = Object.assign(document.createElement('h3'), { id: 'quiz-title', textContent: 'What Does This Print?' });
      const code = document.createElement('pre');
      code.append(Object.assign(document.createElement('code'), { textContent: q.code }));
      const list = Object.assign(document.createElement('div'), { className: 'choices' });
      list.setAttribute('role', 'group');
      list.setAttribute('aria-labelledby', labelId);
      const note = Object.assign(document.createElement('p'), { className: 'quiz-note' });
      note.setAttribute('role', 'status');
      let done = false;
      q.choices.forEach((text, i) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'choice', textContent: text });
        b.addEventListener('click', () => {
          if (done || b.classList.contains('wrong')) return;
          if (i === q.answer) {
            done = true;
            b.classList.add('right');
            note.textContent = `Correct. ${q.why}`;
            onRight(note);
          } else {
            b.classList.add('wrong');
            b.setAttribute('aria-label', `${text}, wrong`);
            note.textContent = 'Not that one. Read the code again and try another answer.';
          }
        });
        list.append(b);
      });
      if (heading) panel.append(title);
      panel.append(code, list, note);
      return panel;
}

// Turns a coding question into a timed fault in the shared repair pop-up (openRepair lives in app.js).
const Quiz = {
  repair(q, seconds) {
    return openRepair(seconds, 'Debug the engine\'s control code: pick what this Python prints.', () => {
      const panel = quizPanel(q, () => setTimeout(() => endRepair(true), 900)); // long enough to read the reason
      $('repair-slot').append(panel);
      panel.querySelector('.choice').focus();
      return () => panel.remove();
    });
  },
};

// Practice: a switch between the circuit plates and every coding question, numbered by difficulty.
if (typeof document !== 'undefined') {
  const ALL = ['easy', 'medium', 'hard'].flatMap((level) => CODING[level].map((q, i) => ({ q, level, n: i + 1 })));
  const label = (level) => level[0].toUpperCase() + level.slice(1);
  const buttons = ALL.map(({ level, n }, i) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: `${label(level)[0]}${n}` });
    b.setAttribute('aria-label', `${label(level)} question ${n}`);
    b.addEventListener('click', () => showQuestion(i));
    const li = document.createElement('li');
    li.append(b);
    $('questions').append(li);
    return b;
  });
  function showQuestion(i) {
    const { q, level, n } = ALL[i];
    buttons.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    $('coding-no').textContent = `${label(level)} question ${n} of ${CODING[level].length}`;
    const panel = quizPanel(q, (note) => {
      if (i + 1 >= ALL.length) return;
      const next = Object.assign(document.createElement('button'), { type: 'button', className: 'run', textContent: 'Next question' });
      next.addEventListener('click', () => { showQuestion(i + 1); $('coding-slot').querySelector('.choice').focus(); });
      note.after(next);
      next.focus();
    }, false);
    $('coding-slot').replaceChildren(panel);
  }
  for (const b of document.querySelectorAll('[data-practice]')) {
    b.addEventListener('click', () => {
      const coding = b.dataset.practice === 'coding';
      for (const o of document.querySelectorAll('[data-practice]')) o.setAttribute('aria-pressed', String(o === b));
      $('practice-slot').hidden = coding;
      $('plates-nav').hidden = coding;
      $('coding-practice').hidden = !coding;
      $('questions-nav').hidden = !coding;
    });
  }
  showQuestion(0);
}

if (typeof module !== 'undefined') module.exports = { CODING };
