import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { gradePractical, publicPracticalItem, sanitizeResponse, simulateCli, validateFirewallRules, firewallDecision, parseIpv4 } from './practical-grade.mjs';

const CONTENT_FILE = 'practical-content.json';
const STATE_FILE = 'practical-state.json';
const MAX_ATTEMPT_ITEMS = 90;
const API_LIMIT = 64 * 1024;
const contentCache = new Map();
const requestCounters = new Map();
const stateQueues = new Map();

function error(status, message) { const err = new Error(message); err.status = status; throw err; }
function parseBody(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { error(400, 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) error(400, 'Expected a JSON object.');
  return value;
}
function readFileJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return fallback; throw err; } }
function writeAtomic(file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function getContent(dataDir, version = null) {
  if (version !== null && (typeof version !== 'string' || !version || version.length > 200)) error(503, 'The original study bank for this attempt is unavailable.');
  const file = version === null ? path.join(dataDir, CONTENT_FILE) : path.join(dataDir, 'content-archive', `${createHash('sha256').update(version).digest('hex')}.json`);
  let stat;
  try { stat = fs.statSync(file); } catch { error(503, version === null ? 'Practical content has not been imported.' : 'The original study bank for this attempt is unavailable.'); }
  let cached = contentCache.get(file);
  if (!cached || cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
    cached = { value: JSON.parse(fs.readFileSync(file, 'utf8')), mtime: stat.mtimeMs, size: stat.size };
    contentCache.set(file, cached);
    if (contentCache.size > 8) contentCache.delete(contentCache.keys().next().value);
  }
  if (version !== null && cached.value.version !== version) error(503, 'The archived study bank does not match this attempt.');
  return cached.value;
}
function contentForAttempt(dataDir, current, attempt) {
  const version = attempt.contentVersion || attempt.manifestVersion;
  if (typeof version !== 'string' || !version) error(503, 'The original study bank for this attempt is unavailable.');
  const content = version === current.version ? current : getContent(dataDir, version);
  if (attempt.contentSha256 && attempt.contentSha256 !== content.sha256) error(503, 'The study bank changed since this attempt started.');
  return content;
}
function readState(dataDir) {
  return readFileJson(path.join(dataDir, STATE_FILE), { schemaVersion: 1, attempts: {}, learning: {}, archived: {}, activityDates: [] });
}
function saveState(dataDir, state) { writeAtomic(path.join(dataDir, STATE_FILE), state); }
function rateLimit(key, max = 360) {
  const minute = Math.floor(Date.now() / 60000);
  const prior = requestCounters.get(key);
  const count = prior?.minute === minute ? prior.count + 1 : 1;
  requestCounters.set(key, { minute, count });
  if (count > max) error(429, 'Too many study submissions. Please try again shortly.');
  if (requestCounters.size > 1000) for (const [id, value] of requestCounters) if (value.minute < minute) requestCounters.delete(id);
}
function itemMap(content) { return new Map(content.questions.map((item) => [item.id, item])); }
function examMap(content) { return new Map(content.exams.map((exam) => [exam.id, exam])); }
function publicExam(exam, questionsById) {
  const roles = { knowledge: 0, short_interactive: 0, pbq: 0 };
  const domains = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const item of exam.items) { roles[item.role]++; domains[questionsById.get(item.id).domain_id]++; }
  return { id: exam.id, title: exam.title, version: exam.version, durationMinutes: exam.duration_minutes, count: exam.items.length, roles, domains, canonical: exam.canonical !== false, practicalFocus: Boolean(exam.practical_focus) };
}
function stableOrder(values, seed) {
  return [...values].sort((a, b) => {
    const left = createHash('sha256').update(`${seed}:${typeof a === 'string' ? a : a.id}`).digest('hex');
    const right = createHash('sha256').update(`${seed}:${typeof b === 'string' ? b : b.id}`).digest('hex');
    return left.localeCompare(right);
  });
}
function itemForAttempt(item, attempt) {
  const publicItem = publicPracticalItem(item);
  const ui = publicItem.interaction;
  if (Array.isArray(ui.options)) ui.options = stableOrder(ui.options, `${attempt.id}:${item.id}:options`);
  if (ui.type === 'matching') ui.right = stableOrder(ui.right, `${attempt.id}:${item.id}:right`);
  return publicItem;
}
function answerCount(attempt) { return Object.values(attempt.responses || {}).filter((response) => response !== null && response !== undefined && response !== '').length; }
function attemptSummary(attempt) {
  return { id: attempt.id, mode: attempt.mode, title: attempt.title, examId: attempt.examId, manifestVersion: attempt.manifestVersion,
    status: attempt.status, startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt, submittedAt: attempt.submittedAt,
    elapsedSeconds: attempt.elapsedSeconds, itemCount: attempt.questionIds.length, answeredCount: answerCount(attempt),
    flaggedCount: Object.values(attempt.flags || {}).filter(Boolean).length, score: attempt.score || null };
}
function safeAttempt(attempt, content) {
  const byId = itemMap(content);
  return { ...attemptSummary(attempt), questionIds: attempt.questionIds, cursor: attempt.cursor || 0,
    responses: attempt.responses, flags: attempt.flags, timeByItem: attempt.timeByItem || {}, revision: attempt.revision,
    items: attempt.questionIds.map((id) => itemForAttempt(byId.get(id), attempt)),
    feedback: attempt.mode === 'learning' || attempt.status !== 'in_progress' ? attempt.feedback || {} : {},
    results: attempt.status !== 'in_progress' ? attempt.results || {} : undefined };
}
function progressFor(state, id) { return state.learning[id] || { attemptCount: 0, incorrectCount: 0, mastery: 0, lastSeen: null, spacedReviewDue: null, bookmarked: false }; }
function updateLearning(state, id, grade, timestamp) {
  const prior = progressFor(state, id);
  const score = grade.possible ? grade.earned / grade.possible : 0;
  const mastery = Math.round((prior.mastery * Math.min(prior.attemptCount, 4) + score * 100) / (Math.min(prior.attemptCount, 4) + 1));
  const dueDays = score >= 0.99 ? Math.max(2, Math.min(30, Math.round(mastery / 12))) : 1;
  state.learning[id] = { ...prior, attemptCount: prior.attemptCount + 1, incorrectCount: prior.incorrectCount + Number(score < 0.99), mastery,
    lastSeen: timestamp, lastEarned: grade.earned, lastPossible: grade.possible, spacedReviewDue: new Date(Date.parse(timestamp) + dueDays * 86400000).toISOString() };
}
function addActivity(state, timestamp) {
  const day = timestamp.slice(0, 10);
  if (!state.activityDates.includes(day)) state.activityDates.push(day);
  state.activityDates = state.activityDates.slice(-400);
}
function streak(dates) {
  const days = new Set(dates);
  let day = new Date();
  let count = 0;
  if (!days.has(day.toISOString().slice(0, 10))) day = new Date(day.getTime() - 86400000);
  while (days.has(day.toISOString().slice(0, 10))) { count++; day = new Date(day.getTime() - 86400000); }
  return count;
}
function scoreAttempt(attempt, content, state, now) {
  if (attempt.status !== 'in_progress') return attempt;
  const byId = itemMap(content);
  const roleTotals = { knowledge: { earned: 0, possible: 0 }, short_interactive: { earned: 0, possible: 0 }, pbq: { earned: 0, possible: 0 } };
  const domains = {};
  const objectives = {};
  const timeByType = {};
  const results = {};
  for (const id of attempt.questionIds) {
    const item = byId.get(id);
    const key = content.answerKeys[id];
    const result = gradePractical(item, key, attempt.responses[id] ?? null);
    results[id] = result;
    const role = attempt.roles[id];
    roleTotals[role].earned += result.earned;
    roleTotals[role].possible += result.possible;
    const domain = String(item.domain_id);
    const objective = String(item.objective_id || 'unspecified');
    domains[domain] ||= { earned: 0, possible: 0 };
    objectives[objective] ||= { earned: 0, possible: 0 };
    domains[domain].earned += result.earned; domains[domain].possible += result.possible;
    objectives[objective].earned += result.earned; objectives[objective].possible += result.possible;
    timeByType[item.interaction.type] = (timeByType[item.interaction.type] || 0) + (attempt.timeByItem?.[id] || 0);
    if (attempt.responses[id] !== undefined && attempt.responses[id] !== null && !attempt.checkedIds?.[id]) updateLearning(state, id, result, now);
  }
  const earned = Object.values(roleTotals).reduce((sum, bucket) => sum + bucket.earned, 0);
  const possible = Object.values(roleTotals).reduce((sum, bucket) => sum + bucket.possible, 0);
  attempt.status = now >= attempt.deadlineAt && attempt.deadlineAt ? 'timed_out' : 'completed';
  attempt.submittedAt = now;
  attempt.elapsedSeconds = Math.max(0, Math.round((Date.parse(now) - Date.parse(attempt.startedAt)) / 1000));
  attempt.results = results;
  attempt.score = { earned: Math.round(earned * 100) / 100, possible, percent: possible ? Math.round(earned / possible * 100) : 0, roles: roleTotals, domains, objectives, timeByType };
  addActivity(state, now);
  return attempt;
}
function currentAttempt(state, id, owner) {
  const attempt = state.attempts[id];
  if (!attempt || attempt.owner !== owner) error(404, 'Attempt not found.');
  return attempt;
}
function maybeExpire(state, attempt, content, dataDir) {
  if (attempt.status === 'in_progress' && attempt.deadlineAt && Date.now() >= Date.parse(attempt.deadlineAt)) {
    scoreAttempt(attempt, content, state, new Date().toISOString());
    saveState(dataDir, state);
  }
}
function selectQuestions(content, state, input) {
  const byId = itemMap(content);
  if (Array.isArray(input.ids)) {
    if (!input.ids.length || input.ids.length > MAX_ATTEMPT_ITEMS || new Set(input.ids).size !== input.ids.length || input.ids.some((id) => !byId.has(id))) error(400, 'Choose valid distinct question IDs.');
    return input.ids.map((id) => byId.get(id));
  }
  const types = Array.isArray(input.interactionTypes) ? input.interactionTypes.filter((type) => typeof type === 'string').slice(0, 12) : [];
  const topics = Array.isArray(input.topics) ? input.topics.filter((topic) => typeof topic === 'string').slice(0, 30) : [];
  const category = input.category && content.drills.categories?.[input.category];
  if (input.category && !category) error(400, 'Unknown practice category.');
  const categoryIds = category ? new Set(category.question_ids) : null;
  const recent = new Set(Object.entries(state.learning).sort((a, b) => String(b[1].lastSeen).localeCompare(String(a[1].lastSeen))).slice(0, 100).map(([id]) => id));
  let candidates = content.questions.filter((item) =>
    (!categoryIds || categoryIds.has(item.id)) &&
    (!input.domain || String(item.domain_id) === String(input.domain)) &&
    (!input.objective || item.objective_id === input.objective) &&
    (!input.topic || item.topic === input.topic) &&
    (!topics.length || topics.includes(item.topic)) &&
    (!input.difficulty || item.difficulty === input.difficulty) &&
    (!types.length || types.includes(item.interaction.type)) &&
    (!input.bookmarkedOnly || progressFor(state, item.id).bookmarked) &&
    (!input.wrongOnly || progressFor(state, item.id).incorrectCount > 0) &&
    (!input.excludeRecentlySeen || !recent.has(item.id)));
  if (input.mcqOnly) candidates = candidates.filter((item) => item.question_kind === 'multiple_choice' && ['single_select', 'multi_select'].includes(item.interaction.type));
  if (input.pbqOnly) candidates = candidates.filter((item) => item.question_kind === 'pbq' || item.question_kind === 'legacy_pbq');
  if (!candidates.length) error(400, 'No questions match those practice filters.');
  const count = Number(input.count || 10);
  if (!Number.isInteger(count) || count < 1 || count > MAX_ATTEMPT_ITEMS) error(400, 'Choose 1–90 questions.');
  candidates.sort((a, b) => {
    const pa = progressFor(state, a.id); const pb = progressFor(state, b.id);
    return Number(pa.attemptCount > 0) - Number(pb.attemptCount > 0) || pa.mastery - pb.mastery || String(pa.lastSeen || '').localeCompare(String(pb.lastSeen || '')) || a.id.localeCompare(b.id);
  });
  // Spread selected items across formats unless the learner chose a specific type.
  if (!input.mcqOnly && !input.pbqOnly && !types.length) {
    if (input.mix && !['balanced', 'practical', 'knowledge'].includes(input.mix)) error(400, 'Unknown practice mix.');
    const ratio = input.mix === 'practical' ? [0.4, 0.35, 0.25] : input.mix === 'knowledge' ? [0.8, 0.15, 0.05] : [0.6, 0.25, 0.15];
    const knowledge = candidates.filter((item) => item.question_kind === 'multiple_choice');
    const short = candidates.filter((item) => item.question_kind === 'interactive');
    const pbqs = candidates.filter((item) => item.question_kind === 'pbq' || item.question_kind === 'legacy_pbq');
    const chosen = [...knowledge.slice(0, Math.round(count * ratio[0])), ...short.slice(0, Math.round(count * ratio[1])), ...pbqs.slice(0, Math.round(count * ratio[2]))];
    const used = new Set(chosen.map((item) => item.id));
    return [...chosen, ...candidates.filter((item) => !used.has(item.id))].slice(0, count);
  }
  return candidates.slice(0, count);
}
function historyList(state) { return Object.values(state.archived || {}).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))); }
function publicMeta(item) { return { id: item.id, origin: item.origin, domainId: item.domain_id, objectiveId: item.objective_id, topic: item.topic, difficulty: item.difficulty, questionKind: item.question_kind, interactionType: item.interaction.type, points: item.points, prompt: item.prompt }; }
function routeId(pathname) { return /^\/api\/practical\/attempts\/([0-9a-f-]{36})(?:\/(answer|draft|check|submit))?$/.exec(pathname); }

