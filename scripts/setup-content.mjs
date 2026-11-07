import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importQuestionFile } from '../import.mjs';
import { parsePracticalPackage, writePracticalPackage } from '../practical-import.mjs';
import { migrateLegacyFiles } from '../practical-migrate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = process.env.STUDY_DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dir, { recursive: true });
const libraryFile = path.join(dir, 'library.json');
const contentFile = path.join(dir, 'practical-content.json');

// Keep saved attempts associated with their study-bank version.
if (fs.existsSync(contentFile)) {
  const installed = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
  if (installed.version !== 'sy701-study-2026-11-07-r2') throw new Error('This directory uses a different study-bank version. Preserve it for saved attempts and choose a separate STUDY_DATA_DIR for this installation.');
}
// Validate bundled content before creating any study files.
const sets = ['security_plus_sy0_701_study_pack.zip', 'test_prep_2_security_plus_sy0_701.zip']
  .map((name) => importQuestionFile(name, fs.readFileSync(path.join(root, name))));
const bundle = parsePracticalPackage(fs.readFileSync(path.join(root, 'security_plus_sy0_701_practical_site_upgrade.zip')), { sets });
if (!fs.existsSync(libraryFile)) {
  fs.writeFileSync(libraryFile, JSON.stringify({ sets }, null, 2), { flag: 'wx', mode: 0o600 });
} else {
  console.log('Existing library preserved.');
}
if (!fs.existsSync(contentFile)) {
  writePracticalPackage(dir, bundle);
} else {
  console.log('Existing practical content preserved.');
}
if (fs.existsSync(path.join(dir, 'progress.json'))) migrateLegacyFiles(dir);
console.log('Study content ready. Bundled bank: 1,546 items and 18 assessments.');
