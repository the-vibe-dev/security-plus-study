import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { importQuestionFile } from '../import.mjs';
import { gradeQuiz, gradePbq } from '../scoring.mjs';

const csv = 'question,option_a,option_b,option_c,correct_option,domain,explanation\n"Which protocol encrypts web traffic?",HTTP,HTTPS,FTP,B,4. Security Operations,"HTTPS uses TLS."\n';

test('imports History Bowl style CSV from a ZIP and preserves study metadata', () => {
  const zip = zipSync({ 'questions.csv': strToU8(csv), 'README.txt': strToU8('ignored') });
  const set = importQuestionFile('security-questions.zip', Buffer.from(zip));
  assert.equal(set.questions.length, 1);
  assert.deepEqual(set.questions[0].choices.map((choice) => choice.text), ['HTTP', 'HTTPS', 'FTP']);
  assert.deepEqual(set.questions[0].correctIds, ['B']);
  assert.equal(set.questions[0].domain, '4. Security Operations');
  assert.equal(set.questions[0].explanation, 'HTTPS uses TLS.');
});

test('imports JSON questions with an options array', () => {
  const bytes = Buffer.from(JSON.stringify({ questions: [{ question: 'Which port is HTTPS?', options: ['80', '443'], answer: '443' }] }));
  const set = importQuestionFile('ports.json', bytes);
  assert.deepEqual(set.questions[0].correctIds, ['B']);
});

test('rejects files without an answer key', () => {
  assert.throws(() => importQuestionFile('invalid.csv', Buffer.from('question,option_a,option_b\nExample?,A,B\n')), /No supported multiple-choice/);
});

test('imports and validates the full Security+ bank, PBQs, and practice sets', () => {
  const filename = new URL('../security_plus_sy0_701_study_pack.zip', import.meta.url);
  const set = importQuestionFile('security_plus_sy0_701_study_pack.zip', fs.readFileSync(filename));
  assert.equal(set.id, 'security-plus-sy0-701');
  assert.equal(set.questions.length, 300);
  assert.equal(set.questions.filter((question) => question.selectCount > 1).length, 30);
  assert.deepEqual([1, 2, 3, 4, 5].map((domain) => set.questions.filter((question) => question.domainId === domain).length), [36, 66, 54, 84, 60]);
  assert.ok(set.questions.every((question) => question.choices.every((choice) => choice.text && choice.rationale)));
  assert.equal(set.pbqs.length, 25);
  assert.equal(set.pbqs.reduce((sum, pbq) => sum + pbq.tasks.length, 0), 200);
  assert.equal(set.practiceSets.sets.length, 3);
  const multi = set.questions.find((question) => question.selectCount > 1);
  assert.equal(gradeQuiz(multi, [...multi.correctIds].reverse()), true);
  assert.equal(gradeQuiz(multi, multi.correctIds.slice(0, 1)), false);
  const pbq = set.pbqs[0];
  const responses = Object.fromEntries(pbq.answer_key.map((key) => [key.task_id, key.correct_response]));
  assert.equal(gradePbq(pbq, responses).points, pbq.max_points);
});

