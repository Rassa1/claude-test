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
2. **Inputs & effects**
   - **Inputs** are the wires into the ESP32 (running-light power, brake, left/right blinker, or push buttons), each with its pin. Wires can have a hold time so a pulsing blinker reads as one continuous ON.
   - **Effects** are animations with a trigger built from inputs: each input can be required ON, required OFF or ignored, matching all or any. Examples: Hazards = Left ON + Right ON; Left turn = Left ON + Right OFF.
   - An effect runs **while** its condition is true, or **once** when it turns on, optionally only if it had been off for N seconds (a startup animation that doesn't replay when you flick the lights while driving).
   - Describe each effect's animation in plain English (Claude interprets it on the claude.ai-hosted page; offline a keyword parser is used). Effects higher in the list draw on top; they can replace or overlay the ones below.
   - Simulator: click input wires on/off, “+30 s” to jump time, “Power-cycle ESP32” to test startup.
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
