// ─── All scoring settings live in this one file. ───────────────────────────────────────────────
// The server scores guesses with it and the browser reads labels and max scores from it.
// Restart the server after editing. Changes apply to new guesses only; saved scores keep their values.
//
//   position  = position.max  × exp(−distance / scale)
//               scale = mapSpan × position.scaleFraction × difficulty.scale
//               (mapSpan = map diagonal in meters; never below position.minScaleMeters)
//   direction = direction.max × (1 − angleError / 180)        angleError is 0–180°
//   total     = (position + direction) × difficulty.multiplier   (multiplier only if useDifficultyMultiplier)

export default {
  position: {
    max: 5000,
    // Missing by exactly one `scale` gives max/e ≈ 1839 points. 0.15 = 15% of the map's diagonal.
    // Example: 12×15 ft dorm room (diagonal 19.2 ft) on Easy → scale ≈ 2.9 ft.
    scaleFraction: 0.15,
    minScaleMeters: 0.25,
  },

  direction: {
    max: 5000,
  },

  useDifficultyMultiplier: true,

  // `scale` > 1 makes position scoring more forgiving; `multiplier` boosts the total.
  // Keys are stored with each round, so rename labels freely but keep the keys.
  difficulties: {
    easy:       { label: 'Easy',       scale: 1.0, multiplier: 1.0 },
    hard:       { label: 'Hard',       scale: 1.3, multiplier: 1.25 },
    night:      { label: 'Nighttime',  scale: 1.6, multiplier: 1.5 },
    impossible: { label: 'Impossible', scale: 2.0, multiplier: 2.0 },
  },

  defaultDifficulty: 'easy',
};