test('imports Test Prep 2 as a complete separate Security+ bank', () => {
  const first = importQuestionFile('security_plus_sy0_701_study_pack.zip', fs.readFileSync(new URL('../security_plus_sy0_701_study_pack.zip', import.meta.url)));
  const second = importQuestionFile('test_prep_2_security_plus_sy0_701.zip', fs.readFileSync(new URL('../test_prep_2_security_plus_sy0_701.zip', import.meta.url)));
  assert.equal(second.id, 'test-prep-2');
  assert.equal(second.name, 'Test Prep 2');
  assert.equal(second.questions.length, 300);
  assert.equal(second.questions.filter((question) => question.selectCount > 1).length, 30);
  assert.equal(second.pbqs.length, 25);
  assert.equal(second.pbqs.reduce((sum, pbq) => sum + pbq.tasks.length, 0), 200);
  assert.equal(second.practiceSets.sets.length, 3);
  assert.deepEqual([1, 2, 3, 4, 5].map((domain) => second.questions.filter((question) => question.domainId === domain).length), [36, 66, 54, 84, 60]);
  assert.ok(second.questions.every((question) => question.choices.every((choice) => choice.text && choice.rationale)));
  assert.equal(new Set([...first.questions, ...second.questions].map((question) => question.id)).size, 600);
  assert.equal(new Set([...first.pbqs, ...second.pbqs].map((pbq) => pbq.id)).size, 50);
  const multi = second.questions.find((question) => question.selectCount > 1);
  assert.equal(gradeQuiz(multi, [...multi.correctIds].reverse()), true);
  assert.equal(gradeQuiz(multi, multi.correctIds.slice(0, 1)), false);
  const pbq = second.pbqs[0];
  const responses = Object.fromEntries(pbq.answer_key.map((key) => [key.task_id, key.correct_response]));
  assert.equal(gradePbq(pbq, responses).points, pbq.max_points);
});

test('does not silently import only the quiz from an incomplete Test Prep 2 ZIP', () => {
  const zip = zipSync({ 'test_prep_2_quiz.csv': strToU8(csv) });
  assert.throws(() => importQuestionFile('test_prep_2.zip', Buffer.from(zip)), /missing test_prep_2_pbqs\.json/);
});

test('limits actual ZIP output when size metadata is forged', () => {
  const zip = zipSync({ 'questions.csv': strToU8(`${csv}${' '.repeat(60 * 1024 * 1024)}`) }, { level: 9 });
  const central = zip.findIndex((_, index) => zip[index] === 0x50 && zip[index + 1] === 0x4b && zip[index + 2] === 1 && zip[index + 3] === 2);
  assert.ok(central > 0);
  new DataView(zip.buffer).setUint32(central + 24, csv.length, true);
  assert.throws(() => importQuestionFile('questions.zip', zip), /too many or too-large files/);
});

test('rejects a ZIP whose directory understates a small entry', () => {
  const zip = zipSync({ 'questions.csv': strToU8(`${csv}${' '.repeat(1024 * 1024)}`) }, { level: 9 });
  const central = zip.findIndex((_, index) => zip[index] === 0x50 && zip[index + 1] === 0x4b && zip[index + 2] === 1 && zip[index + 3] === 2);
  assert.ok(central > 0);
  new DataView(zip.buffer).setUint32(central + 24, csv.length, true);
  assert.throws(() => importQuestionFile('questions.zip', zip), /could not be opened/);
});

test('imports a data-descriptor ZIP containing the descriptor marker in compressed data', () => {
  const content = 'question,option_a,option_b,correct_option,explanation\nExample?,No,Yes,B,"prefix PK\x07\x08 suffix"\n';
  const input = Buffer.from(zipSync({ 'questions.csv': strToU8(content) }, { level: 0 }));
  const signature = (a, b) => input.findIndex((_, index) => input[index] === 0x50 && input[index + 1] === 0x4b && input[index + 2] === a && input[index + 3] === b);
  const central = signature(1, 2);
  const end = signature(5, 6);
  assert.ok(central > 0 && end > central);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  input.copy(descriptor, 4, central + 16, central + 28);
  const zip = Buffer.concat([input.subarray(0, central), descriptor, input.subarray(central)]);
  zip.writeUInt16LE(zip.readUInt16LE(6) | 8, 6);
  for (const offset of [14, 18, 22]) zip.writeUInt32LE(0, offset);
  zip.writeUInt16LE(zip.readUInt16LE(central + 24) | 8, central + 24);
  zip.writeUInt32LE(central + 16, end + 32);
  assert.ok(zip.subarray(30, central).includes(Buffer.from([0x50, 0x4b, 7, 8])));
  assert.equal(importQuestionFile('questions.zip', zip).questions.length, 1);
});
