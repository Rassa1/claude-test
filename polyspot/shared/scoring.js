// Scoring. Pure functions; settings come from scoring.config.js.
import defaults from './scoring.config.js';
import { angleError, distance, mapSpan } from './geo.js';

export function difficultyOf(key, cfg = defaults) {
  return cfg.difficulties[key] || cfg.difficulties[cfg.defaultDifficulty];
}

/** Distance (meters) at which the position score drops to max/e. */
export function positionScale(map, difficulty, cfg = defaults) {
  const d = difficultyOf(difficulty, cfg);
  return Math.max(cfg.position.minScaleMeters, mapSpan(map) * cfg.position.scaleFraction * (d.scale ?? 1));
}

export function multiplierFor(difficulty, cfg = defaults) {
  return cfg.useDifficultyMultiplier ? (difficultyOf(difficulty, cfg).multiplier ?? 1) : 1;
}

export function maxScore(difficulty, cfg = defaults) {
  return Math.round((cfg.position.max + cfg.direction.max) * multiplierFor(difficulty, cfg));
}

/**
 * Score one guess.
 * @param {{ map, truth: {pos, heading}, guess: {pos, heading}, difficulty: string }} args
 * @returns {{ distance, angleError, scale, position, direction, multiplier, total, max }}
 *          distance/scale in meters, angleError in degrees, the rest in points.
 */
export function scoreGuess({ map, truth, guess, difficulty }, cfg = defaults) {
  const dist = distance(map, truth.pos, guess.pos);
  const ang = angleError(truth.heading, guess.heading);
  const scale = positionScale(map, difficulty, cfg);
  const position = Math.round(cfg.position.max * Math.exp(-dist / scale));
  const direction = Math.round(cfg.direction.max * (1 - ang / 180));
  const multiplier = multiplierFor(difficulty, cfg);
  return {
    distance: dist,
    angleError: ang,
    scale,
    position,
    direction,
    multiplier,
    total: Math.round((position + direction) * multiplier),
    max: maxScore(difficulty, cfg),
  };
}
