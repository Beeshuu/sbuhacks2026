# Logical Steam: design direction

Chosen by the team: option B, "Instrument" (polished Victorian brass), from the mockup Claude proposed.

## Identity
A logic-gate puzzle for students who have never seen a circuit, dressed as a steam railway. Engines are the inputs, track carries the signal, signal boxes are the gates (AND, OR, NOT, XOR), and the express leaving the station is the output. Railway interlocking was real mechanical logic, which is the pitch.

## Personality
Calm, precise, readable. An old scientific instrument, not a sooty factory.

## Palette
- Paper (background): #f1e9d6
- Plate (board): #e8dcc0
- Ink (text): #2b2118
- Brass (core, lines and borders): #8a6420
- Signal red (one accent, main action button only): #a3361f

## Typography
Serif display for headings (italic for the title), readable serif or sans for body. Exact fonts to confirm at build time.

## Motion
Moving dashes on clear track, smoke on ready engines, and the express pulling away carry the meaning; everything else stays still. Respect prefers-reduced-motion.

## Dial
ENERGY 2 / RHYTHM 1 / MOTION 2

## The run (chase view)
The camera rides just behind the player's steampunk paddle steamer. Beyond the river the world is a sunset over an industrial skyline: indigo to orange sky, a low sun, purple mountains, towers with lit windows and smoking factory chimneys, and evening grass. The river follows the time of day, with muddy banks, faint buoy lines between the lanes and drifting ripples. The steamboat is a riverboat: a planked deck inside steel gunwales, sunburst paddle boxes, a teak deckhouse with arched lit windows, an upper cabin with portholes, a domed brass pilot house, two stacks with feathered brass crowns, deck lanterns and a red pennant. Obstacles are an iron-strapped crate, a jagged mossy slate rock, a curling breaker and a spiralling whirlpool. At night the boat takes the scene's shade while its windows and lanterns glow, and its bow lamp lights the river ahead; the beam follows the boat's line through bends and swings as you steer. The monster is a black kraken: a domed head with glowing amber slit eyes and writhing tentacles. It fills the iron and brass mirror as it closes in, and when it is close its tentacles reach in from the screen edges. Everything over the scene (HUD readouts, messages, the bend sign, the countdown dial, buttons, the pause menu, the repair pop-up and the loss screen) is one smoked glass with a brass hairline, two corner sizes (14px panels, 10px controls) and light text that passes 4.5:1. The repair puzzle sits on a paper card inside its glass. With reduced motion on, screen shake, boat roll, the pennant, the lamp's glints and smoke animation are off.

## Motion (every animation has a job; all off with reduced motion)
- The menu and briefing are smoked glass panels (denser than the HUD glass, for long text) over a live demo run that drives itself through the day/night cycle (a still frame with reduced motion). Every run starts at night.
- Headings use Title Case; body text and buttons stay in sentence case.
- Panels rise in and pop-ups scale in on a small spring, so you see where you landed. On phones the pause menu and loss screen slide up as bottom sheets, near the thumbs.
- The HUD settles in piece by piece at the start of a run: dial, readouts, then the controls.
- Countdown numbers (in a brass-ringed dial) and event messages pop, and the bend sign slides in, because they need a reaction.
- The fault notice flashes three times, then holds still. The repair bar turns amber, then red.
- Wrong coding answers shake, right ones pop. Hits flash amber at the screen edges.
- The speedometer needle glides, and the loss screen counts the distance up.
- Buttons lift on hover and press in on click.

## Sound
Every sound is synthesised in sound.js from tones and filtered noise: no recordings and no voices. Buttons click like brass switches; the engine chuffs faster with speed; crates knock, rocks crunch, waves splash, the bank scrapes; a bell warns of a fault; a chime or a buzz ends a repair; the countdown ticks and a steam whistle sets off. A mute option on the briefing is remembered in the browser.
