import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('mutations reject cross-site requests and answer retries count once', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-study-test-'));
  const port = await freePort();
  const origin = 'https://study.example.test';
  const library = { sets: [{ id: 'fixture', name: 'Fixture', questions: [{ id: 'Q1', question: 'Example?', selectCount: 1, correctIds: ['B'], choices: [{ id: 'A', text: 'No' }, { id: 'B', text: 'Yes' }] }], pbqs: [] }] };
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify(library));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), STUDY_DATA_DIR: dir, STUDY_USERNAME: 'tester', STUDY_PASSWORD: 'test-secret', STUDY_ORIGIN: origin },
    stdio: 'ignore',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, 'study server started');
    const authorization = `Basic ${Buffer.from('tester:test-secret').toString('base64')}`;
    const answer = { id: 'Q1', selectedIds: ['B'], requestId: 'session:0:Q1:B' };
    const post = (route, headers, body = JSON.stringify(answer), method = 'POST') => fetch(`${base}${route}`, { method, headers: { authorization, ...headers }, body });

    for (const route of ['/api/import', '/api/answer', '/api/pbq/response', '/api/pbq/submit', '/api/pbq/reset']) {
      const response = await post(route, { origin: 'https://attacker.example', 'content-type': 'text/plain' });
      assert.equal(response.status, 403, route);
    }
    assert.equal((await post('/api/answer', { 'content-type': 'text/plain' })).status, 403);
    assert.equal((await post('/api/answer', { origin: 'null', 'content-type': 'text/plain' })).status, 403);
    assert.equal((await post('/api/answer', { origin, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' })).status, 403);
    assert.equal(fs.existsSync(path.join(dir, 'progress.json')), false);

    const headers = { origin, 'content-type': 'application/json' };
    let response = await post('/api/answer', headers);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).progress.attempts, 1);
    response = await post('/api/answer', headers);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).progress.attempts, 1);
    response = await post('/api/answer', { 'x-study-request': '1', 'content-type': 'application/json' }, JSON.stringify({ ...answer, requestId: 'session:0:Q1:B:next' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).progress.attempts, 2);
    response = await post('/api/answer', headers);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).progress.attempts, 2);
    response = await post('/api/answer', headers, JSON.stringify({ ...answer, selectedIds: ['A'] }));
    assert.equal(response.status, 409);

    response = await post('/api/answer', headers, JSON.stringify({ ...answer, padding: 'x'.repeat(9000) }));
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /too large/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'))).answers.Q1.attempts, 2);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
