import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { reviewId } from '../src/contentReviewStore.js';

async function startServer(directory, credentials) {
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url), stdio: 'ignore',
    env: { ...process.env, NODE_ENV: '', STUDY_USERNAME: credentials?.user || '', STUDY_PASSWORD: credentials?.password || '', STUDY_DATA_DIR: directory, PORT: String(port), STUDY_ORIGIN: origin },
  });
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } };
  for (let tries = 0; tries < 100; tries++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return { origin, stop };
    } catch {}
    await delay(30);
  }
  await stop();
  throw new Error('Study server did not start.');
}

const credentials = { user: 'review-test', password: 'test-fixture-only' };
const authorization = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`;
function draft(itemId = 'SPX-Q0011') {
  return { source: 'practical', itemId, setId: '', target: 'question', reason: 'ambiguity', note: 'Clarify the scenario.',
    title: 'Sample question', snapshot: { id: itemId, prompt: 'Sample question', interaction: { type: 'single_select' }, response: 'private', feedback: { explanation: 'Hidden until submission' } },
    examId: 'SY701-PRACTICE-02', bankVersion: 'fixture-bank' };
}
async function request(origin, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${origin}/api/content-reviews`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Authorization: authorization, 'Content-Type': 'application/json', 'X-Study-Request': '1', ...headers },
  });
  return { status: response.status, data: await response.json(), cacheControl: response.headers.get('cache-control') };
}

test('authenticated content flags persist across sessions and preserve newer reviews', { timeout: 15000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-server-reviews-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const server = await startServer(directory, credentials);
  t.after(server.stop);
  assert.equal((await request(server.origin, { headers: { Authorization: '' } })).status, 401);
  assert.equal((await request(server.origin, { method: 'PUT', body: draft(), headers: { Origin: 'https://other.example' } })).status, 403);
  const saved = await request(server.origin, { method: 'PUT', body: draft() });
  assert.equal(saved.status, 200);
  assert.equal(saved.cacheControl, 'no-store');
  const [record] = saved.data.records;
  assert.equal(record.examId, 'SY701-PRACTICE-02');
  assert.equal(record.bankVersion, 'fixture-bank');
  assert.equal(record.snapshot.response, undefined);
  assert.equal(record.snapshot.feedback, undefined);
  const updates = await Promise.all(['First edit', 'Second edit'].map((note) => request(server.origin, { method: 'PUT', body: { ...record, note } })));
  assert.deepEqual(updates.map(({ status }) => status).sort(), [200, 409]);
  const winner = updates.find(({ status }) => status === 200).data.records[0];
  const legacy = { ...record, ...draft('SPX-Q0012'), snapshot: record.snapshot, reference: '', resolution: '', outcome: '', status: 'open' };
  legacy.id = reviewId(legacy, legacy.target);
  const migration = await request(server.origin, { method: 'POST', body: { records: [record, legacy] } });
  assert.equal(migration.status, 200);
  assert.equal(migration.data.skipped, 1);
  assert.equal(migration.data.records[0].id, legacy.id);
  await server.stop();
  const restarted = await startServer(directory, credentials);
  t.after(restarted.stop);
  const persisted = await request(restarted.origin);
  assert.equal(persisted.data.enabled, true);
  assert.equal(persisted.data.records.length, 2);
  assert.deepEqual(persisted.data.records[0], winner);
  const [filename] = await fs.readdir(path.join(directory, 'content-reviews'));
  assert.equal((await fs.stat(path.join(directory, 'content-reviews', filename))).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(directory), ['content-reviews']);
});

test('password-free study keeps flags in the browser', { timeout: 10000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-browser-reviews-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const server = await startServer(directory);
  t.after(server.stop);
  assert.deepEqual((await request(server.origin)).data, { enabled: false, records: [] });
  assert.equal((await request(server.origin, { method: 'PUT', body: draft() })).status, 403);
  assert.deepEqual(await fs.readdir(directory), []);
});
