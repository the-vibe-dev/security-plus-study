import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('local setup loads all bundled content and preserves existing content and progress on rerun', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-local-setup-'));
  const run = () => execFileSync(process.execPath, ['scripts/setup-content.mjs'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, STUDY_DATA_DIR: dir }, stdio: 'pipe',
  });
  try {
    run();
    const libraryFile = path.join(dir, 'library.json');
    const contentFile = path.join(dir, 'practical-content.json');
    const library = JSON.parse(fs.readFileSync(libraryFile));
    const content = JSON.parse(fs.readFileSync(contentFile));
    assert.equal(library.sets.flatMap((set) => set.questions).length, 600);
    assert.equal(content.questions.length, 1546);
    assert.equal(content.exams.length, 18);
    const stateFile = path.join(dir, 'practical-state.json');
    const state = '{"schemaVersion":1,"attempts":{},"learning":{},"archived":{},"activityDates":["2026-11-07"]}';
    fs.writeFileSync(stateFile, state);
    const before = [libraryFile, contentFile, stateFile].map((file) => fs.readFileSync(file, 'utf8'));
    run();
    assert.deepEqual([libraryFile, contentFile, stateFile].map((file) => fs.readFileSync(file, 'utf8')), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
