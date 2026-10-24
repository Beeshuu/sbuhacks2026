# SBUHack_F26
Stony Brook University hackathon, 10/23/26-10/25/26

## Steel Junction
An endless steam train run, seen from just behind your locomotive. You're the driver: steer through bends, dodge rocks and crates, and keep ahead of the monster chasing the train. When the engine faults, a timed repair opens and you fix it by wiring AND, OR, NOT and XOR signal boxes so the express departs exactly when the order says. Real railway signal boxes did this logic with iron levers long before computers.

- Three difficulties (Easy, Medium, Hard) change speed, bends, obstacles, the monster's pace, how often faults happen, the repair timer, and which circuits you get.
- Signal box practice: all 11 circuits with no clock running.
- Solana: finished runs can be recorded on the Solana devnet with a Phantom wallet. Each record is one transaction (a 0-lamport transfer that tags the leaderboard address, plus a Memo instruction `SJ1|<difficulty>|<metres>`). The menu's leaderboard reads those transactions back from the chain. Devnet only, so it uses free test SOL.

Run it: open `index.html` in a browser, or serve the folder (`python -m http.server`). No build step.
Test the puzzle logic and the leaderboard parser: `node logic.test.js`
To record a run you need the Phantom extension and a little devnet SOL (free at faucet.solana.com).

# Authors
Ethan Guo, Bishal Nath, Susmoy Kar

