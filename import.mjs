import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { unzipSync } from 'fflate';

const MAX_FILES = 100;
const MAX_UNPACKED = 60 * 1024 * 1024;
const MAX_QUESTIONS = 20000;

function unzipLimited(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expected = [];
  let declaredSize = 0;
  unzipSync(bytes, { filter: (entry) => {
    declaredSize += entry.originalSize;
    if (expected.length >= MAX_FILES || declaredSize > MAX_UNPACKED) throw new Error('The ZIP contains too many or too-large files.');
    expected.push(entry);
    return false;
  } });
  const invalid = () => new Error('Invalid ZIP directory.');
  const tooLarge = () => new Error('The ZIP contains too many or too-large files.');
  const u16 = (offset) => { if (offset < 0 || offset + 2 > bytes.length) throw invalid(); return view.getUint16(offset, true); };
  const u32 = (offset) => { if (offset < 0 || offset + 4 > bytes.length) throw invalid(); return view.getUint32(offset, true); };
  const u64 = (offset) => {
    if (offset < 0 || offset + 8 > bytes.length) throw invalid();
    const value = Number(view.getBigUint64(offset, true));
    if (!Number.isSafeInteger(value)) throw invalid();
    return value;
  };
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw invalid();
  let entryCount = u16(end + 10);
  let directoryOffset = u32(end + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    if (u32(end - 20) !== 0x07064b50) throw invalid();
    const zip64End = u64(end - 12);
    if (u32(zip64End) !== 0x06064b50) throw invalid();
    entryCount = u64(zip64End + 32);
    directoryOffset = u64(zip64End + 48);
  }
  if (entryCount !== expected.length || directoryOffset > bytes.length) throw invalid();
  const unpacked = Object.create(null);
  let actualSize = 0;
  let directory = directoryOffset;
  for (const entry of expected) {
    if (u32(directory) !== 0x02014b50) throw invalid();
    const flags = u16(directory + 8);
    const method = u16(directory + 10);
    let compressedSize = u32(directory + 20);
    let originalSize = u32(directory + 24);
    const nameLength = u16(directory + 28);
    const extraLength = u16(directory + 30);
    const commentLength = u16(directory + 32);
    let localOffset = u32(directory + 42);
    const name = bytes.subarray(directory + 46, directory + 46 + nameLength);
    const extra = directory + 46 + nameLength;
    const next = extra + extraLength + commentLength;
    if (next > bytes.length || (flags & 1)) throw invalid();
    if ([compressedSize, originalSize, localOffset].includes(0xffffffff)) {
      let zip64 = extra;
      while (zip64 + 4 <= extra + extraLength && u16(zip64) !== 1) zip64 += 4 + u16(zip64 + 2);
      if (zip64 + 4 > extra + extraLength) throw invalid();
      const zip64End = zip64 + 4 + u16(zip64 + 2);
      if (zip64End > extra + extraLength) throw invalid();
      let cursor = zip64 + 4;
      if (originalSize === 0xffffffff) { if (cursor + 8 > zip64End) throw invalid(); originalSize = u64(cursor); cursor += 8; }
      if (compressedSize === 0xffffffff) { if (cursor + 8 > zip64End) throw invalid(); compressedSize = u64(cursor); cursor += 8; }
      if (localOffset === 0xffffffff) { if (cursor + 8 > zip64End) throw invalid(); localOffset = u64(cursor); }
    }
    if (originalSize !== entry.originalSize || compressedSize !== entry.size || method !== entry.compression || u32(localOffset) !== 0x04034b50 || u16(localOffset + 8) !== method) throw invalid();
    const localNameLength = u16(localOffset + 26);
    const localExtraLength = u16(localOffset + 28);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (localNameLength !== nameLength || localName.some((byte, index) => byte !== name[index])) throw invalid();
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > bytes.length) throw invalid();
    directory = next;
    if (!/\.(csv|json|md)$/i.test(entry.name) || entry.name.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')) continue;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const remaining = MAX_UNPACKED - actualSize;
    let output;
    if (method === 0) output = compressed;
    else if (method === 8) {
      try { output = inflateRawSync(compressed, { maxOutputLength: remaining + 1 }); }
      catch (error) { if (error.code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge(); throw error; }
    } else throw invalid();
    actualSize += output.length;
    if (actualSize > MAX_UNPACKED) throw tooLarge();
    if (output.length !== originalSize) throw invalid();
    unpacked[entry.name] = output;
  }
  return unpacked;
}

function first(row, keys) {
  for (const key of keys) {
    const found = Object.keys(row).find((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '') === key);
    if (found && String(row[found] ?? '').trim()) return row[found];
  }
  return '';
}

function clean(value, limit = 10000) {
  return String(value ?? '').trim().slice(0, limit);
}

function normalize(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const question = clean(first(row, ['question', 'questiontext', 'prompt', 'stem']), 8000);
  let options = Array.isArray(row.options) ? row.options.map((item) => clean(typeof item === 'object' ? item.text ?? item.label : item, 2000)) : [];
  if (!options.length) {
    options = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((letter) => clean(first(row, [`option${letter}`, `choice${letter}`, `answer${letter}`]), 2000)).filter(Boolean);
  }
  if (!question || options.length < 2) return null;
  const rawCorrect = clean(first(row, ['correctoption', 'correctchoice', 'correct', 'answerkey', 'correctanswer', 'answer']), 2000);
  let correctIndex = -1;
  const exactOption = options.findIndex((option) => option.toLowerCase() === rawCorrect.toLowerCase());
  if (exactOption !== -1) correctIndex = exactOption;
  else if (/^[A-H]$/i.test(rawCorrect)) correctIndex = rawCorrect.toUpperCase().charCodeAt(0) - 65;
  else if (/^\d+$/.test(rawCorrect)) {
    const number = Number(rawCorrect);
    correctIndex = number >= 1 && number <= options.length ? number - 1 : number;
  }
  if (correctIndex < 0 || correctIndex >= options.length) return null;
  const domain = clean(first(row, ['domainname', 'domain', 'examdomain', 'category', 'section']), 150) || 'Uncategorized';
  const explanation = clean(first(row, ['explanation', 'rationale', 'reason', 'notes']), 5000);
  const objective = clean(first(row, ['objective', 'examobjective', 'subobjective']), 100);
  const image = clean(first(row, ['image', 'imagepath', 'asset', 'assetid']), 300);
  const id = createHash('sha256').update(JSON.stringify([question, options, correctIndex])).digest('hex').slice(0, 20);
  return { id, subjectId: 'general', question, choices: options.map((text, index) => ({ id: String.fromCharCode(65 + index), text, rationale: '' })), correctIds: [String.fromCharCode(65 + correctIndex)], selectCount: 1, domain, objective, explanation, image, topic: '', difficulty: '', examTip: '' };
}

function parseSecurityQuizRow(row, pack) {
  const id = clean(row.item_id, 30);
  const question = clean(row.question, 8000);
  const choices = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => ({ id: letter, text: clean(row[`option_${letter.toLowerCase()}`], 2000), rationale: clean(row[`rationale_${letter.toLowerCase()}`], 5000) })).filter((choice) => choice.text);
  const correctIds = clean(row.correct_option).split('|').filter(Boolean);
  const selectCount = Number(row.select_count);
  const choiceIds = new Set(choices.map((choice) => choice.id));
  if (!new RegExp(`^${pack.itemPrefix}-Q\\d{3}$`).test(id) || !question || !['multiple_choice', 'multiple_select'].includes(row.question_type) || !Number.isInteger(selectCount) || selectCount < 1 || selectCount > 3 || correctIds.length !== selectCount || new Set(correctIds).size !== correctIds.length || correctIds.some((key) => !choiceIds.has(key))) throw new Error(`Invalid Security+ answer key or question: ${id || row.question_id}`);
  if ((row.question_type === 'multiple_choice') !== (selectCount === 1)) throw new Error(`Question type and selection count disagree: ${id}`);
  return { id, subjectId: 'security-plus-sy0-701', studySetId: pack.studySetId, studySetTitle: pack.studySetTitle, question, choices, correctIds, selectCount, domain: clean(row.domain_name, 150), domainId: Number(row.domain_id), objective: clean(row.objective_id, 30), topic: clean(row.topic, 200), difficulty: clean(row.difficulty, 30), explanation: clean(row.explanation, 8000), examTip: clean(row.exam_tip, 2000), sourceUrls: clean(row.source_urls, 3000).split('|').filter(Boolean), image: '' };
}

