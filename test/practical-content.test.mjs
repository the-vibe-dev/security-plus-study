import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePracticalPackage, writePracticalPackage } from '../practical-import.mjs';
import { importQuestionFile } from '../import.mjs';
import { backfillLegacyProgress } from '../practical-migrate.mjs';

const root = new URL('..', import.meta.url);
const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));

test('the new bank preserves all originals and allocates every item once', () => {
  const first = importQuestionFile('security_plus_sy0_701_study_pack.zip', fs.readFileSync(new URL('../security_plus_sy0_701_study_pack.zip', import.meta.url)));
  const second = importQuestionFile('test_prep_2_security_plus_sy0_701.zip', fs.readFileSync(new URL('../test_prep_2_security_plus_sy0_701.zip', import.meta.url)));
  const checked = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)), { sets: [first, second] });
  assert.equal(checked.counts.legacyMcq, 600);
  assert.equal(checked.counts.newMcq, 257);
  assert.equal(checked.counts.interactive, 639);
  assert.equal(checked.counts.legacyPbq, 50);
  assert.equal(checked.questions.length, 1546);
  assert.equal(checked.exams.length, 18);
  const ids = checked.exams.flatMap((exam) => exam.items.map((item) => item.id));
  assert.equal(ids.length, 1546);
  assert.equal(new Set(ids).size, 1546);
  assert.equal(checked.exams.slice(0, 10).every((exam) => exam.items.length === 90 && exam.duration_minutes === 90), true);
  assert.equal(checked.exams.slice(10, 17).every((exam) => exam.items.length === 90), true);
  assert.equal(checked.exams[17].items.length, 16);
  for (const exam of checked.exams.slice(0, 10)) {
    const roles = exam.items.reduce((counts, item) => (counts[item.role]++, counts), { knowledge: 0, short_interactive: 0, pbq: 0 });
    assert.deepEqual(roles, { knowledge: 70, short_interactive: 15, pbq: 5 });
    const domains = exam.items.reduce((counts, entry) => { const item = checked.questions.find((question) => question.id === entry.id); counts[item.domain_id]++; return counts; }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    assert.deepEqual(domains, exam.blueprint.domain_target_counts);
    const topics = new Set(exam.items.map((entry) => checked.questions.find((question) => question.id === entry.id).topic));
    for (const topic of ['cli_tools', 'acronym_recall', 'ports_protocols', 'firewall_setup', 'matching', 'in_order', 'network_diagram', 'packet_analysis', 'identity_config', 'wireless_security', 'email_security', 'risk_recovery_math', 'vuln_triage']) assert.ok(topics.has(topic), `${exam.id} missing ${topic}`);
  }
});

test('private content import is idempotent and legacy progress backfill leaves originals intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-practical-import-'));
  try {
    assert.equal(writePracticalPackage(dir, bundle).changed, true);
    assert.equal(writePracticalPackage(dir, bundle).changed, false);
    const old = { answers: { 'SEC-Q001': { attempts: 3, correct: 2, lastCorrect: false, lastSelectedIds: ['B'], lastAnsweredAt: '2026-10-06T12:00:00.000Z' } }, pbqs: { 'SEC-PBQ-001': { attempt: 2, submitted: true, result: { points: 6, possible: 8 }, submittedAt: '2026-10-06T13:00:00.000Z' } } };
    const before = JSON.stringify(old);
    const state = { schemaVersion: 1, attempts: {}, learning: {}, archived: {}, activityDates: [] };
    assert.deepEqual(backfillLegacyProgress(state, old, bundle, '2026-10-07T00:00:00.000Z').answers, 1);
    assert.equal(state.learning['SEC-Q001'].incorrectCount, 1);
    assert.equal(state.learning['SEC-PBQ-001'].mastery, 75);
    assert.equal(backfillLegacyProgress(state, old, bundle).answers, 0);
    assert.equal(JSON.stringify(old), before);
    assert.equal(fs.statSync(path.join(dir, 'practical-content.json')).mode & 0o077, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
