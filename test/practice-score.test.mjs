import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceScore, quizScore } from '../src/practiceScore.js';
import { readSessionStore, saveSessionStore } from '../src/sessionStore.js';

test('completed practice set combines quiz answers and fractional PBQ task credit', () => {
  const session = { mode: 'practice-set', done: true, questionIds: Array.from({ length: 85 }, (_, index) => `${index}`), correctCount: 70, pbqIds: ['a', 'b', 'c', 'd', 'e'] };
  const pbqs = Object.fromEntries(session.pbqIds.map((id) => [id, { submitted: true, result: { points: 3, possible: 4 } }]));
  const result = practiceScore(session, pbqs);
  assert.equal(result.quiz.percent, 82);
  assert.equal(result.pbqCredits, 3.75);
  assert.equal(result.pbqPercent, 75);
  assert.equal(result.index, Math.round(100 + 800 * (0.75 * 70 / 85 + 0.25 * 0.75)));
  assert.equal(result.complete, true);
  assert.equal(result.provisional, false);
});

test('five PBQs use their internal task credit without becoming forty exam questions', () => {
  const session = { mode: 'practice-set', done: true, questionIds: Array.from({ length: 85 }, (_, index) => `${index}`), correctCount: 85, pbqIds: ['a', 'b', 'c', 'd', 'e'] };
  const pbqs = Object.fromEntries(session.pbqIds.map((id) => [id, { submitted: true, result: { points: 0, possible: 8 } }]));
  assert.equal(practiceScore(session, pbqs).index, 700);
  pbqs.a.result.points = 8;
  assert.equal(practiceScore(session, pbqs).index, 740);
});

test('provisional index counts outstanding PBQs as zero and updates after submission', () => {
  const session = { mode: 'practice-set', done: true, questionIds: ['q'], correctCount: 1, pbqIds: ['a', 'b'] };
  const partial = practiceScore(session, { a: { submitted: true, result: { points: 1, possible: 1 } } });
  assert.equal(partial.index, 800);
  assert.equal(partial.provisional, true);
  assert.equal(partial.pbqPercent, 50);
  assert.equal(quizScore({ questionIds: ['q', 'r'], correctCount: 1 }).percent, 50);
});

test('session store migrates the existing unfinished quiz and retains multiple attempts', () => {
  const entries = new Map([['security-study-session-v2', JSON.stringify({ id: 'old', questionIds: ['q'], done: false })]]);
  const storage = { getItem: (key) => entries.get(key) || null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
  const sessions = readSessionStore(storage);
  assert.equal(sessions[0].id, 'old');
  saveSessionStore(storage, [...sessions, { id: 'new', questionIds: ['r'], done: true }]);
  assert.equal(readSessionStore(storage).length, 2);
  assert.equal(entries.has('security-study-session-v2'), false);
});
