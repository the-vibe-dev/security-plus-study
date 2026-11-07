import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function backfillLegacyProgress(state, old, content, now = new Date().toISOString()) {
  const ids = new Set(content.questions.map((item) => item.id));
  state.learning ||= {};
  let answers = 0;
  let pbqs = 0;
  for (const [id, entry] of Object.entries(old.answers || {})) {
    if (!ids.has(id) || state.learning[id]) continue;
    const count = Math.max(0, Number(entry.attempts) || 0);
    const correct = Math.max(0, Math.min(count, Number(entry.correct) || 0));
    const lastSeen = entry.lastAnsweredAt || now;
    state.learning[id] = { attemptCount: count, incorrectCount: count - correct, mastery: count ? Math.round(correct / count * 100) : 0,
      lastSeen, lastEarned: entry.lastCorrect ? 1 : 0, lastPossible: 1,
      spacedReviewDue: entry.lastCorrect ? new Date(Date.parse(lastSeen) + 7 * 86400000).toISOString() : now,
      bookmarked: false, legacy: true, lastSelectedIds: entry.lastSelectedIds || [] };
    answers++;
  }
  for (const [id, entry] of Object.entries(old.pbqs || {})) {
    if (!ids.has(id) || state.learning[id]) continue;
    const result = entry.result || { points: 0, possible: 8 };
    const points = Math.max(0, Number(result.points) || 0);
    const possible = Math.max(1, Number(result.possible) || 8);
    const count = Math.max(1, Number(entry.attempt) || 1);
    state.learning[id] = { attemptCount: count, incorrectCount: entry.submitted && points >= possible ? 0 : 1,
      mastery: entry.submitted ? Math.round(points / possible * 100) : 0,
      lastSeen: entry.submittedAt || entry.updatedAt || now, lastEarned: points, lastPossible: possible,
      spacedReviewDue: entry.submitted && points >= possible ? new Date(Date.parse(entry.submittedAt || now) + 7 * 86400000).toISOString() : now,
      bookmarked: false, legacy: true };
    pbqs++;
  }
  state.legacyMigratedAt ||= now;
  return { answers, pbqs, totalLearningItems: Object.keys(state.learning).length };
}

export function migrateLegacyFiles(dataDir, { dryRun = false } = {}) {
  const content = JSON.parse(fs.readFileSync(path.join(dataDir, 'practical-content.json'), 'utf8'));
  const old = JSON.parse(fs.readFileSync(path.join(dataDir, 'progress.json'), 'utf8'));
  const file = path.join(dataDir, 'practical-state.json');
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schemaVersion: 1, attempts: {}, learning: {}, archived: {}, activityDates: [] };
  const counts = backfillLegacyProgress(state, old, content);
  if (!dryRun && (counts.answers || counts.pbqs || !fs.existsSync(file))) {
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  }
  return { dryRun, ...counts, existingAttempts: Object.keys(state.attempts || {}).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || process.env.STUDY_DATA_DIR;
  if (!dir) { process.stderr.write('Usage: node practical-migrate.mjs DATA_DIR [--dry-run]\n'); process.exit(2); }
  process.stdout.write(JSON.stringify(migrateLegacyFiles(dir, { dryRun: process.argv.includes('--dry-run') })) + '\n');
}
