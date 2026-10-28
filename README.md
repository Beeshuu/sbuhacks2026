# SBUHack_F26
Stony Brook University hackathon, 10/23/26-10/25/26

***SBUHacks2026 Solana Track Winner for MLH***

## Logical Steam
An endless steamboat run down a river, seen from just behind your paddle steamer. You're the pilot: steer through bends, dodge floating crates, rocks, waves and whirlpools, and keep ahead of the monster chasing the boat. When the engine faults, a timed repair opens and you fix it by wiring AND, OR, NOT and XOR signal boxes so the steamboat departs exactly when the order says. Real railway signal boxes did this logic with iron levers long before computers.

- Three difficulties (Easy, Medium, Hard) change speed, bends, obstacles, the monster's pace, how often faults happen, the repair timer, and which circuits you get.
- Engine-fault questions: choose Circuits (wire signal boxes), Coding (pick what a short Python snippet prints, 8 questions per difficulty), or Mixed.
- A controls briefing before every run started from the menu.
- A day/night cycle that turns from day to sunset, night and dawn every 5,000 m.
- A top-5 leaderboard per difficulty: runs that make it ask for a username on the loss screen.
- Question practice: all 11 circuits and all 24 coding questions with no clock running, switched with a Circuits / Coding toggle; coding has Easy, Medium and Hard selectors.
- Solana: finished runs can be recorded on the Solana devnet with a Phantom wallet. Each record is one transaction (a 0-lamport transfer that tags the leaderboard address, plus a Memo instruction `SJ1|<difficulty>|<metres>|<name>`). The menu's devnet leaderboard shows the top 5. The menu's leaderboard reads those transactions back from the chain. Devnet only, so it uses free test SOL.

Run it: open `index.html` in a browser, or serve the folder (`python -m http.server`). No build step.
Test the puzzle logic and the leaderboard parser: `node logic.test.js`
Check every coding question against real Python output: `node questions.test.js`
To record a run you need the Phantom extension and a little devnet SOL (free at faucet.solana.com).

# Authors
Ethan Guo, Bishal Nath

