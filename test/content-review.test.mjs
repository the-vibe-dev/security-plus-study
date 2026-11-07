import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { parsePracticalPackage } from '../practical-import.mjs';
import { REVIEW_KEY, contentIdentity, contentSnapshot, readReviews, saveReview, exportReviews } from '../src/contentReviewStore.js';

const time = '2026-11-07T12:00:00.000Z';
const item = { id: 'example-1', prompt: 'Which protocol?', domain_id: '4', objective_id: '4.5', stimulus: { context: 'Test scenario' }, interaction: { type: 'single_select', options: [{ id: 'a', text: 'TLS' }], output_preview_after_submission: 'HIDDEN' }, answer_key: 'HIDDEN', response: 'PRIVATE', score: 50, attemptId: 'PRIVATE' };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
function draft(overrides = {}) { return { ...contentIdentity(item), target: 'question', title: item.prompt, snapshot: contentSnapshot(item), reason: 'conflict', note: 'Check this statement', reference: 'Course module 4', ...overrides }; }

test('flags persist with stable identities and no changes to learner progress', () => {
  const local = storage(); local.setItem('progress', 'unchanged');
  const saved = saveReview(local, draft(), time);
  assert.deepEqual(readReviews(local), saved);
  assert.equal(saved[0].status, 'open');
  assert.equal(saved[0].createdAt, time);
  assert.equal(local.getItem('progress'), 'unchanged');
});

test('repeated saves update one record, preserve original snapshot, and retain other tabs’ records', () => {
  const local = storage();
  saveReview(local, draft(), time);
  saveReview(local, draft({ itemId: 'other' }), time);
  const saved = saveReview(local, { ...readReviews(local)[0], note: 'Updated concern', snapshot: { changed: true } }, '2026-11-08T12:00:00Z');
  assert.equal(saved.length, 2); assert.equal(saved[0].note, 'Updated concern');
  assert.equal(saved[0].createdAt, time); assert.deepEqual(saved[0].snapshot, contentSnapshot(item));
});

test('question and explanation flags, legacy types, and imported sets do not collide', () => {
  const local = storage();
  saveReview(local, draft(), time);
  saveReview(local, draft({ target: 'explanation' }), time);
  saveReview(local, draft({ source: 'legacy-question', setId: 'first' }), time);
  saveReview(local, draft({ source: 'legacy-question', setId: 'second' }), time);
  saveReview(local, draft({ source: 'legacy-pbq', setId: 'first' }), time);
  assert.equal(readReviews(local).length, 5);
});

test('reviews can be assigned, resolved with a recorded finding, and reopened', () => {
  const local = storage();
  saveReview(local, draft({ status: 'in_review' }), time);
  assert.equal(readReviews(local)[0].status, 'in_review');
  assert.throws(() => saveReview(local, { ...readReviews(local)[0], status: 'resolved' }), /outcome and review notes/);
  assert.throws(() => saveReview(local, { ...readReviews(local)[0], status: 'resolved', outcome: 'confirmed', resolution: '   ' }), /outcome and review notes/);
  saveReview(local, { ...readReviews(local)[0], status: 'resolved', outcome: 'correction_needed', resolution: 'Instructor confirmed ambiguity; propose revised wording.' }, time);
  assert.equal(readReviews(local)[0].outcome, 'correction_needed');
  saveReview(local, { ...readReviews(local)[0], status: 'open' }, time);
  assert.equal(readReviews(local)[0].status, 'open');
  assert.match(readReviews(local)[0].resolution, /Instructor/);
});

test('stale edits cannot overwrite a newer resolution, even with identical timestamps', () => {
  const local = storage();
  const stale = saveReview(local, draft(), time)[0];
  const latest = saveReview(local, { ...stale, status: 'resolved', outcome: 'confirmed', resolution: 'Verified against course documentation.' }, time);
  assert.throws(() => saveReview(local, { ...stale, note: 'Stale concern' }, time), /changed in another tab/);
  assert.deepEqual(readReviews(local), latest);
  assert.throws(() => saveReview(local, draft(), time), /changed in another tab/);
});

test('validation rejects invalid reasons, statuses, oversized notes, and unsupported sources', () => {
  for (const changes of [{ reason: 'unknown' }, { reason: '__proto__' }, { status: 'deleted' }, { source: 'unknown' }, { target: 'response' }, { note: 'a'.repeat(4001) }, { reference: 'a'.repeat(2001) }, { resolution: 'a'.repeat(4001) }]) {
    const local = storage(); assert.throws(() => saveReview(local, draft(changes), time)); assert.equal(local.getItem(REVIEW_KEY), null);
  }
});

test('corrupt or newer storage is reported and never silently overwritten', () => {
  for (const raw of ['{broken', '{"version":2,"records":[]}', '{"version":1,"records":[{}]}', '{"version":1,"records":null}']) {
    const local = storage(); local.setItem(REVIEW_KEY, raw);
    assert.throws(() => readReviews(local), /not been overwritten/);
    assert.throws(() => saveReview(local, draft()), /not been overwritten/);
    assert.equal(local.getItem(REVIEW_KEY), raw);
  }
});

