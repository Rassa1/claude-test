# Taillight Studio

Design an LED taillight matrix, describe an animation in plain English, watch it simulated, and get ready-to-flash ESP32 (FastLED) code.

## Run it
It's a static web page – no install. Because it uses JS modules, serve the folder instead of double-clicking the file:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## How it works
1. **Build matrix** – rows, LEDs/meter, row length, row spacing. Shape presets (stagger, taper, slant, arc, random shift), drag any row sideways, set per-row LED counts, and pick the wiring (zig-zag / same direction, first-LED corner).
   Choose two mirrored lights (left + right) or a single light.
   **Data lines:** split big lights over several ESP32 output pins – give each line some rows (row chips or the row table), pick its pin per light. Up to 8 lines total (ESP32 RMT limit).
2. **Buttons & animate** – each button (Running, Brake, Left/Right turn, Hazards, or your own) has:
   - mode: **toggle** (press on/off) or **momentary** (on while held, optional “stay on after release” for pulsing car indicator wires)
   - which light(s) it drives (both / left / right)
   - layering: **replace** lower buttons, or **lay lit LEDs on top** (e.g. turn signal over brake)
   - an animation you describe in plain English. On the claude.ai-hosted page Claude interprets it (and can write custom formula effects); offline a keyword parser is used.
   Click/hold the buttons under the lights (or keys 1–9) to test combos like running + brake + left turn. Top of the list = highest priority.
3. **ESP32 code** – set data pins, LED chip, color order and power limit, then copy or download `taillight.ino`. It includes the button inputs (GPIO to GND, internal pull-ups) and uses the exact same math as the simulator.

Animations: solid, off, sequential sweep, blink/hazard, brake flash, scanner, breathe, chase, color wave, rainbow, sparkle, and custom formulas (`js/custom.js`).

## Files
- `js/matrix.js` – layout model + drawing
- `js/animations.js` – animation library (JS + matching C++)
- `js/parser.js` – plain-English → steps
- `js/engine.js` – buttons, layering, two-light scene
- `js/ai.js` – Claude interpretation (claude.ai artifact runtime) with keyword fallback
- `js/custom.js` – formula language compiled to JS and C++
- `js/pins.js` – ESP32 pin list, conflict checks
- `js/codegen.js` – Arduino sketch generator
- `js/app.js` – UI

## Adding an animation
Add an entry to `ANIMS` in `js/animations.js` with a `js()` and a matching `cpp()` implementation, and (optionally) a keyword in `js/parser.js`. Or just ask Claude Code to add one.
