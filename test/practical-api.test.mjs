import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { parsePracticalPackage, writePracticalPackage } from '../practical-import.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('exam API saves and resumes securely, grades once, and auto-submits at server deadline', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-practical-api-'));
  const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
  writePracticalPackage(dir, bundle);
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ sets: [{ id: 'old', name: 'Test Prep 1', questions: [{ id: 'SEC-Q001', question: 'Legacy?', selectCount: 1, correctIds: ['A'], choices: [{ id: 'A', text: 'Right' }, { id: 'B', text: 'Wrong' }] }], pbqs: [] }] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'production', PORT: String(port), STUDY_DATA_DIR: dir, STUDY_USERNAME: 'learner', STUDY_PASSWORD: 'private-test-password', STUDY_ORIGIN: 'https://study.example.test' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const authorization = `Basic ${Buffer.from('learner:private-test-password').toString('base64')}`;
  async function request(route, method = 'GET', body, auth = authorization, extra = {}) {
    const response = await fetch(base + route, { method, headers: { ...(auth ? { authorization: auth } : {}), ...(body !== undefined ? { 'content-type': 'application/json', 'x-study-request': '1' } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.ok(ready);
    assert.equal((await request('/api/practical/overview', 'GET', undefined, null)).status, 401);
    assert.equal((await request('/api/practical/attempts', 'POST', null)).status, 400);
    const overview = await request('/api/practical/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.metadata.length, 1546);
    assert.equal(overview.body.exams.length, 18);
    assert.deepEqual(overview.body.exams[0].domains, bundle.exams[0].blueprint.domain_target_counts);
    assert.doesNotMatch(JSON.stringify(overview.body), /"(?:answer_key|correctIds|solution_rules|accepted_commands)"\s*:/);
    const practicalMix = await request('/api/practical/attempts', 'POST', { mode: 'learning', count: 20, mix: 'practical' });
    assert.equal(practicalMix.status, 201);
    assert.equal(practicalMix.body.attempt.items.filter((item) => item.question_kind === 'multiple_choice').length, 8);
    assert.equal(practicalMix.body.attempt.items.filter((item) => item.question_kind === 'interactive').length, 7);
    assert.equal(practicalMix.body.attempt.items.filter((item) => ['pbq', 'legacy_pbq'].includes(item.question_kind)).length, 5);
    assert.equal((await request('/api/answer', 'POST', { id: 'SEC-Q001', selectedIds: ['B'] })).status, 410);
    assert.equal((await request('/api/practical/attempts', 'POST', { mode: 'exam', examId: 'SY701-PRACTICE-01' }, authorization, { origin: 'https://evil.example' })).status, 403);
    const started = await request('/api/practical/attempts', 'POST', { mode: 'exam', examId: 'SY701-PRACTICE-01' });
    assert.equal(started.status, 201);
    const exam = started.body.attempt;
    assert.equal(exam.itemCount, 90);
    assert.equal(exam.items[0].interaction.type, 'multi_select');
    assert.doesNotMatch(JSON.stringify(exam), /"(?:answer_key|correctIds|solution_rules|accepted_commands|output_preview_after_submission)"\s*:/);
    const id = exam.id; const first = exam.items[0];
    const response = [first.interaction.candidate_ids[0]];
    assert.equal((await request(`/api/practical/attempts/${id}/answer`, 'PUT', { questionId: first.id, response, flagged: true, cursor: 1, earned: 999, baseRevision: 0 })).status, 200);
    assert.equal((await request(`/api/practical/attempts/${id}/answer`, 'PUT', { questionId: first.id, response: [first.interaction.candidate_ids.at(-1)], flagged: false, cursor: 0, baseRevision: 0 })).status, 409);
    const resumed = await request(`/api/practical/attempts/${id}`);
    assert.equal(resumed.body.attempt.cursor, 1);
    assert.deepEqual(resumed.body.attempt.responses[first.id], response);
    assert.equal(resumed.body.attempt.flags[first.id], true);
    assert.deepEqual(resumed.body.attempt.feedback, {});
    assert.equal(resumed.body.attempt.results, undefined);
    assert.equal((await request(`/api/practical/attempts/${id}/check`, 'POST', { questionId: first.id, response })).status, 403);
    assert.equal((await request(`/api/practical/attempts/${id}/answer`, 'PUT', { questionId: 'NOT-IN-EXAM', response: 'A' })).status, 400);
    const submitted = await request(`/api/practical/attempts/${id}/submit`, 'POST', {});
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.attempt.status, 'completed');
    assert.equal(Object.keys(submitted.body.attempt.results).length, 90);
    const repeat = await request(`/api/practical/attempts/${id}/submit`, 'POST', {});
    assert.deepEqual(repeat.body.attempt.score, submitted.body.attempt.score);
    assert.equal((await request(`/api/practical/attempts/${id}/answer`, 'PUT', { questionId: first.id, response })).status, 409);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'practical-state.json')));
    assert.equal(state.learning[first.id].attemptCount, 1);

    const cli = bundle.questions.find((item) => item.interaction.type === 'simulated_cli');
    const learning = await request('/api/practical/attempts', 'POST', { mode: 'learning', ids: [cli.id] });
    const learningId = learning.body.attempt.id;
    const wrong = await request('/api/practical/simulate', 'POST', { attemptId: learningId, questionId: cli.id, command: 'nmap -A 8.8.8.8; whoami' });
    assert.deepEqual(wrong.body, { accepted: false, output: '' });
    const valid = await request('/api/practical/simulate', 'POST', { attemptId: learningId, questionId: cli.id, command: bundle.answerKeys[cli.id].answer.accepted_commands[0] });
    assert.equal(valid.body.accepted, true);
    const checked = await request(`/api/practical/attempts/${learningId}/check`, 'POST', { questionId: cli.id, response: { command: bundle.answerKeys[cli.id].answer.accepted_commands[0], interpretation: bundle.answerKeys[cli.id].answer.interpretation }, requestId: 'check-one' });
    assert.equal(checked.body.feedback.earned, cli.points);
    const checkedAgain = await request(`/api/practical/attempts/${learningId}/check`, 'POST', { questionId: cli.id, response: { command: bundle.answerKeys[cli.id].answer.accepted_commands[0], interpretation: bundle.answerKeys[cli.id].answer.interpretation }, requestId: 'check-one' });
    assert.equal(checkedAgain.body.retry, true);
    assert.equal((await request(`/api/practical/attempts/${learningId}/check`, 'POST', { questionId: cli.id, response: { command: 'other', interpretation: '' }, requestId: 'check-one' })).status, 409);
    const timed = await request('/api/practical/attempts', 'POST', { mode: 'exam', examId: 'SY701-PRACTICE-02' });
    const timeoutId = timed.body.attempt.id;
    const timeoutState = JSON.parse(fs.readFileSync(path.join(dir, 'practical-state.json')));
    timeoutState.attempts[timeoutId].deadlineAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(path.join(dir, 'practical-state.json'), JSON.stringify(timeoutState));
    const expired = await request(`/api/practical/attempts/${timeoutId}`);
    assert.equal(expired.body.attempt.status, 'timed_out');
    assert.equal(expired.body.attempt.score.earned, 0);
    const raw = await fetch(`${base}/practical-content.json`, { headers: { authorization } });
    const html = await raw.text();
    assert.match(html, /<html lang="en">/);
    assert.doesNotMatch(html, /accepted_commands|solution_rules/);
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});
