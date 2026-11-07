import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

export const PRACTICAL_VERSION = 'sy701-study-2026-11-07';
const PREFIX = 'security_plus_practical_expansion/';
const ID_PATTERN = /^(SEC(?:2)?-Q\d{3}|SEC(?:2)?-PBQ-\d{3}|SPX-[A-Z0-9_-]+)$/;

function assert(condition, message) { if (!condition) throw new Error(message); }
function parseJson(bytes, filename) {
  assert(bytes && bytes.length < 12_000_000, `Missing or oversized ${filename}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}
function parseJsonl(bytes, filename) {
  assert(bytes && bytes.length < 12_000_000, `Missing or oversized ${filename}`);
  return new TextDecoder().decode(bytes).trim().split('\n').map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid ${filename} line ${index + 1}`); }
  });
}
function uniqueIds(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    assert(typeof row.id === 'string' && ID_PATTERN.test(row.id), `Invalid ${label} ID`);
    assert(!ids.has(row.id), `Duplicate ${label} ID: ${row.id}`);
    ids.add(row.id);
  }
  return ids;
}
function publicLegacyPbq(pbq) {
  const keys = new Map(pbq.answer_key.map((entry) => [entry.task_id, entry]));
  const tasks = pbq.tasks.map((task) => ({ ...task, selectCount: task.response_type === 'multi_select' ? keys.get(task.id)?.correct_response?.length : undefined }));
  return {
    id: pbq.id, exam_code: 'SY0-701', origin: 'legacy-pbq-v1', domain_id: pbq.primary_domain,
    domain_name: '', objective_id: pbq.objective_ids[0] || '', topic: 'legacy_pbq',
    difficulty: pbq.difficulty, question_kind: 'legacy_pbq', suggested_seconds: pbq.time_minutes * 60,
    points: pbq.max_points, prompt: pbq.title,
    stimulus: { scenario_md: pbq.scenario_md, exhibits: pbq.exhibits },
    interaction: { type: 'legacy_pbq', tasks, max_points: pbq.max_points },
  };
}