function validatePbqs(pbqs, itemPrefix) {
  if (!Array.isArray(pbqs) || pbqs.length !== 25) throw new Error('The Security+ pack must contain 25 PBQs.');
  const caseIds = new Set();
  let taskCount = 0;
  for (const pbq of pbqs) {
    if (!new RegExp(`^${itemPrefix}-PBQ-\\d{3}$`).test(pbq.id) || caseIds.has(pbq.id) || !Array.isArray(pbq.exhibits) || !Array.isArray(pbq.tasks) || !Array.isArray(pbq.answer_key)) throw new Error(`Invalid PBQ case: ${pbq.id}`);
    caseIds.add(pbq.id);
    const tasks = new Map(pbq.tasks.map((task) => [task.id, task]));
    if (tasks.size !== pbq.tasks.length || pbq.answer_key.length !== tasks.size || !pbq.scenario_md || pbq.exhibits.some((exhibit) => !exhibit.title || !exhibit.content_md)) throw new Error(`Incomplete PBQ case: ${pbq.id}`);
    if (pbq.tasks.reduce((sum, task) => sum + task.max_points, 0) !== pbq.max_points) throw new Error(`PBQ point total mismatch: ${pbq.id}`);
    for (const key of pbq.answer_key) {
      const task = tasks.get(key.task_id);
      if (!task || key.scoring?.points !== task.max_points) throw new Error(`PBQ task/key mismatch: ${pbq.id}/${key.task_id}`);
      const ids = new Set(task.options.map((option) => option.id));
      if (ids.size !== task.options.length) throw new Error(`Duplicate PBQ option: ${pbq.id}/${task.id}`);
      const expected = key.correct_response;
      if (task.response_type === 'single_select' && (key.scoring.method !== 'exact' || !ids.has(expected))) throw new Error(`Invalid PBQ selection key: ${pbq.id}/${task.id}`);
      if (task.response_type === 'multi_select' && (key.scoring.method !== 'set_exact' || !Array.isArray(expected) || !expected.length || new Set(expected).size !== expected.length || expected.some((value) => !ids.has(value)))) throw new Error(`Invalid PBQ multi-select key: ${pbq.id}/${task.id}`);
      if (task.response_type === 'ordering' && (key.scoring.method !== 'ordered_exact' || !Array.isArray(expected) || expected.length !== ids.size || new Set(expected).size !== ids.size || expected.some((value) => !ids.has(value)))) throw new Error(`Invalid PBQ ordering key: ${pbq.id}/${task.id}`);
      if (task.response_type === 'number' && (key.scoring.method !== 'numeric' || !Number.isFinite(expected) || task.options.length)) throw new Error(`Invalid PBQ numeric key: ${pbq.id}/${task.id}`);
      if (!['single_select', 'multi_select', 'ordering', 'number'].includes(task.response_type)) throw new Error(`Unsupported PBQ task: ${pbq.id}/${task.id}`);
    }
    taskCount += pbq.tasks.length;
  }
  if (taskCount !== 200) throw new Error(`Expected 200 PBQ tasks; found ${taskCount}.`);
}

