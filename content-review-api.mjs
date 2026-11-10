import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { contentSnapshot, readReviews, reviewId, updateReviews, validateRecord } from './src/contentReviewStore.js';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_STORE = 16 * 1024 * 1024;
const MAX_RECORDS = 4096;

function readRecords(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return readReviews({ getItem: () => raw });
}

function writeRecords(file, records) {
  const data = JSON.stringify({ version: 1, records });
  if (records.length > MAX_RECORDS || Buffer.byteLength(data) > MAX_STORE) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, data, { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return true;
}

function cleanSnapshot(input) {
  if (!input.snapshot || typeof input.snapshot !== 'object' || Array.isArray(input.snapshot)) throw new Error('Missing content snapshot.');
  const feedback = input.target === 'explanation' ? input.snapshot.feedback : null;
  return contentSnapshot(input.snapshot, input.source, feedback);
}

function browserRecord(input) {
  validateRecord(input);
  const { id, source, itemId, setId, target, revision, title, examId, bankVersion,
    reason, note, reference, status, outcome, resolution, createdAt, updatedAt } = input;
  return { id, source, itemId, setId, target, revision, title, examId, bankVersion,
    reason, note, reference, status, outcome, resolution, createdAt, updatedAt,
    snapshot: cleanSnapshot(input) };
}

export async function handleContentReviews(req, res, { dataDir, owner, send, bodyBytes }) {
  if (!owner) {
    if (req.method === 'GET') return send(res, 200, { enabled: false, records: [] });
    return send(res, 403, { error: 'Server review storage requires a site login.' });
  }
  if (!['GET', 'PUT', 'POST'].includes(req.method)) return send(res, 405, { error: 'Method not allowed.' });
  const file = path.join(dataDir, 'content-reviews', `${createHash('sha256').update(owner).digest('hex')}.json`);
  let input;
  if (req.method !== 'GET') {
    try { input = JSON.parse((await bodyBytes(req, MAX_BODY)).toString('utf8')); }
    catch (error) {
      return send(res, error.status === 413 ? 413 : 400, { error: error.status === 413 ? error.message : 'Invalid review request.' });
    }
  }
  try {
    // Read and replace synchronously after the body arrives so concurrent saves see the latest revisions.
    const records = readRecords(file);
    if (req.method === 'GET') return send(res, 200, { enabled: true, records });
    let next, result;
    try {
      if (req.method === 'PUT') {
        next = updateReviews(records, { ...input, snapshot: cleanSnapshot(input) });
        result = { records: [next.find((record) => record.id === reviewId(input, input.target))] };
      } else {
        if (!Array.isArray(input?.records) || input.records.length > MAX_RECORDS) throw new Error('Invalid browser review list.');
        const existing = new Set(records.map((record) => record.id));
        const added = [];
        for (const entry of input.records) {
          const record = browserRecord(entry);
          if (existing.has(record.id)) continue;
          existing.add(record.id);
          added.push(record);
        }
        next = [...records, ...added];
        result = { records: added, skipped: input.records.length - added.length };
      }
    } catch (error) {
      return send(res, error.status === 409 ? 409 : 400, { error: error.status === 409 ? error.message : 'Invalid review. Check the reason, status, and review notes.' });
    }
    if (!writeRecords(file, next)) return send(res, 413, { error: 'The server review store is full.' });
    return send(res, 200, result);
  } catch {
    return send(res, 503, { error: 'Could not access the server review store. Existing reviews have been kept.' });
  }
}
