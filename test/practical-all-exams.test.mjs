import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { parsePracticalPackage, writePracticalPackage } from '../practical-import.mjs';

const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
const itemById = new Map(bundle.questions.map((item) => [item.id, item]));

function canonicalResponse(item, key) {
  switch (item.interaction.type) {
    case 'text_entry': return key.answer[0];
    case 'simulated_cli': return { command: key.answer.accepted_commands[0], interpretation: key.answer.interpretation };
    case 'firewall_rules': return key.answer.solution_rules.map((rule, index) => ({ priority: (index + 1) * 10, action: rule.action, protocol: rule.proto, source_cidr: rule.src, destination_cidr: rule.dst, destination_port: rule.port }));
    case 'legacy_pbq': return Object.fromEntries(key.answer_key.map((part) => [part.task_id, typeof part.correct_response === 'number' ? String(part.correct_response) : part.correct_response]));
    default: return key.answer;
  }
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test('all ten fixed exams and eight additional assessments save, resume and grade every allocated item', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-all-exams-'));
  writePracticalPackage(dir, bundle);
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: {
    ...process.env, NODE_ENV: 'production', PORT: String(port), STUDY_DATA_DIR: dir,
    STUDY_USERNAME: 'learner', STUDY_PASSWORD: 'private-test-password', STUDY_ORIGIN: 'https://study.example.test',
  }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const authorization = `Basic ${Buffer.from('learner:private-test-password').toString('base64')}`;
  async function request(route, method = 'GET', body) {
    const response = await fetch(base + route, { method, headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-study-request': '1' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, 'server started');
    const overview = await request('/api/practical/overview');
    assert.equal(overview.exams.length, 18);
    const placed = new Set();
    for (const exam of overview.exams) {
      const started = (await request('/api/practical/attempts', 'POST', { mode: 'exam', examId: exam.id })).attempt;
      assert.equal(started.itemCount, exam.count);
      assert.equal(started.manifestVersion, exam.version);
      assert.ok(started.deadlineAt);
      assert.deepEqual(started.feedback, {});
      for (const id of started.questionIds) {
        assert.equal(placed.has(id), false, `cross-assessment repeat ${id}`);
        placed.add(id);
        const item = itemById.get(id);
        const response = canonicalResponse(item, bundle.answerKeys[id]);
        await request(`/api/practical/attempts/${started.id}/answer`, 'PUT', { questionId: id, response });
      }
      const resumed = (await request(`/api/practical/attempts/${started.id}`)).attempt;
      assert.equal(resumed.answeredCount, exam.count);
      assert.equal(Object.keys(resumed.responses).length, exam.count);
      assert.deepEqual(resumed.feedback, {});
      const completed = (await request(`/api/practical/attempts/${started.id}/submit`, 'POST', {})).attempt;
      assert.equal(completed.status, 'completed');
      assert.equal(completed.score.earned, completed.score.possible, exam.id);
      assert.equal(Object.keys(completed.results).length, exam.count);
      assert.equal((await request(`/api/practical/attempts/${started.id}/submit`, 'POST', {})).attempt.score.earned, completed.score.earned);
    }
    assert.equal(placed.size, bundle.questions.length);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'practical-state.json'), 'utf8'));
    assert.equal(Object.keys(state.attempts).length, 18);
    assert.equal(Object.keys(state.learning).length, bundle.questions.length);
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});