async function handlePracticalApiLocked(req, res, pathname, { dataDir, owner, send, bodyBytes }) {
  try {
    let content = getContent(dataDir);
    const state = readState(dataDir);
    if (pathname === '/api/practical/overview' && req.method === 'GET') {
      const old = readFileJson(path.join(dataDir, 'progress.json'), { answers: {}, pbqs: {} });
      const attempts = Object.values(state.attempts).filter((item) => item.owner === owner).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      for (const attempt of attempts) {
        if (attempt.status === 'in_progress' && attempt.deadlineAt && Date.now() >= Date.parse(attempt.deadlineAt)) maybeExpire(state, attempt, contentForAttempt(dataDir, content, attempt), dataDir);
      }
      return send(res, 200, { version: content.version, counts: content.counts, exams: content.exams.map((exam) => publicExam(exam, itemMap(content))),
        categories: Object.fromEntries(Object.entries(content.drills.categories).map(([id, category]) => [id, { title: category.title, count: category.question_ids.length }])),
        topics: [...new Set(content.questions.map((item) => item.topic))].sort(),
        objectives: [...new Set(content.questions.map((item) => item.objective_id).filter(Boolean))].sort(),
        metadata: content.questions.map(publicMeta),
        attempts: attempts.map(attemptSummary), archived: historyList(state), learning: state.learning,
        flaggedIds: [...new Set(attempts.flatMap((attempt) => Object.entries(attempt.flags || {}).filter(([, flagged]) => flagged).map(([id]) => id)))],
        streak: streak(state.activityDates), activityDates: state.activityDates,
        legacy: { answered: Object.keys(old.answers || {}).length, pbqsCompleted: Object.values(old.pbqs || {}).filter((item) => item.submitted).length } });
    }
    if (pathname === '/api/practical/attempts' && req.method === 'POST') {
      const input = parseBody(await bodyBytes(req, API_LIMIT));
      const mode = input.mode === 'exam' ? 'exam' : input.mode === 'timed' ? 'timed' : 'learning';
      let selected, title, examId = null, version = content.version, limitMinutes = null;
      if (mode === 'exam') {
        const exam = examMap(content).get(input.examId);
        if (!exam) error(404, 'Practice exam not found.');
        const existing = Object.values(state.attempts).find((attempt) => attempt.owner === owner && attempt.examId === exam.id && attempt.status === 'in_progress');
        if (existing && !input.newAttempt) {
          const original = contentForAttempt(dataDir, content, existing);
          maybeExpire(state, existing, original, dataDir);
          if (existing.status === 'in_progress') return send(res, 200, { attempt: safeAttempt(existing, original) });
        }
        selected = exam.items.map((entry) => ({ item: itemMap(content).get(entry.id), role: entry.role }));
        title = exam.title; examId = exam.id; version = exam.version; limitMinutes = exam.duration_minutes;
      } else {
        selected = selectQuestions(content, state, input).map((item) => ({ item, role: item.question_kind === 'multiple_choice' ? 'knowledge' : item.question_kind === 'pbq' || item.question_kind === 'legacy_pbq' ? 'pbq' : 'short_interactive' }));
        title = typeof input.title === 'string' && input.title.length <= 80 ? input.title : mode === 'timed' ? 'Timed practice' : 'Practice by skill';
        if (mode === 'timed') limitMinutes = Math.min(90, Math.max(5, Number(input.timeLimitMinutes) || 30));
      }
      const now = new Date();
      const id = randomUUID();
      const attempt = { id, owner, mode, title, examId, manifestVersion: version, contentVersion: content.version, contentSha256: content.sha256, status: 'in_progress',
        startedAt: now.toISOString(), deadlineAt: limitMinutes ? new Date(now.getTime() + limitMinutes * 60000).toISOString() : null,
        submittedAt: null, elapsedSeconds: null, questionIds: selected.map((entry) => entry.item.id),
        roles: Object.fromEntries(selected.map((entry) => [entry.item.id, entry.role])), responses: {}, flags: {}, cursor: 0,
        revision: 0, questionRevisions: {}, checkedIds: {}, feedback: {}, timeByItem: {}, results: null, score: null };
      state.attempts[id] = attempt; saveState(dataDir, state);
      return send(res, 201, { attempt: safeAttempt(attempt, content) });
    }
    const match = routeId(pathname);
    if (match) {
      const [, id, action] = match;
      const attempt = currentAttempt(state, id, owner);
      content = contentForAttempt(dataDir, content, attempt);
      maybeExpire(state, attempt, content, dataDir);
      if (!action && req.method === 'GET') return send(res, 200, { attempt: safeAttempt(attempt, content) });
      if (action === 'draft' && req.method === 'PUT') {
        rateLimit(`${owner}:draft:${attempt.id}`);
        if (attempt.status !== 'in_progress') error(409, 'This attempt has already finished; the browser draft has been kept.');
        const input = parseBody(await bodyBytes(req, API_LIMIT));
        if (!Number.isInteger(input.baseRevision) || input.baseRevision !== attempt.revision) error(409, 'Another tab changed this attempt. Reconcile the browser draft before saving.');
        if (!input.responses || typeof input.responses !== 'object' || Array.isArray(input.responses) || !input.flags || typeof input.flags !== 'object' || Array.isArray(input.flags)) error(400, 'Invalid draft.');
        const byId = itemMap(content);
        const validId = (id) => attempt.questionIds.includes(id);
        const nextResponses = {};
        for (const [id, response] of Object.entries(input.responses)) {
          if (!validId(id)) error(400, 'Unknown question in draft.');
          const clean = sanitizeResponse(byId.get(id), response);
          if (clean !== null) nextResponses[id] = clean;
        }
        const nextFlags = {};
        for (const [id, flagged] of Object.entries(input.flags)) {
          if (!validId(id) || typeof flagged !== 'boolean') error(400, 'Invalid review marker.');
          nextFlags[id] = flagged;
        }
        if (!Number.isInteger(input.cursor) || input.cursor < 0 || input.cursor >= attempt.questionIds.length) error(400, 'Invalid question position.');
        const times = {};
        for (const [id, seconds] of Object.entries(input.timeByItem || {})) {
          if (!validId(id) || !Number.isFinite(seconds) || seconds < 0 || seconds > 1800) error(400, 'Invalid time on question.');
          times[id] = Math.max(attempt.timeByItem?.[id] || 0, seconds);
        }
        // Validate the complete snapshot first: a failed save cannot partially discard answers.
        attempt.responses = nextResponses; attempt.flags = nextFlags; attempt.cursor = input.cursor;
        attempt.timeByItem = { ...attempt.timeByItem, ...times };
        attempt.revision++; attempt.questionRevisions = Object.fromEntries(attempt.questionIds.map((id) => [id, attempt.revision]));
        attempt.updatedAt = new Date().toISOString(); saveState(dataDir, state);
        return send(res, 200, { ok: true, revision: attempt.revision, answeredCount: answerCount(attempt) });
      }
      if (action === 'answer' && req.method === 'PUT') {
        rateLimit(`${owner}:answer:${attempt.id}`);
        if (attempt.status !== 'in_progress') error(409, 'This attempt has already finished.');
        const input = parseBody(await bodyBytes(req, API_LIMIT));
        const index = attempt.questionIds.indexOf(input.questionId);
        if (index < 0) error(400, 'Question is not in this attempt.');
        const item = itemMap(content).get(input.questionId);
        const response = sanitizeResponse(item, input.response);
        if (input.baseRevision !== undefined) {
          const base = Number(input.baseRevision);
          if (!Number.isInteger(base) || base < 0 || base > attempt.revision) error(400, 'Invalid attempt revision.');
          if (base < (attempt.questionRevisions?.[item.id] || 0)) error(409, 'Another tab changed this answer. Refresh to reconcile your saved browser draft.');
        }
        const flagged = input.flagged === undefined ? Boolean(attempt.flags[item.id]) : input.flagged === true;
        const cursor = input.cursor === undefined ? attempt.cursor : Number(input.cursor);
        if (!Number.isInteger(cursor) || cursor < 0 || cursor >= attempt.questionIds.length) error(400, 'Invalid question position.');
        const elapsedSeconds = input.elapsedSeconds === undefined ? attempt.timeByItem?.[item.id] || 0 : Number(input.elapsedSeconds);
        if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 1800) error(400, 'Invalid time on question.');
        const changed = JSON.stringify(attempt.responses[item.id] ?? null) !== JSON.stringify(response) || Boolean(attempt.flags[item.id]) !== flagged || attempt.cursor !== cursor || (attempt.timeByItem?.[item.id] || 0) < elapsedSeconds;
        if (changed) {
          if (response === null) delete attempt.responses[item.id]; else attempt.responses[item.id] = response;
          attempt.flags[item.id] = flagged; attempt.cursor = cursor; attempt.revision++;
          attempt.questionRevisions ||= {}; attempt.questionRevisions[item.id] = attempt.revision;
          attempt.timeByItem ||= {}; attempt.timeByItem[item.id] = Math.max(attempt.timeByItem[item.id] || 0, elapsedSeconds);
          attempt.updatedAt = new Date().toISOString(); saveState(dataDir, state);
        }
        return send(res, 200, { ok: true, revision: attempt.revision, answeredCount: answerCount(attempt) });
      }
      if (action === 'check' && req.method === 'POST') {
        rateLimit(`${owner}:check`, 120);
        if (attempt.mode !== 'learning' || attempt.status !== 'in_progress') error(403, 'Feedback is available after submission for timed attempts.');
        const input = parseBody(await bodyBytes(req, API_LIMIT));
        if (!attempt.questionIds.includes(input.questionId)) error(400, 'Question is not in this attempt.');
        const item = itemMap(content).get(input.questionId);
        const response = sanitizeResponse(item, input.response);
        if (response === null) error(400, 'Enter an answer before checking.');
        const token = input.requestId;
        if (token !== undefined && (typeof token !== 'string' || token.length > 120)) error(400, 'Invalid request ID.');
        if (token && attempt.lastChecks?.[item.id]?.requestId === token) {
          if (JSON.stringify(attempt.lastChecks[item.id].response) !== JSON.stringify(response)) error(409, 'Request ID was already used with another answer.');
          return send(res, 200, { feedback: attempt.lastChecks[item.id].grade, retry: true, revision: attempt.revision });
        }
        if (input.baseRevision !== undefined) {
          const base = Number(input.baseRevision);
          if (!Number.isInteger(base) || base < 0 || base > attempt.revision) error(400, 'Invalid attempt revision.');
          if (base < (attempt.questionRevisions?.[item.id] || 0)) error(409, 'Another tab changed this answer. Refresh to reconcile your saved browser draft.');
        }
        const grade = gradePractical(item, content.answerKeys[item.id], response);
        const now = new Date().toISOString();
        attempt.responses[item.id] = response;
        attempt.feedback[item.id] = grade;
        attempt.checkedIds[item.id] = true;
        attempt.lastChecks ||= {};
        attempt.lastChecks[item.id] = { requestId: token || null, response, grade };
        attempt.revision++; attempt.questionRevisions ||= {}; attempt.questionRevisions[item.id] = attempt.revision;
        updateLearning(state, item.id, grade, now); addActivity(state, now);
        saveState(dataDir, state);
        return send(res, 200, { feedback: grade, retry: false, revision: attempt.revision });
      }
      if (action === 'submit' && req.method === 'POST') {
        rateLimit(`${owner}:submit:${attempt.id}`, 30);
        const bytes = await bodyBytes(req, 1024);
        const input = bytes.length ? parseBody(bytes) : {};
        if (attempt.status === 'in_progress' && input.baseRevision !== undefined && input.baseRevision !== attempt.revision) error(409, 'Another tab changed this attempt before submission. Your browser draft is kept.');
        scoreAttempt(attempt, content, state, new Date().toISOString()); saveState(dataDir, state);
        return send(res, 200, { attempt: safeAttempt(attempt, content) });
      }
    }
    if (pathname === '/api/practical/simulate' && req.method === 'POST') {
      rateLimit(`${owner}:simulate`, 90);
      const input = parseBody(await bodyBytes(req, 2048));
      const attempt = currentAttempt(state, input.attemptId, owner);
      content = contentForAttempt(dataDir, content, attempt);
      maybeExpire(state, attempt, content, dataDir);
      if (attempt.status !== 'in_progress' || !attempt.questionIds.includes(input.questionId)) error(403, 'Simulator is unavailable for this item.');
      const item = itemMap(content).get(input.questionId);
      return send(res, 200, simulateCli(item, content.answerKeys[item.id], input.command));
    }
    if (pathname === '/api/practical/firewall/test' && req.method === 'POST') {
      rateLimit(`${owner}:firewall`, 120);
      const input = parseBody(await bodyBytes(req, 8192));
      const attempt = currentAttempt(state, input.attemptId, owner);
      content = contentForAttempt(dataDir, content, attempt);
      maybeExpire(state, attempt, content, dataDir);
      if (attempt.status !== 'in_progress' || !attempt.questionIds.includes(input.questionId)) error(403, 'Firewall test is unavailable for this item.');
      const item = itemMap(content).get(input.questionId);
      if (item.interaction.type !== 'firewall_rules') error(400, 'This is not a firewall item.');
      const rules = validateFirewallRules(input.rules, item.interaction.max_user_rules || 5);
      const flow = input.flow;
      if (!flow || !['tcp', 'udp'].includes(flow.proto) || !Number.isInteger(flow.port) || flow.port < 1 || flow.port > 65535) error(400, 'Invalid test traffic.');
      parseIpv4(flow.src); parseIpv4(flow.dst);
      return send(res, 200, { decision: firewallDecision(rules, flow) ? 'allow' : 'deny', simulated: true });
    }
    if (pathname === '/api/practical/bookmark' && req.method === 'POST') {
      const input = parseBody(await bodyBytes(req, 2048));
      if (!itemMap(content).has(input.questionId) || typeof input.bookmarked !== 'boolean') error(400, 'Invalid bookmark.');
      state.learning[input.questionId] = { ...progressFor(state, input.questionId), bookmarked: input.bookmarked };
      saveState(dataDir, state); return send(res, 200, { bookmarked: input.bookmarked });
    }
    if (pathname === '/api/practical/archive' && req.method === 'POST') {
      const input = parseBody(await bodyBytes(req, API_LIMIT));
      if (!Array.isArray(input.sessions) || input.sessions.length > 80) error(400, 'Invalid archived sessions.');
      const byId = itemMap(content);
      for (const raw of input.sessions) {
        if (!raw || typeof raw.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(raw.id) || !Array.isArray(raw.questionIds) || raw.questionIds.length > 100 || raw.questionIds.some((id) => !byId.has(id))) continue;
        const started = Number(raw.startedAt);
        if (!Number.isFinite(started) || started < 0 || started > Date.now() + 86400000) continue;
        state.archived[raw.id] = { id: raw.id, title: 'Archived practice attempt', startedAt: new Date(started).toISOString(),
          questionIds: raw.questionIds, answeredCount: Math.max(0, Math.min(raw.questionIds.length, Number(raw.answeredCount) || 0)),
          correctCount: Math.max(0, Math.min(raw.questionIds.length, Number(raw.correctCount) || 0)), completed: raw.done === true,
          linkedPbqIds: Array.isArray(raw.pbqIds) ? raw.pbqIds.filter((id) => byId.has(id)).slice(0, 5) : [] };
      }
      saveState(dataDir, state); return send(res, 200, { archived: Object.keys(state.archived).length });
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (err) {
    return send(res, err.status || 500, { error: err.status ? err.message : 'Study request failed.' });
  }
}

// Serialize read/modify/write cycles. Concurrent autosaves and browser tabs must
// never write an older whole-state snapshot over a newer answer.
export async function handlePracticalApi(req, res, pathname, context) {
  const key = context.dataDir;
  const previous = stateQueues.get(key) || Promise.resolve();
  const running = previous.then(() => handlePracticalApiLocked(req, res, pathname, context));
  const settled = running.catch(() => {});
  stateQueues.set(key, settled);
  try { return await running; }
  finally { if (stateQueues.get(key) === settled) stateQueues.delete(key); }
}
