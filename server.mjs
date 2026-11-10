import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { importQuestionFile } from './import.mjs';
import { gradeQuiz, gradePbq } from './scoring.mjs';
import { handlePracticalApi } from './practical-api.mjs';
import { handleContentReviews } from './content-review-api.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = process.env.STUDY_DATA_DIR || path.join(ROOT, 'data');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const PRACTICAL_CONTENT_FILE = path.join(DATA_DIR, 'practical-content.json');
const PORT = Number(process.env.PORT || 4173);
const USER = process.env.STUDY_USERNAME || '';
const PASSWORD = process.env.STUDY_PASSWORD || '';
const STUDY_ORIGIN = process.env.STUDY_ORIGIN || `http://127.0.0.1:${PORT}`;
const MAX_UPLOAD = 30 * 1024 * 1024;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' };

fs.mkdirSync(DATA_DIR, { recursive: true });
if (process.env.NODE_ENV === 'production' && (!USER || !PASSWORD)) throw new Error('Production requires STUDY_USERNAME and STUDY_PASSWORD.');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}
function baseHeaders() {
  return { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" };
}
function send(res, status, body, contentType = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...baseHeaders(), 'content-type': contentType, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function equal(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function authorized(req) {
  if (!USER || !PASSWORD) return true;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const separator = decoded.indexOf(':');
  return separator !== -1 && equal(decoded.slice(0, separator), USER) && equal(decoded.slice(separator + 1), PASSWORD);
}
function allowedMutation(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  if (origin && origin !== STUDY_ORIGIN) return false;
  if (fetchSite && fetchSite !== 'same-origin') return false;
  return origin === STUDY_ORIGIN || fetchSite === 'same-origin' || req.headers['x-study-request'] === '1';
}
function bodyBytes(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on('end', () => tooLarge ? reject(Object.assign(new Error('Request body is too large.'), { status: 413 })) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function badInput(res, error, message) {
  return send(res, error?.status === 413 ? 413 : 400, { error: error?.status === 413 ? error.message : message });
}
function allQuestions(library) {
  return library.sets.flatMap((set) => set.questions.map((question) => ({ ...question, setId: set.id, setName: set.name })));
}
function allPbqs(library) {
  return library.sets.flatMap((set) => (set.pbqs || []).map((pbq) => ({ ...pbq, setId: set.id, setName: set.name })));
}
function candidateQuestion(question) {
  const { correctIds, explanation, examTip, sourceUrls, ...publicFields } = question;
  return { ...publicFields, choices: question.choices.map(({ id, text }) => ({ id, text })) };
}
function candidatePbq(pbq) {
  const { answer_key, ...publicFields } = pbq;
  const keyByTask = new Map(answer_key.map((key) => [key.task_id, key]));
  return { ...publicFields, tasks: pbq.tasks.map((task) => ({ ...task, selectCount: task.response_type === 'multi_select' ? keyByTask.get(task.id).correct_response.length : undefined })) };
}
function readProgress() {
  const progress = readJson(PROGRESS_FILE, { answers: {}, pbqs: {} });
  return { answers: progress.answers || {}, pbqs: progress.pbqs || {} };
}
function validPbqResponse(task, response) {
  const ids = new Set(task.options.map((option) => option.id));
  switch (task.response_type) {
    case 'single_select': return response === '' || (typeof response === 'string' && ids.has(response));
    case 'multi_select': return Array.isArray(response) && response.length <= ids.size && new Set(response).size === response.length && response.every((id) => ids.has(id));
    case 'ordering': return Array.isArray(response) && response.length === ids.size && new Set(response).size === ids.size && response.every((id) => ids.has(id));
    case 'number': return typeof response === 'string' && response.length <= 50 && (response.trim() === '' || Number.isFinite(Number(response)));
    default: return false;
  }
}
async function api(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });
  if (pathname === '/api/content-reviews') return handleContentReviews(req, res, { dataDir: DATA_DIR, owner: USER && PASSWORD ? USER : '', send, bodyBytes });
  if (pathname.startsWith('/api/practical/')) return handlePracticalApi(req, res, pathname, { dataDir: DATA_DIR, owner: USER || 'local-study-user', send, bodyBytes });
  if (fs.existsSync(PRACTICAL_CONTENT_FILE) && (pathname === '/api/answer' || pathname.startsWith('/api/pbq/') || pathname === '/api/import' || (pathname === '/api/library' && req.method === 'DELETE'))) return send(res, 410, { error: 'This legacy learning route is archived. Use the current Security+ practice engine.' });
  const library = readJson(LIBRARY_FILE, { sets: [] });
  if (pathname === '/api/library' && req.method === 'GET') return send(res, 200, { sets: library.sets.map(({ questions, pbqs, practiceSets, ...set }) => ({ ...set, count: questions.length, pbqCount: (pbqs || []).length, practiceSetCount: practiceSets?.sets?.length || 0 })) });
  if (pathname === '/api/questions' && req.method === 'GET') return send(res, 200, { questions: allQuestions(library).map(candidateQuestion) });
  if (pathname === '/api/pbqs' && req.method === 'GET') return send(res, 200, { pbqs: allPbqs(library).map(candidatePbq) });
  if (pathname === '/api/practice-sets' && req.method === 'GET') return send(res, 200, { sets: library.sets.flatMap((set) => (set.practiceSets?.sets || []).map((practice) => ({ ...practice, subjectId: set.id }))) });
  if (pathname === '/api/progress' && req.method === 'GET') return send(res, 200, readProgress());
  if (pathname === '/api/import' && req.method === 'POST') {
    try {
      const bytes = await bodyBytes(req, MAX_UPLOAD);
      const filename = decodeURIComponent(String(req.headers['x-file-name'] || 'questions.zip'));
      const imported = importQuestionFile(filename, bytes);
      const id = imported.id || String(Date.now());
      library.sets = library.sets.filter((set) => set.id !== id);
      library.sets.push({ ...imported, id });
      writeJson(LIBRARY_FILE, library);
      return send(res, 201, { set: { id, name: imported.name, count: imported.questions.length, pbqCount: imported.pbqs.length, files: imported.files } });
    } catch (error) { return send(res, error?.status === 413 ? 413 : 400, { error: error.message || 'Import failed.' }); }
  }
  if (pathname === '/api/answer' && req.method === 'POST') {
    try {
      const input = JSON.parse((await bodyBytes(req, 8192)).toString('utf8'));
      const question = allQuestions(library).find((item) => item.id === input.id);
      const selectedIds = input.selectedIds;
      const choiceIds = new Set(question?.choices.map((choice) => choice.id) || []);
      if (!question || !Array.isArray(selectedIds) || selectedIds.length !== question.selectCount || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !choiceIds.has(id))) return send(res, 400, { error: `Select exactly ${question?.selectCount || 1} valid ${question?.selectCount === 1 ? 'answer' : 'answers'}.` });
      if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 160)) return send(res, 400, { error: 'Invalid answer request ID.' });
      const progress = readProgress();
      const previous = progress.answers[question.id] || { attempts: 0, correct: 0 };
      const recentRequests = Array.isArray(previous.recentRequests) ? previous.recentRequests : [];
      const duplicate = input.requestId && (recentRequests.find((item) => item.id === input.requestId) || (previous.lastRequestId === input.requestId ? { selectedIds: previous.lastSelectedIds, correct: previous.lastCorrect } : null));
      if (duplicate && JSON.stringify(duplicate.selectedIds) !== JSON.stringify(selectedIds)) return send(res, 409, { error: 'Answer request ID was already used.' });
      const isCorrect = duplicate ? duplicate.correct : gradeQuiz(question, selectedIds);
      if (!duplicate) {
        progress.answers[question.id] = { attempts: previous.attempts + 1, correct: previous.correct + Number(isCorrect), lastCorrect: isCorrect, lastSelectedIds: selectedIds, lastAnsweredAt: new Date().toISOString(), lastRequestId: input.requestId || null, recentRequests: input.requestId ? [...recentRequests, { id: input.requestId, selectedIds, correct: isCorrect }].slice(-64) : recentRequests };
        writeJson(PROGRESS_FILE, progress);
      }
      return send(res, 200, { correct: isCorrect, progress: duplicate ? previous : progress.answers[question.id], feedback: { correctIds: question.correctIds, explanation: question.explanation, examTip: question.examTip, rationales: Object.fromEntries(question.choices.map((choice) => [choice.id, choice.rationale])), sourceUrls: question.sourceUrls || [] } });
    } catch (error) { return badInput(res, error, 'Invalid answer.'); }
  }
  if (pathname === '/api/pbq/response' && req.method === 'POST') {
    try {
      const input = JSON.parse((await bodyBytes(req, 8192)).toString('utf8'));
      const pbq = allPbqs(library).find((item) => item.id === input.pbqId);
      const task = pbq?.tasks.find((item) => item.id === input.taskId);
      if (!task || !validPbqResponse(task, input.response)) return send(res, 400, { error: 'Invalid PBQ response.' });
      const progress = readProgress();
      const attempt = progress.pbqs[pbq.id] || { responses: {}, submitted: false, attempt: 1 };
      if (attempt.submitted) return send(res, 409, { error: 'Start a new attempt before changing answers.' });
      attempt.responses[task.id] = input.response;
      attempt.updatedAt = new Date().toISOString();
      progress.pbqs[pbq.id] = attempt;
      writeJson(PROGRESS_FILE, progress);
      return send(res, 200, { attempt });
    } catch (error) { return badInput(res, error, 'Invalid PBQ response.'); }
  }
  if (pathname === '/api/pbq/submit' && req.method === 'POST') {
    try {
      const input = JSON.parse((await bodyBytes(req, 1024)).toString('utf8'));
      const pbq = allPbqs(library).find((item) => item.id === input.pbqId);
      if (!pbq) return send(res, 404, { error: 'PBQ not found.' });
      const progress = readProgress();
      const attempt = progress.pbqs[pbq.id] || { responses: {}, submitted: false, attempt: 1 };
      if (!attempt.submitted) {
        if (input.responses && typeof input.responses === 'object' && !Array.isArray(input.responses)) {
          for (const [taskId, response] of Object.entries(input.responses)) {
            const task = pbq.tasks.find((item) => item.id === taskId);
            if (!task || !validPbqResponse(task, response)) return send(res, 400, { error: `Invalid response for ${taskId}.` });
            attempt.responses[taskId] = response;
          }
        }
        attempt.result = gradePbq(pbq, attempt.responses);
        attempt.submitted = true;
        attempt.submittedAt = new Date().toISOString();
        progress.pbqs[pbq.id] = attempt;
        writeJson(PROGRESS_FILE, progress);
      }
      return send(res, 200, { attempt });
    } catch (error) { return badInput(res, error, 'Invalid PBQ submission.'); }
  }
  if (pathname === '/api/pbq/reset' && req.method === 'POST') {
    try {
      const input = JSON.parse((await bodyBytes(req, 1024)).toString('utf8'));
      const pbq = allPbqs(library).find((item) => item.id === input.pbqId);
      if (!pbq) return send(res, 404, { error: 'PBQ not found.' });
      const progress = readProgress();
      progress.pbqs[pbq.id] = { responses: {}, submitted: false, attempt: (progress.pbqs[pbq.id]?.attempt || 0) + 1 };
      writeJson(PROGRESS_FILE, progress);
      return send(res, 200, { attempt: progress.pbqs[pbq.id] });
    } catch (error) { return badInput(res, error, 'Invalid PBQ reset.'); }
  }
  if (pathname === '/api/library' && req.method === 'DELETE') {
    try {
      const input = JSON.parse((await bodyBytes(req, 1024)).toString('utf8'));
      const before = library.sets.length;
      library.sets = library.sets.filter((set) => set.id !== input.id);
      if (library.sets.length === before) return send(res, 404, { error: 'Question set not found.' });
      writeJson(LIBRARY_FILE, library);
      const remainingIds = new Set(allQuestions(library).map((question) => question.id));
      const progress = readProgress();
      progress.answers = Object.fromEntries(Object.entries(progress.answers).filter(([id]) => remainingIds.has(id)));
      const remainingPbqIds = new Set(allPbqs(library).map((pbq) => pbq.id));
      progress.pbqs = Object.fromEntries(Object.entries(progress.pbqs).filter(([id]) => remainingPbqIds.has(id)));
      writeJson(PROGRESS_FILE, progress);
      return send(res, 200, { ok: true });
    } catch (error) { return badInput(res, error, 'Invalid request.'); }
  }
  return send(res, 404, { error: 'Not found.' });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return send(res, 400, { error: 'Invalid URL.' }); }
  if (pathname === '/api/health') return api(req, res, pathname);
  if (!authorized(req)) return send(res, 401, { error: 'Authentication required.' }, 'application/json; charset=utf-8', { 'www-authenticate': 'Basic realm="Security+ Study"' });
  if (pathname.startsWith('/api/')) {
    if (!allowedMutation(req)) return send(res, 403, { error: 'Request origin is not allowed.' });
    return api(req, res, pathname);
  }
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed.' });
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'Invalid path.' }); }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(DIST, relative);
  if (!resolved.startsWith(`${DIST}${path.sep}`)) return send(res, 403, { error: 'Forbidden.' });
  const file = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return send(res, 503, { error: 'Site has not been built.' });
  const content = fs.readFileSync(file);
  if (req.method === 'HEAD') return send(res, 200, '', mime[path.extname(file)] || 'application/octet-stream');
  return send(res, 200, content, mime[path.extname(file)] || 'application/octet-stream');
});

server.listen(PORT, '127.0.0.1', () => console.log(`Security+ Study listening on 127.0.0.1:${PORT}`));
