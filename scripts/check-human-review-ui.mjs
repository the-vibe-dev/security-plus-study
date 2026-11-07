// Optional real-browser regression check. Requires a local Chromium executable.
// Run after npm run build: CHROMIUM_PATH=/usr/bin/chromium node scripts/check-human-review-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-review-ui-'));
const children = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) { try { const value = await check(); if (value) return value; } catch {} await delay(100); }
  throw new Error(`Timed out: ${typeof label === 'function' ? label() : label}`);
}
async function freePort() {
  const server = net.createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child); let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('error', (err) => { output += err.message; }); child.output = () => output; return child;
}
async function startServer(dir) {
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const child = launch(process.execPath, ['server.mjs'], { env: { ...process.env, STUDY_DATA_DIR: dir, PORT: String(port), STUDY_ORIGIN: origin, STUDY_USERNAME: '', STUDY_PASSWORD: '', NODE_ENV: '' } });
  await until(async () => (await fetch(`${origin}/api/health`)).ok, `study server ${child.output()}`); return origin;
}

let socket;
try {
  const data = path.join(temp, 'data');
  execFileSync(process.execPath, ['scripts/setup-content.mjs'], { cwd: root, env: { ...process.env, STUDY_DATA_DIR: data }, stdio: 'pipe' });
  const origin = await startServer(data);
  const browserPort = await freePort();
  const browser = launch(process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking', `--remote-debugging-port=${browserPort}`, `--user-data-dir=${path.join(temp, 'browser')}`, 'about:blank']);
  const targets = await until(async () => (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json(), () => `Chromium launch: ${browser.output()}`);
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); const requests = []; const errors = []; let nextId = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result); }
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitText(text) { await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), text); }
  async function click(text, selector = 'button') {
    await evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim().startsWith(${JSON.stringify(text)}) && node.getClientRects().length); if (!node) throw new Error('Missing button: ' + ${JSON.stringify(text)}); node.click(); })()`); await delay(60);
  }
  async function field(label, value) {
    await evaluate(`(() => { const element = [...document.querySelectorAll('label')].find(node => node.firstChild?.textContent.trim() === ${JSON.stringify(label)})?.querySelector('input,select,textarea'); if (!element) throw new Error('Missing field: ' + ${JSON.stringify(label)}); const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`); await delay(60);
  }
  async function records() { return evaluate(`JSON.parse(localStorage.getItem('security-study-content-review-v1'))?.records || []`); }
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
  await cdp('Page.navigate', { url: origin }); await waitText('Build confidence through practice.');
  await click('Quick mixed quizTen questions with immediate learning feedback', '.practical-actions button');
  await waitText('⚑ Flag content');
  assert.equal(await evaluate(`document.body.innerText.includes('Flag explanation / answer key')`), false);
  const requestCount = requests.length;
  await click('⚑ Flag content'); await field('Concern or task ID', 'Discard this note'); await click('Cancel');
  assert.equal((await records()).length, 0);
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), '⚑ Flag content');
  await click('⚑ Flag content'); await field('Reason', 'conflict'); await field('Concern or task ID', 'Check with instructor, task T1.'); await field('Reference to check (optional)', 'Course module 4'); await click('Save flag');
  assert.equal((await records()).length, 1);
  await click('Content open · Edit flag'); await field('Concern or task ID', 'Updated concern from training.'); await click('Save review');
  assert.equal((await records()).length, 1);
  assert.equal((await records())[0].note, 'Updated concern from training.');
  await click('Content open · Edit flag'); await field('Concern or task ID', 'Keep this draft if storage fails.');
  await evaluate(`window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'security-study-content-review-v1') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return window.__originalSetItem.call(this, key, value); };`);
  await click('Save review'); await waitText('Could not save the content flag.');
  assert.equal(await evaluate(`document.querySelector('.content-review-form textarea').value`), 'Keep this draft if storage fails.');
  assert.equal((await records())[0].note, 'Updated concern from training.');
  await evaluate('Storage.prototype.setItem = window.__originalSetItem'); await click('Save review');
  assert.equal(requests.length, requestCount, 'flag creation and editing must not send a network request');
  await cdp('Page.reload'); await waitText('Content open · Edit flag');
  await evaluate(`document.querySelector('.practical-choice input[type=radio]').click()`);
  await click('Check answer'); await waitText('⚑ Flag explanation / answer key');
  await click('⚑ Flag explanation / answer key'); await field('Reason', 'accuracy'); await field('Concern or task ID', 'Review the displayed explanation.'); await click('Save flag');
  assert.equal((await records()).length, 2);
  await click('Human Review', '.sidebar-nav button'); await waitText('2 shown');
  await click('Edit / resolve review'); await field('Review status', 'resolved'); await click('Save review');
  assert.equal((await records()).filter((record) => record.status === 'resolved').length, 0, 'resolution requires a finding');
  await field('Review outcome', 'confirmed'); await field('Review notes / proposed correction', 'Checked the public documentation; wording is accurate.'); await click('Save review');
  await waitText('1 shown'); await field('Status', 'resolved'); await waitText('1 resolved');
  await click('Edit / reopen review'); await field('Review status', 'in_review'); await click('Save review');
  await field('Status', 'all'); await waitText('2 shown');
  await click('Edit / resolve review'); await field('Concern or task ID', 'A stale draft must not overwrite another review.');
  await evaluate(`(() => { const key = 'security-study-content-review-v1'; const data = JSON.parse(localStorage.getItem(key)); const latest = [...data.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; latest.revision++; latest.status = 'resolved'; latest.outcome = 'confirmed'; latest.resolution = 'Confirmed in another tab.'; localStorage.setItem(key, JSON.stringify(data)); window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(data) })); })()`);
  await click('Save review'); await waitText('This review changed in another tab');
  assert.equal(await evaluate(`document.querySelector('.content-review-form textarea').value`), 'A stale draft must not overwrite another review.');
  assert.equal((await records()).some((record) => record.status === 'resolved' && record.resolution === 'Confirmed in another tab.'), true);
  await click('Cancel');
  await evaluate(`window.__exportBlob = null; URL.createObjectURL = blob => { window.__exportBlob = blob; return 'blob:review-test'; }; HTMLAnchorElement.prototype.click = function() {};`);
  await click('Export 2 shown reviews (JSON)');
  const exported = JSON.parse(await evaluate('window.__exportBlob.text()'));
  assert.equal(exported.records.length, 2);
  assert.equal(exported.records[0].note.length > 0, true);
  assert.equal(exported.records.some((record) => 'response' in record || 'attemptId' in record || 'score' in record), false);
  await cdp('Page.reload'); await waitText('Human Review');
  assert.equal((await records()).length, 2);
  await click('Dark mode');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitText('Human Review');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'mobile queue does not overflow');
  await click('Overview', '.practical-mobile-nav button'); await click('Human Review', '.practical-mobile-nav button');
  await waitText('Human Review');
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(process.env.REVIEW_SCREENSHOT_DIR, 'human-review-mobile.png'), Buffer.from(screenshot.data, 'base64'));
  }
  // A corrupt list cannot be overwritten by a new flag; failures remain visible.
  await evaluate(`localStorage.setItem('security-study-content-review-v1', '{broken')`);
  await cdp('Page.reload'); await waitText('It has not been overwritten.');

  // Exercise the legacy custom-question workspace using a separate temporary server.
  const legacy = path.join(temp, 'legacy'); fs.mkdirSync(legacy); fs.copyFileSync(path.join(data, 'library.json'), path.join(legacy, 'library.json'));
  const legacyOrigin = await startServer(legacy);
  await cdp('Emulation.clearDeviceMetricsOverride');
  await cdp('Page.navigate', { url: legacyOrigin }); await waitText('Practice');
  await click('Practice', '.sidebar-nav button'); await waitText('Start drill'); await click('Start drill'); await waitText('⚑ Flag content');
  await click('⚑ Flag content'); await field('Reason', 'ambiguity'); await click('Save flag');
  assert.equal((await records())[0].source, 'legacy-question');
  await click('PBQs', '.sidebar-nav button'); await waitText('Performance-based practice');
  await evaluate(`document.querySelector('.pbq-list>button').click()`); await waitText('⚑ Flag content');
  await click('⚑ Flag content'); await field('Reason', 'ambiguity'); await field('Concern or task ID', 'Review task T2.'); await click('Save flag');
  assert.equal((await records()).some((record) => record.source === 'legacy-pbq'), true);
  await click('Human Review', '.sidebar-nav button'); await waitText('2 shown');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".mobile-bottom-nav")).gridTemplateColumns.split(" ").length'), 6);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  assert.deepEqual(errors, []);
  console.log('Human review browser checks passed: creation, cancel/focus, duplicate edit, reload, gated explanation flags, resolve/reopen, stale-tab conflicts, storage failures, export, network privacy, mobile/dark mode, corrupt storage, legacy MCQ and PBQ.');
} finally {
  socket?.close();
  for (const child of children.reverse()) child.kill('SIGTERM');
  await delay(300);
  fs.rmSync(temp, { recursive: true, force: true });
}
