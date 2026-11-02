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
2. **Animate** – type something like `amber sweep from the center out 3 times then off for 0.3 seconds`. Chain steps with “then”. Every step can be fine-tuned (color, speed, direction, width, brightness, length).
3. **ESP32 code** – set data pin, LED chip, color order and power limit, then copy or download `taillight.ino`. The sketch uses the exact same math as the simulator, so what you see is what the LEDs do.

Animations: solid, off, sequential sweep, blink/hazard, brake flash, scanner, breathe, chase, color wave, rainbow, sparkle.

## Files
- `js/matrix.js` – layout model + drawing
- `js/animations.js` – animation library (JS + matching C++)
- `js/parser.js` – plain-English → steps
- `js/codegen.js` – Arduino sketch generator
- `js/app.js` – UI

## Adding an animation
Add an entry to `ANIMS` in `js/animations.js` with a `js()` and a matching `cpp()` implementation, and (optionally) a keyword in `js/parser.js`. Or just ask Claude Code to add one.
