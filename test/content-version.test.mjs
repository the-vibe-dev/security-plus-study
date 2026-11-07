import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parsePracticalPackage } from '../practical-import.mjs';

test('bank upgrades preserve saved questions, draft validation, grading, CLI fixtures, deadlines and exam resumes', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-bank-versions-'));
  const current = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
  const old = structuredClone(current); old.version = 'original-test-bank'; old.sha256 = 'original-test-content';
  old.exams.forEach((exam) => { exam.version = old.version; });
  for (const q of old.questions) q.prompt += ' [Original bank]';
  for (const q of current.questions) q.prompt += ' [Updated bank]';
  const qid = 'SPX-Q0011', cliId = 'SPX-CLI_TOOLS-008';
  for (const [bank, letter] of [[old, 'A'], [current, 'B']]) {
    bank.questions.find((q) => q.id === qid).interaction.options = ['A', 'B', 'C', 'D'].map((id) => ({ id, text: `${bank.version} choice ${id}` }));
    bank.answerKeys[qid].answer = letter;
  }
  old.answerKeys[cliId].answer.accepted_commands = ['old-view'];
  current.answerKeys[cliId].answer.accepted_commands = ['new-view'];
  const file = path.join(dir, 'practical-content.json');
  fs.writeFileSync(file, JSON.stringify(old));
  const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), STUDY_DATA_DIR: dir, NODE_ENV: '', STUDY_USERNAME: '', STUDY_PASSWORD: '' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  async function request(route, method = 'GET', body) {
    const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', 'x-study-request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }
  const start = async (config) => (await request('/api/practical/attempts', 'POST', config)).body.attempt;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 30)); }
    const learning = await start({ mode: 'learning', ids: [qid, cliId] });
    const timed = await start({ mode: 'timed', ids: [qid] });
    const exam = await start({ mode: 'exam', examId: old.exams[0].id });
    // Existing deployments predate contentVersion/contentSha256: manifestVersion remains supported.
    const stateFile = path.join(dir, 'practical-state.json');
    let state = JSON.parse(fs.readFileSync(stateFile));
    for (const a of Object.values(state.attempts)) { delete a.contentVersion; delete a.contentSha256; }
    fs.writeFileSync(stateFile, JSON.stringify(state));
    fs.writeFileSync(file, JSON.stringify(current));
    const frozen = fs.readFileSync(stateFile);
    assert.equal((await request(`/api/practical/attempts/${learning.id}`)).status, 503);
    assert.deepEqual(fs.readFileSync(stateFile), frozen, 'missing original bank cannot change saved work');
    const archive = path.join(dir, 'content-archive'); fs.mkdirSync(archive);
    const archived = path.join(archive, `${createHash('sha256').update(old.version).digest('hex')}.json`);
    fs.writeFileSync(archived, JSON.stringify(old));
    const resumed = (await request(`/api/practical/attempts/${learning.id}`)).body.attempt;
    assert.match(resumed.items[0].prompt, /Original bank/);
    const draft = await request(`/api/practical/attempts/${learning.id}/draft`, 'PUT', { baseRevision: 0, responses: { [qid]: 'A', [cliId]: { command: 'old-view', interpretation: old.answerKeys[cliId].answer.interpretation } }, flags: {}, cursor: 0 });
    assert.equal(draft.status, 200);
    assert.equal((await request(`/api/practical/attempts/${learning.id}/check`, 'POST', { questionId: qid, response: 'A' })).body.feedback.correct, true);
    assert.equal((await request('/api/practical/simulate', 'POST', { attemptId: learning.id, questionId: cliId, command: 'old-view' })).body.accepted, true);
    assert.equal((await request('/api/practical/simulate', 'POST', { attemptId: learning.id, questionId: cliId, command: 'new-view' })).body.accepted, false);
    const submitted = (await request(`/api/practical/attempts/${learning.id}/submit`, 'POST', {})).body.attempt;
    assert.equal(submitted.score.percent, 100);
    assert.match((await request(`/api/practical/attempts/${learning.id}`)).body.attempt.items[0].prompt, /Original bank/);
    const again = await start({ mode: 'exam', examId: old.exams[0].id });
    assert.equal(again.id, exam.id); assert.match(again.items[0].prompt, /Original bank/);
    await request(`/api/practical/attempts/${timed.id}/answer`, 'PUT', { questionId: qid, response: 'A' });
    state = JSON.parse(fs.readFileSync(stateFile)); state.attempts[timed.id].deadlineAt = new Date(Date.now() - 1000).toISOString(); fs.writeFileSync(stateFile, JSON.stringify(state));
    const overview = await request('/api/practical/overview'); assert.equal(overview.status, 200);
    assert.equal(overview.body.attempts.find((a) => a.id === timed.id).score.percent, 100, 'deadline grading uses original key');
    const next = await start({ mode: 'learning', ids: [qid] });
    assert.match(next.items[0].prompt, /Updated bank/);
    assert.equal((await request(`/api/practical/attempts/${next.id}/check`, 'POST', { questionId: qid, response: 'B' })).body.feedback.correct, true);
    // A bank rewritten under the same version must never silently regrade a new attempt.
    current.sha256 = 'unexpected-replacement'; fs.writeFileSync(file, JSON.stringify(current));
    assert.equal((await request(`/api/practical/attempts/${next.id}`)).status, 503);
    assert.ok(fs.existsSync(archived));
  } finally { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
