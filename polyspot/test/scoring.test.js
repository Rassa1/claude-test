import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../shared/scoring.config.js';
import { maxScore, positionScale, scoreGuess } from '../shared/scoring.js';

const room = { type: 'floorplan', width: 3, length: 4 }; // diagonal 5 m
const truth = { pos: { x: 1, y: 1 }, heading: 90 };

test('perfect guess scores the max', () => {
  const s = scoreGuess({ map: room, truth, guess: truth, difficulty: 'easy' });
  assert.equal(s.position, 5000);
  assert.equal(s.direction, 5000);
  assert.equal(s.total, 10000);
  assert.equal(s.max, 10000);
});

test('position: 5000 × exp(−d / scale), scale from map size and difficulty', () => {
  const scale = positionScale(room, 'easy');
  assert.equal(scale, 5 * config.position.scaleFraction);
  const s = scoreGuess({ map: room, truth, guess: { pos: { x: 1 + scale, y: 1 }, heading: 90 }, difficulty: 'easy' });
  assert.equal(s.position, Math.round(5000 / Math.E));
  assert.ok(positionScale(room, 'impossible') > scale, 'harder rounds are more forgiving on distance');
});

test('direction: 5000 × (1 − angleError / 180), using the shortest angle', () => {
  const at = heading => scoreGuess({ map: room, truth, guess: { pos: truth.pos, heading }, difficulty: 'easy' });
  assert.equal(at(180).direction, 2500);
  assert.equal(at(270).direction, 0);
  assert.equal(at(0).direction, 2500);
  assert.equal(at(45).angleError, 45);
});

test('difficulty multiplier applies to the total', () => {
  const s = scoreGuess({ map: room, truth, guess: truth, difficulty: 'night' });
  assert.equal(s.multiplier, config.difficulties.night.multiplier);
  assert.equal(s.total, Math.round(10000 * s.multiplier));
  assert.equal(s.max, maxScore('night'));
  const off = scoreGuess({ map: room, truth, guess: truth, difficulty: 'night' }, { ...config, useDifficultyMultiplier: false });
  assert.equal(off.total, 10000);
});
