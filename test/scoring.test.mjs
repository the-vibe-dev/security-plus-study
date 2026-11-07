import test from 'node:test';
import assert from 'node:assert/strict';
import { exactSet, gradeTask } from '../scoring.mjs';

test('exact-set answers accept either order and reject omissions, extras, and duplicates', () => {
  assert.equal(exactSet(['E', 'B'], ['B', 'E']), true);
  assert.equal(exactSet(['B'], ['B', 'E']), false);
  assert.equal(exactSet(['B', 'E', 'F'], ['B', 'E']), false);
  assert.equal(exactSet(['B', 'B'], ['B', 'E']), false);
});

test('numeric zero is valid but an empty response is not', () => {
  const task = { max_points: 1 };
  const key = { correct_response: 0, scoring: { method: 'numeric', tolerance: 0 }, explanation: '' };
  assert.equal(gradeTask(task, key, 0).points, 1);
  assert.equal(gradeTask(task, key, '0').points, 1);
  assert.equal(gradeTask(task, key, '').points, 0);
  assert.equal(gradeTask(task, key, undefined).points, 0);
});

test('ordering requires the exact sequence', () => {
  const task = { max_points: 1 };
  const key = { correct_response: ['identity', 'database', 'app'], scoring: { method: 'ordered_exact' }, explanation: '' };
  assert.equal(gradeTask(task, key, ['identity', 'database', 'app']).points, 1);
  assert.equal(gradeTask(task, key, ['database', 'identity', 'app']).points, 0);
});