export function parsePracticalPackage(buffer, existingLibrary = null) {
  assert(buffer.length <= 30_000_000, 'Package is too large.');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const files = unzipSync(new Uint8Array(buffer));
  assert(Object.keys(files).length <= 60, 'Unexpected package file count.');
  assert(Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) < 50_000_000, 'Expanded package is too large.');
  const get = (name) => files[PREFIX + name];
  const manifest = parseJson(get('PACKAGE_MANIFEST.json'), 'PACKAGE_MANIFEST.json');
  const knowledge = parseJsonl(get('bank/knowledge_public.jsonl'), 'knowledge_public.jsonl');
  const knowledgeKeys = parseJsonl(get('answer_keys/knowledge_private.jsonl'), 'knowledge_private.jsonl');
  const interactive = parseJsonl(get('bank/interactive_public.jsonl'), 'interactive_public.jsonl');
  const interactiveKeys = parseJsonl(get('answer_keys/interactive_private.jsonl'), 'interactive_private.jsonl');
  const legacy = parseJson(get('legacy/legacy_pbqs_private_import.json'), 'legacy_pbqs_private_import.json').pbqs;
  const catalog = parseJson(get('exams/exam_catalog.json'), 'exam_catalog.json');
  const drills = parseJson(get('bank/drill_catalog.json'), 'drill_catalog.json');
  assert(knowledge.length === 857 && interactive.length === 639 && legacy.length === 50, 'Content count mismatch.');
  assert(knowledgeKeys.length === knowledge.length && interactiveKeys.length === interactive.length, 'Answer key count mismatch.');
  assert(knowledge.filter((item) => item.origin?.startsWith('legacy-')).length === 600, 'Original MCQ count mismatch.');
  assert(knowledge.filter((item) => !item.origin?.startsWith('legacy-')).length === 257, 'New MCQ count mismatch.');
  assert(manifest.total_multiple_choice === 857 && manifest.new_interactive === 639 && manifest.exam_count === 10, 'Package manifest count mismatch.');
  const publicLegacy = legacy.map(publicLegacyPbq);
  const questions = [...knowledge, ...interactive, ...publicLegacy];
  const allIds = uniqueIds(questions, 'question');
  for (const item of questions) {
    assert(typeof item.prompt === 'string' && item.prompt.length > 0 && Number.isFinite(item.points) && item.points > 0, `Invalid question: ${item.id}`);
    assert(typeof item.interaction?.type === 'string', `Missing interaction type: ${item.id}`);
    if (item.origin !== 'legacy-pbq-v1') assert(!JSON.stringify(item).match(/"(?:answer|answer_key|correctIds|correct_response|solution_rules)"\s*:/), `Answer field in public item: ${item.id}`);
  }
  if (existingLibrary?.sets?.length) {
    const originalQuestions = existingLibrary.sets.flatMap((set) => set.questions || []).map((item) => item.id);
    const originalPbqs = existingLibrary.sets.flatMap((set) => set.pbqs || []).map((item) => item.id);
    assert(originalQuestions.length >= 600 && originalPbqs.length >= 50, 'Existing original bank is incomplete.');
    assert(originalQuestions.every((id) => allIds.has(id)) && originalPbqs.every((id) => allIds.has(id)), 'A historic question ID is missing from the new bank.');
  }
  const keys = [...knowledgeKeys, ...interactiveKeys, ...legacy.map((pbq) => ({ id: pbq.id, points: pbq.max_points, grader: 'legacy_pbq', answer_key: pbq.answer_key }))];
  assert(uniqueIds(keys, 'answer key').size === allIds.size && keys.every((key) => allIds.has(key.id)), 'Answer key IDs do not match question IDs.');
  assert(Array.isArray(catalog.exams) && catalog.exams.length === 10, 'Expected ten exams.');
  const exams = [];
  const used = new Set();
  for (let index = 1; index <= 10; index++) {
    const catalogEntry = catalog.exams[index - 1];
    const exam = parseJson(get(`exams/exam_${String(index).padStart(2, '0')}.json`), `exam_${index}.json`);
    assert(exam.id === catalogEntry.id && exam.title === `Practice Exam ${String(index).padStart(2, '0')}` && exam.duration_minutes === 90, `Invalid exam ${index}.`);
    assert(exam.items.length === 90 && exam.composition.multiple_choice === 70 && exam.composition.short_interactive === 15 && exam.composition.complex_pbq === 5, `Exam ${index} composition mismatch.`);
    const roles = { knowledge: 0, short_interactive: 0, pbq: 0 };
    const domains = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byId = new Map(questions.map((question) => [question.id, question]));
    for (const entry of exam.items) {
      assert(allIds.has(entry.id) && !used.has(entry.id) && entry.role in roles, `Exam ${index} has a missing or repeated item: ${entry.id}`);
      used.add(entry.id); roles[entry.role]++; domains[byId.get(entry.id).domain_id]++;
    }
    assert(roles.knowledge === 70 && roles.short_interactive === 15 && roles.pbq === 5, `Exam ${index} roles mismatch.`);
    assert([1, 2, 3, 4, 5].every((domain) => domains[domain] === exam.blueprint?.domain_target_counts?.[domain]), `Exam ${index} domain counts mismatch.`);
    exams.push({ ...exam, version: PRACTICAL_VERSION });
  }
  assert(used.size === 900, 'Cross-exam assignments are not unique.');
  for (const category of Object.values(drills.categories || {})) assert(category.question_ids.every((id) => allIds.has(id)), 'Drill catalog references a missing question.');
  // Freeze additional coverage from the full bank at import time. The ten supplied manifests remain unchanged.
  const remaining = questions.filter((item) => !used.has(item.id)).sort((a, b) => {
    const ha = createHash('sha256').update(`${PRACTICAL_VERSION}:${a.id}`).digest('hex');
    const hb = createHash('sha256').update(`${PRACTICAL_VERSION}:${b.id}`).digest('hex');
    return ha.localeCompare(hb);
  });
  assert(remaining.length === 646, 'Remaining corpus count mismatch.');
  for (let extra = 0; extra < 8; extra++) {
    const batch = remaining.slice(extra * 90, (extra + 1) * 90);
    const full = extra < 7;
    assert(batch.length === (full ? 90 : 16), 'Extra assessment allocation mismatch.');
    const title = full ? `Practice Exam ${String(extra + 11).padStart(2, '0')}` : 'Coverage Challenge';
    const id = full ? `SY701-PRACTICE-${String(extra + 11).padStart(2, '0')}` : 'SY701-COVERAGE-CHALLENGE';
    const items = batch.map((item) => ({ id: item.id, role: item.question_kind === 'multiple_choice' ? 'knowledge' : item.question_kind === 'pbq' || item.question_kind === 'legacy_pbq' ? 'pbq' : 'short_interactive' }))
      .sort((a, b) => Number(b.role === 'pbq') - Number(a.role === 'pbq'));
    for (const entry of items) { assert(!used.has(entry.id), 'Extra assessment duplicates a prior item.'); used.add(entry.id); }
    exams.push({ schema_version: 'securityplus.coverage.exam.v1', id, title, exam_code: 'SY0-701', duration_minutes: full ? 90 : 25, question_count: items.length, version: PRACTICAL_VERSION, canonical: false, practical_focus: true, items });
  }
  assert(used.size === allIds.size, 'Not all corpus items are allocated to assessments.');
  const keyMap = Object.fromEntries(keys.map((key) => [key.id, key]));
  return { schemaVersion: 1, version: PRACTICAL_VERSION, sha256, importedAt: new Date().toISOString(), counts: { legacyMcq: 600, newMcq: 257, interactive: 639, legacyPbq: 50, canonicalExams: 10, extraExams: 7, coverageChallenges: 1, uniquePlacements: 1546 }, questions, answerKeys: keyMap, exams, drills };
}

export function writePracticalPackage(dataDir, bundle, { upgrade = false } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, 'practical-content.json');
  if (fs.existsSync(target)) {
    const prior = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (prior.sha256 === bundle.sha256) return { changed: false, path: target, counts: prior.counts };
    assert(upgrade && prior.version !== bundle.version, 'Different content already exists at this version; use a new content version and explicit upgrade.');
  }
  const temp = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(bundle)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
  return { changed: true, path: target, counts: bundle.counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const zipPath = process.argv[2];
  const dataDir = process.argv[3] || process.env.STUDY_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
  if (!zipPath) { process.stderr.write('Usage: node practical-import.mjs PACKAGE.zip DATA_DIR [--dry-run]\n'); process.exit(2); }
  const libraryPath = path.join(dataDir, 'library.json');
  const existingLibrary = fs.existsSync(libraryPath) ? JSON.parse(fs.readFileSync(libraryPath, 'utf8')) : null;
  const bundle = parsePracticalPackage(fs.readFileSync(zipPath), existingLibrary);
  const result = process.argv.includes('--dry-run') ? { changed: false, dryRun: true, counts: bundle.counts } : writePracticalPackage(dataDir, bundle);
  process.stdout.write(JSON.stringify({ ...result, version: bundle.version, sha256: bundle.sha256 }) + '\n');
}