function validatePracticeSets(config, questions, pbqs) {
  if (!Array.isArray(config.sets) || config.sets.length !== 3) throw new Error('The Security+ pack must contain three practice sets.');
  const quizIds = new Set(questions.map((question) => question.id));
  const pbqIds = new Set(pbqs.map((pbq) => pbq.id));
  const usedQuiz = new Set();
  const usedPbq = new Set();
  for (const set of config.sets) {
    if (set.quiz_ids.length !== 85 || set.pbq_ids.length !== 5) throw new Error(`Incomplete practice set: ${set.id}`);
    for (const id of set.quiz_ids) { if (!quizIds.has(id) || usedQuiz.has(id)) throw new Error(`Invalid or repeated practice quiz ID: ${id}`); usedQuiz.add(id); }
    for (const id of set.pbq_ids) { if (!pbqIds.has(id) || usedPbq.has(id)) throw new Error(`Invalid or repeated practice PBQ ID: ${id}`); usedPbq.add(id); }
  }
  if (config.reserved.quiz_ids.length !== 45 || config.reserved.pbq_ids.length !== 10 || config.reserved.quiz_ids.some((id) => !quizIds.has(id) || usedQuiz.has(id)) || config.reserved.pbq_ids.some((id) => !pbqIds.has(id) || usedPbq.has(id))) throw new Error('Invalid practice reserve IDs.');
}

const SECURITY_PACKS = [
  { id: 'security-plus-sy0-701', name: 'CompTIA Security+ (SY0-701)', studySetId: 'test-prep-1', studySetTitle: 'Test Prep 1', itemPrefix: 'SEC', quiz: 'security_plus_quiz.csv', pbqs: 'security_plus_pbqs.json', practice: 'practice_sets.json', manifest: 'PACK_MANIFEST.json' },
  { id: 'test-prep-2', name: 'Test Prep 2', studySetId: 'test-prep-2', studySetTitle: 'Test Prep 2', itemPrefix: 'SEC2', quiz: 'test_prep_2_quiz.csv', pbqs: 'test_prep_2_pbqs.json', practice: 'test_prep_2_practice_sets.json', manifest: 'test_prep_2_manifest.json' },
];