test('storage failures surface instead of claiming persistence', () => {
  assert.throws(() => readReviews({ getItem: () => { throw new Error(); } }), /storage is unavailable/);
  assert.throws(() => saveReview({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, draft()), /Could not save/);
});

test('snapshot and JSON export exclude learner data and unrevealed keys', () => {
  const local = storage();
  saveReview(local, draft(), time);
  const data = exportReviews(readReviews(local), time);
  assert.doesNotMatch(data, /PRIVATE|HIDDEN|answer_key|output_preview_after_submission/);
  assert.equal(JSON.parse(data).records[0].snapshot.prompt, item.prompt);
  assert.equal(JSON.parse(data).schemaVersion, 1);
  assert.equal(JSON.parse(exportReviews([], time)).records.length, 0);
  const feedback = contentSnapshot(item, 'practical', { explanation: 'Displayed reason', correctAnswer: 'a', earned: 1, response: 'PRIVATE', detail: { tasks: [{ taskId: 'T1', explanation: 'Displayed task reason', points: 0, response: 'PRIVATE' }] } });
  assert.equal(feedback.feedback.correctAnswer, 'a');
  assert.equal(feedback.feedback.tasks[0].taskId, 'T1');
  assert.doesNotMatch(JSON.stringify(feedback), /PRIVATE|earned|points/);
});

test('snapshot adapters include custom questions and legacy PBQ task context', () => {
  const question = contentSnapshot({ id: 'Q1', setId: 'mine', question: 'Test?', choices: [{ id: 'A', text: 'Test' }], correctIds: ['A'], explanation: 'HIDDEN' }, 'legacy-question');
  assert.equal(question.choices.length, 1); assert.doesNotMatch(JSON.stringify(question), /correctIds|HIDDEN/);
  const pbq = contentSnapshot({ id: 'P1', title: 'Test PBQ', scenario_md: 'Scenario', tasks: [{ id: 'T1', prompt: 'Choose', options: [{ id: 'A', text: 'Test' }], response_type: 'single_select', correctResponse: 'HIDDEN' }] }, 'legacy-pbq', { tasks: [{ taskId: 'T1', explanation: 'Shown', correctResponse: 'A', response: 'PRIVATE' }] });
  assert.equal(pbq.tasks[0].id, 'T1'); assert.equal(pbq.feedback.tasks[0].correctResponse, 'A');
  assert.doesNotMatch(JSON.stringify(pbq), /HIDDEN|PRIVATE/);
});

test('all eleven practical renderers expose content flags without revealing explanation flags early', { timeout: 20000 }, async () => {
  const content = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
  const vite = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  try {
    const { QuestionRenderer } = await vite.ssrLoadModule('/src/QuestionRenderer.jsx');
    const { FlagContent, HumanReviewQueue } = await vite.ssrLoadModule('/src/ContentReview.jsx');
    const { QuizView } = await vite.ssrLoadModule('/src/QuizView.jsx');
    const { PbqView } = await vite.ssrLoadModule('/src/PbqView.jsx');
    const types = new Set(content.questions.map((question) => question.interaction.type));
    assert.equal(types.size, 11);
    for (const type of types) {
      const question = content.questions.find((entry) => entry.interaction.type === type);
      const snapshot = contentSnapshot(question);
      assert.equal(snapshot.interaction.type, type);
      const html = renderToStaticMarkup(React.createElement(QuestionRenderer, { item: question, response: null, onChange: () => {} }));
      assert.match(html, /Flag content/, type); assert.doesNotMatch(html, /Flag explanation/, type);
      const complete = renderToStaticMarkup(React.createElement(QuestionRenderer, { item: question, response: null, onChange: () => {}, disabled: true, feedback: { earned: 0, possible: 1, explanation: 'Shown' } }));
      assert.match(complete, /Flag explanation \/ answer key/, type);
      assert.match(complete, /class="content-flag-button" type="button" aria-expanded="false"/, `${type}: flag is usable after submission`);
    }
    const labelled = { ...content.questions.find((entry) => entry.interaction.type === 'single_select'), topic: 'ANSWER_HINT_SHOULD_BE_HIDDEN' };
    const candidate = renderToStaticMarkup(React.createElement(QuestionRenderer, { item: labelled, response: null, onChange: () => {} }));
    assert.doesNotMatch(candidate, /ANSWER_HINT_SHOULD_BE_HIDDEN/);
    const hidden = renderToStaticMarkup(React.createElement(FlagContent, { item, target: 'explanation' }));
    assert.equal(hidden, '');
    const empty = renderToStaticMarkup(React.createElement(HumanReviewQueue));
    assert.match(empty, /No content flags yet/); assert.match(empty, /Export 0 shown reviews/);
    const question = { id: 'Q1', question: 'Custom question?', choices: [{ id: 'A', text: 'Choice A' }], selectCount: 1 };
    const session = { questionIds: ['Q1'], index: 0, selectedIds: [], title: 'Custom drill' };
    for (const shown of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(QuizView, { question, session: { ...session, feedback: shown ? { correctIds: ['A'], explanation: 'Shown explanation' } : null } }));
      assert.match(html, /Flag content/);
      assert.equal(html.includes('Flag explanation / answer key'), shown);
      const pbq = { id: 'P1', title: 'Legacy PBQ', primary_domain: 1, objective_ids: ['1.1'], tasks: [{ id: 'T1', prompt: 'Choose', response_type: 'single_select', options: [{ id: 'A', text: 'Choice A' }] }], exhibits: [], scenario_md: 'Scenario' };
      const attempt = shown ? { submitted: true, result: { points: 1, possible: 1, tasks: [{ taskId: 'T1', correct: true, points: 1, possible: 1, correctResponse: 'A', explanation: 'Shown task explanation' }] } } : {};
      const pbqHtml = renderToStaticMarkup(React.createElement(PbqView, { pbq, attempt }));
      assert.match(pbqHtml, /Flag content/);
      assert.equal(pbqHtml.includes('Flag explanation / answer key'), shown);
    }
  } finally { await vite.close(); }
});
