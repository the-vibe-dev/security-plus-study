// Content concerns are deliberately separate from attempt flags and server progress.
export const REVIEW_KEY = 'security-study-content-review-v1';
export const REASONS = {
  accuracy: 'Answer or explanation may be incorrect',
  ambiguity: 'Ambiguous question or missing context',
  conflict: 'Conflicts with training or a reference',
  interaction: 'Interaction or grading problem',
  outdated: 'Outdated information',
  other: 'Other concern',
};
export const STATUSES = { open: 'Open', in_review: 'In review', resolved: 'Resolved' };
export const OUTCOMES = { confirmed: 'Confirmed as written', correction_needed: 'Correction needed', inconclusive: 'Inconclusive / deferred' };

const own = (object, key) => Object.hasOwn(object, key);
function pick(value, keys) {
  return Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function bounded(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be text of at most ${max} characters.`);
  return value.trim();
}

// Only copy content shown by the renderers, never an attempt, response, score, or
// a whole API payload. Feedback is provided only when the UI is allowed to show it.
export function contentSnapshot(item, source = 'practical', feedback = null) {
  let snapshot;
  if (source === 'practical') {
    snapshot = pick(item, ['id', 'origin', 'exam_code', 'domain_id', 'domain_name', 'objective_id', 'topic', 'question_kind', 'prompt', 'stimulus', 'sources']);
    snapshot.interaction = pick(item.interaction, ['type', 'options', 'candidate_ids', 'min_selections', 'max_selections', 'select_count', 'left', 'right', 'one_to_one', 'cards', 'events', 'slots', 'elements', 'unique_assignment', 'canvas', 'role_assignment', 'unit', 'placeholder', 'max_length', 'shell', 'display', 'command_choices', 'command_placeholder', 'interpretation_options', 'max_user_rules']);
    if (item.interaction?.tasks) snapshot.interaction.tasks = item.interaction.tasks.map((task) => pick(task, ['id', 'prompt', 'response_type', 'options', 'selectCount', 'select_count']));
  } else if (source === 'legacy-question') {
    snapshot = pick(item, ['id', 'setId', 'domain', 'objective', 'topic', 'question', 'choices', 'selectCount']);
  } else if (source === 'legacy-pbq') {
    snapshot = pick(item, ['id', 'setId', 'title', 'primary_domain', 'objective_ids', 'scenario_md', 'exhibits']);
    snapshot.tasks = item.tasks.map((task) => pick(task, ['id', 'group', 'prompt', 'response_type', 'options', 'selectCount']));
  } else throw new Error('Unknown content source.');
  if (feedback) {
    snapshot.feedback = pick(feedback, ['explanation', 'correctAnswer', 'correctIds', 'rationales', 'examTip']);
    const tasks = feedback.detail?.tasks || feedback.tasks;
    if (tasks) snapshot.feedback.tasks = tasks.map((task) => pick(task, ['taskId', 'explanation', 'correctResponse']));
  }
  return copy(snapshot);
}

export function contentIdentity(item, source = 'practical') {
  return { source, itemId: String(item.id), setId: String(item.setId || '') };
}
export function reviewId(identity, target) {
  return JSON.stringify([identity.source, identity.setId, identity.itemId, target]);
}
export function validateRecord(record) {
  if (!record || !['practical', 'legacy-question', 'legacy-pbq'].includes(record.source) || typeof record.itemId !== 'string' || !record.itemId || typeof record.setId !== 'string' || !['question', 'explanation'].includes(record.target) || record.id !== reviewId(record, record.target)) throw new Error('Invalid review identity.');
  if (!Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error('Invalid review revision.');
  if (!own(REASONS, record.reason) || !own(STATUSES, record.status)) throw new Error('Choose a reason and review status.');
  for (const key of ['createdAt', 'updatedAt']) if (!Number.isFinite(Date.parse(record[key]))) throw new Error('Invalid review date.');
  if (!record.snapshot || typeof record.snapshot !== 'object' || Array.isArray(record.snapshot) || typeof record.title !== 'string') throw new Error('Missing content snapshot.');
  bounded(record.itemId, 2000, 'Item ID'); bounded(record.setId, 2000, 'Set ID'); bounded(record.title, 2000, 'Title');
  if (record.examId !== undefined) bounded(record.examId, 200, 'Exam ID');
  if (record.bankVersion !== undefined) bounded(record.bankVersion, 200, 'Bank version');
  bounded(record.note, 4000, 'Concern'); bounded(record.reference, 2000, 'Reference'); bounded(record.resolution, 4000, 'Review notes');
  if (record.outcome !== '' && !own(OUTCOMES, record.outcome)) throw new Error('Choose a review outcome.');
  if (record.status === 'resolved' && (!record.resolution.trim() || !record.outcome)) throw new Error('Add an outcome and review notes before resolving.');
  return record;
}

export function readReviews(storage) {
  let raw;
  try { raw = storage.getItem(REVIEW_KEY); } catch { throw new Error('Browser storage is unavailable. No content flags were saved.'); }
  if (raw === null) return [];
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.records)) throw new Error();
    const ids = new Set();
    return data.records.map((record) => { validateRecord(record); if (ids.has(record.id)) throw new Error(); ids.add(record.id); return record; });
  } catch { throw new Error('The saved review list is unreadable or from a newer version. It has not been overwritten. Back up this browser’s storage before recovery.'); }
}

export function updateReviews(records, input, now = new Date().toISOString()) {
  const id = reviewId(input, input.target);
  const existing = records.find((record) => record.id === id);
  if ((existing && input.revision !== existing.revision) || (!existing && input.revision !== undefined)) {
    throw Object.assign(new Error('This review changed in another tab or was removed. Your draft has not been saved. Copy your new notes, then cancel and reopen the flag to review the latest version.'), { status: 409 });
  }
  // Editing concern text must not silently replace the originally flagged content.
  const record = validateRecord({
    id, source: input.source, itemId: input.itemId, setId: input.setId, target: input.target, revision: (existing?.revision || 0) + 1,
    title: existing?.title ?? bounded(input.title, 2000, 'Title'),
    snapshot: existing?.snapshot ?? copy(input.snapshot),
    ...pick(existing || input, ['examId', 'bankVersion']),
    reason: input.reason, note: bounded(input.note || '', 4000, 'Concern'),
    reference: bounded(input.reference || '', 2000, 'Reference'), status: input.status || 'open',
    outcome: input.outcome || '', resolution: bounded(input.resolution || '', 4000, 'Review notes'),
    createdAt: existing?.createdAt || now, updatedAt: now,
  });
  return existing ? records.map((entry) => entry.id === id ? record : entry) : [...records, record];
}

export function saveReview(storage, input, now = new Date().toISOString()) {
  const next = updateReviews(readReviews(storage), input, now);
  try { storage.setItem(REVIEW_KEY, JSON.stringify({ version: 1, records: next })); }
  catch { throw new Error('Could not save the content flag. Browser storage may be full or blocked. Your form is still open; copy your notes before leaving.'); }
  return next;
}

export function exportReviews(records, now = new Date().toISOString()) {
  return JSON.stringify({
    schemaVersion: 1, app: 'Security+ Study', exportedAt: now,
    notice: 'Private review notes and captured study content. Share only with permission. Resolved means the review was recorded, not that source content was corrected. No learner answers, scores, or attempt IDs are included automatically.',
    records: records.map(validateRecord),
  }, null, 2);
}