function importSecurityPack(entries, safeName, pack) {
  const byName = new Map();
  for (const [name, bytes] of entries) {
    const basename = path.basename(name);
    if (byName.has(basename)) throw new Error(`Duplicate Security+ pack file: ${basename}`);
    byName.set(basename, bytes);
  }
  for (const required of [pack.quiz, pack.pbqs, pack.practice, pack.manifest]) if (!byName.has(required)) throw new Error(`The Security+ pack is missing ${required}.`);
  const manifest = JSON.parse(new TextDecoder().decode(byName.get(pack.manifest)));
  if (!Array.isArray(manifest.files) || (manifest.study_set_id && manifest.study_set_id !== pack.studySetId)) throw new Error('Invalid Security+ pack manifest.');
  for (const file of manifest.files) {
    const bytes = byName.get(file.name);
    if (!bytes || bytes.byteLength !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Security+ pack integrity check failed: ${file.name}`);
  }
  const rows = rowsFromFile(pack.quiz, byName.get(pack.quiz));
  const questions = rows.map((row) => parseSecurityQuizRow(row, pack));
  if (questions.length !== 300 || new Set(questions.map((question) => question.id)).size !== 300 || questions.filter((question) => question.selectCount === 1).length !== 270 || questions.filter((question) => question.selectCount > 1).length !== 30) throw new Error('Security+ quiz totals do not match the import guide.');
  const domainCounts = [36, 66, 54, 84, 60];
  for (let i = 1; i <= 5; i++) if (questions.filter((question) => question.domainId === i).length !== domainCounts[i - 1]) throw new Error(`Security+ domain ${i} count mismatch.`);
  const pbqs = JSON.parse(new TextDecoder().decode(byName.get(pack.pbqs))).pbqs;
  validatePbqs(pbqs, pack.itemPrefix);
  const practiceSets = JSON.parse(new TextDecoder().decode(byName.get(pack.practice)));
  validatePracticeSets(practiceSets, questions, pbqs);
  return { id: pack.id, name: pack.name, sourceFile: safeName, importedAt: new Date().toISOString(), files: [{ name: pack.quiz, count: 300 }, { name: pack.pbqs, count: 25 }], questions, pbqs, practiceSets };
}

function rowsFromFile(name, bytes) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
  if (name.toLowerCase().endsWith('.csv')) return parse(text, { columns: true, bom: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
  if (name.toLowerCase().endsWith('.json')) {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : value.questions || value.items || value.data || [];
  }
  return [];
}

export function importQuestionFile(filename, buffer) {
  const safeName = path.basename(clean(filename, 200)).replace(/[\x00-\x1f]/g, '');
  if (!/\.(zip|csv|json)$/i.test(safeName)) throw new Error('Choose a ZIP, CSV, or JSON question file.');
  const files = [];
  let unpacked = null;
  if (/\.zip$/i.test(safeName)) {
    try {
      unpacked = unzipLimited(buffer);
    } catch (error) { throw new Error(error.message === 'The ZIP contains too many or too-large files.' ? error.message : 'This ZIP file could not be opened.'); }
    const entries = Object.entries(unpacked);
    for (const [name, bytes] of entries) {
      if (/\.(csv|json)$/i.test(name)) files.push([name, bytes]);
    }
  } else files.push([safeName, new Uint8Array(buffer)]);
  if (!files.length) throw new Error('No CSV or JSON question file was found.');
  if (unpacked) {
    const pack = SECURITY_PACKS.find((candidate) => files.some(([name]) => [candidate.quiz, candidate.pbqs, candidate.practice, candidate.manifest].includes(path.basename(name))));
    if (pack) return importSecurityPack(Object.entries(unpacked), safeName, pack);
  }

  const questions = [];
  const seen = new Set();
  const acceptedFiles = [];
  for (const [name, bytes] of files) {
    let rows;
    try { rows = rowsFromFile(name, bytes); }
    catch { continue; }
    if (!Array.isArray(rows)) continue;
    let accepted = 0;
    for (const row of rows) {
      const question = normalize(row);
      if (!question || seen.has(question.id)) continue;
      seen.add(question.id);
      questions.push(question);
      accepted++;
      if (questions.length > MAX_QUESTIONS) throw new Error('The import exceeds 20,000 questions.');
    }
    if (accepted) acceptedFiles.push({ name, count: accepted });
  }
  if (!questions.length) throw new Error('No supported multiple-choice questions were found. Each row needs a question, at least two options, and a correct answer.');
  return { name: safeName.replace(/\.(zip|csv|json)$/i, ''), sourceFile: safeName, importedAt: new Date().toISOString(), files: acceptedFiles, questions, pbqs: [], practiceSets: null };
}
