# Logical steam: design direction

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
The camera rides just behind the player's steampunk paddle steamer. Beyond the river the world is a sunset over an industrial skyline: indigo to orange sky, a low sun, purple mountains, towers with lit windows and smoking factory chimneys, and evening grass. The river follows the time of day, with muddy banks, faint buoy lines between the lanes and drifting ripples. The steamboat is gunmetal grey with brass bands, rivets, cogs, copper pipes, red paddle wheels and two tall stacks, and the monster mirror is iron and brass with a sunset reflection. HUD panels stay cream cards with ink text so they read over the moving scene. With reduced motion on, screen shake, boat roll and smoke animation are off.

## Motion (every animation has a job; all off with reduced motion)
- The menu and briefing are paper panels over a live demo run that drives itself through the day/night cycle (a still frame with reduced motion).
- Panels rise in and pop-ups scale in, so you see where you landed.
- Countdown numbers and event messages pop, and the bend sign slides in, because they need a reaction.
- The fault notice flashes three times, then holds still. The repair bar turns amber, then red.
- Wrong coding answers shake, right ones pop. Hits flash amber at the screen edges.
- The speedometer needle glides, and the loss screen counts the distance up.
- Buttons lift on hover and press in on click.
