import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, jsonPost } from './api.js';
import { QuestionRenderer } from './QuestionRenderer.jsx';

function timeLabel(deadline, now) {
  if (!deadline) return 'Untimed';
  const seconds = Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function localKey(id) { return `security-practical-draft:${id}`; }
function readLocal(id) { try { return JSON.parse(localStorage.getItem(localKey(id))); } catch { return null; } }
function scoreLabel(bucket) { return bucket?.possible ? `${Math.round(bucket.earned * 100) / 100}/${bucket.possible}` : '—'; }

export function ExamWorkspace({ attemptId, onBack, onComplete, onBookmark, bookmarks = {} }) {
  const [attempt, setAttempt] = useState(null);
  const [responses, setResponses] = useState({});
  const [flags, setFlags] = useState({});
  const [cursor, setCursor] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [saveStatus, setSaveStatus] = useState('Loading attempt…');
  const [error, setError] = useState('');
  const [showResults, setShowResults] = useState(true);
  const [hintOpen, setHintOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('all');
  const queue = useRef(Promise.resolve());
  const submitting = useRef(false);
  const conflictRef = useRef(false);
  const [draftConflict, setDraftConflict] = useState(false);
  const timer = useRef(null);
  const latest = useRef({ responses: {}, flags: {}, cursor: 0 });
  const expiredRequest = useRef(false);
  const itemEnteredAt = useRef(Date.now());
  const revisionRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const load = useCallback(async () => {
    const result = await api(`/api/practical/attempts/${attemptId}`);
    const remote = result.attempt;
    const draft = readLocal(attemptId);
    const different = draft && (JSON.stringify(draft.responses || {}) !== JSON.stringify(remote.responses || {}) || JSON.stringify(draft.flags || {}) !== JSON.stringify(remote.flags || {}));
    const stale = different && (draft.revision < remote.revision || remote.status !== 'in_progress');
    conflictRef.current = Boolean(stale); setDraftConflict(Boolean(stale));
    const recover = draft && !stale && remote.status === 'in_progress';
    const nextResponses = recover ? { ...remote.responses, ...draft.responses } : remote.responses;
    const nextFlags = recover ? { ...remote.flags, ...draft.flags } : remote.flags;
    const nextCursor = recover && Number.isInteger(draft.cursor) ? Math.min(remote.itemCount - 1, Math.max(0, draft.cursor)) : remote.cursor;
    setAttempt(remote); setResponses(nextResponses); setFlags(nextFlags); setCursor(nextCursor); setError('');
    revisionRef.current = remote.revision;
    setSaveStatus(stale ? 'A browser draft differs from the server. Choose which answers to keep.' : recover ? 'Recovered your browser draft.' : remote.status === 'in_progress' ? 'Saved on this site.' : 'Attempt complete.');
    latest.current = { responses: nextResponses, flags: nextFlags, cursor: nextCursor };
    itemEnteredAt.current = Date.now();
    if (remote.status !== 'in_progress') { if (!different) localStorage.removeItem(localKey(attemptId)); onCompleteRef.current?.(); }
  }, [attemptId]);
  useEffect(() => { load().catch((err) => { setError(err.message); setSaveStatus('Unable to load attempt.'); }); }, [load]);
  useEffect(() => { const ticker = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(ticker); }, []);
  useEffect(() => {
    if (!attempt?.deadlineAt || attempt.status !== 'in_progress' || Date.now() < Date.parse(attempt.deadlineAt) || expiredRequest.current) return;
    expiredRequest.current = true;
    load().catch((err) => { setError(`The time limit was reached. Reconnect to finalize this attempt: ${err.message}`); expiredRequest.current = false; });
  }, [attempt, now, load]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function remember(nextResponses = latest.current.responses, nextFlags = latest.current.flags, nextCursor = latest.current.cursor) {
    latest.current = { responses: nextResponses, flags: nextFlags, cursor: nextCursor };
    if (attempt?.status === 'in_progress') localStorage.setItem(localKey(attemptId), JSON.stringify({ revision: revisionRef.current, responses: nextResponses, flags: nextFlags, cursor: nextCursor, updatedAt: Date.now() }));
  }
  function enqueue(payload) {
    if (conflictRef.current) return Promise.reject(new Error('Reconcile the browser draft before saving.'));
    const snapshot = { responses: { ...latest.current.responses }, flags: { ...latest.current.flags }, cursor: payload.cursor, timeByItem: { [payload.questionId]: payload.elapsedSeconds } };
    setSaveStatus('Saving…');
    queue.current = queue.current.catch(() => {}).then(async () => {
      const result = await api(`/api/practical/attempts/${attemptId}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...snapshot, baseRevision: revisionRef.current }) });
      revisionRef.current = result.revision;
      setAttempt((prior) => prior ? { ...prior, revision: result.revision, answeredCount: result.answeredCount, cursor: payload.cursor } : prior);
      setSaveStatus('Saved on this site.'); setError('');
      const cached = readLocal(attemptId);
      if (cached) localStorage.setItem(localKey(attemptId), JSON.stringify({ ...cached, revision: result.revision }));
      return result;
    }).catch((err) => { if (err.message.includes('Another tab')) { conflictRef.current = true; setDraftConflict(true); }
      setSaveStatus(err instanceof TypeError ? 'Offline draft saved in this browser.' : 'Draft kept in this browser until valid.'); setError(err.message); throw err; });
    queue.current.catch(() => {});
    return queue.current;
  }
  function queueCurrentSave(nextCursor = latest.current.cursor) {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!attempt || attempt.status !== 'in_progress') return Promise.resolve();
    const id = attempt.questionIds[latest.current.cursor];
    return enqueue({ questionId: id, response: latest.current.responses[id] ?? null, flagged: Boolean(latest.current.flags[id]), cursor: nextCursor, elapsedSeconds: Math.min(1800, Math.round((Date.now() - itemEnteredAt.current) / 1000)) });
  }
  function changeResponse(value) {
    if (!attempt || attempt.status !== 'in_progress') return;
    const id = attempt.questionIds[cursor];
    const next = { ...latest.current.responses, [id]: value };
    setResponses(next); remember(next, latest.current.flags, cursor);
    setSaveStatus('Saving…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => queueCurrentSave().catch(() => {}), 420);
  }
  function toggleFlag() {
    if (!attempt || attempt.status !== 'in_progress') return;
    const id = attempt.questionIds[cursor];
    const next = { ...latest.current.flags, [id]: !latest.current.flags[id] };
    setFlags(next); remember(latest.current.responses, next, cursor);
    queueCurrentSave().catch(() => {});
  }
  function goTo(index) {
    if (!attempt || index < 0 || index >= attempt.itemCount) return;
    if (attempt.status === 'in_progress') {
      const from = latest.current.cursor;
      const id = attempt.questionIds[from];
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      remember(latest.current.responses, latest.current.flags, index);
      enqueue({ questionId: id, response: latest.current.responses[id] ?? null, flagged: Boolean(latest.current.flags[id]), cursor: index, elapsedSeconds: Math.min(1800, Math.round((Date.now() - itemEnteredAt.current) / 1000)) }).catch(() => {});
    }
    itemEnteredAt.current = Date.now();
    setHintOpen(false);
    setCursor(index); setShowResults(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function checkAnswer() {
    if (!attempt || attempt.status !== 'in_progress') return;
    const id = attempt.questionIds[cursor];
    try {
      await queueCurrentSave();
      const result = await jsonPost(`/api/practical/attempts/${attemptId}/check`, { questionId: id, response: latest.current.responses[id] ?? null, requestId: crypto.randomUUID(), baseRevision: revisionRef.current });
      revisionRef.current = result.revision;
      setAttempt((prior) => ({ ...prior, revision: result.revision, feedback: { ...prior.feedback, [id]: result.feedback } }));
      setError(''); setSaveStatus('Answer checked and saved.'); onComplete?.();
    } catch (err) { setError(err.message); }
  }
  async function submit() {
    if (!attempt || attempt.status !== 'in_progress' || submitting.current) return;
    const unanswered = attempt.questionIds.filter((id) => latest.current.responses[id] === null || latest.current.responses[id] === undefined).length;
    if (!window.confirm(`Submit this ${attempt.mode === 'exam' ? 'practice exam' : 'session'}? ${unanswered} questions are unanswered. Your answers will be graded and this attempt will close.`)) return;
    submitting.current = true;
    try {
      await queueCurrentSave(); await queue.current;
      const result = await jsonPost(`/api/practical/attempts/${attemptId}/submit`, { baseRevision: revisionRef.current });
      setAttempt(result.attempt); setShowResults(true); localStorage.removeItem(localKey(attemptId)); onComplete?.(); setError('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError(err.message); }
    finally { submitting.current = false; }
  }
  async function resolveDraft(useBrowser) {
    const cached = readLocal(attemptId);
    if (!window.confirm(useBrowser ? 'Replace this attempt’s server answers with the browser draft? This is an explicit overwrite.' : 'Discard this browser draft and use the server answers?')) return;
    try {
      const remote = (await api(`/api/practical/attempts/${attemptId}`)).attempt;
      if (useBrowser && remote.status !== 'in_progress') throw new Error('This attempt is finished. Export the browser draft for your records; finished results cannot be overwritten.');
      if (!useBrowser) { localStorage.removeItem(localKey(attemptId)); await load(); return; }
      revisionRef.current = remote.revision; conflictRef.current = false; setDraftConflict(false);
      setAttempt(remote); latest.current = { responses: cached.responses || {}, flags: cached.flags || {}, cursor: Math.min(remote.itemCount - 1, Math.max(0, cached.cursor || 0)) };
      setResponses(latest.current.responses); setFlags(latest.current.flags); setCursor(latest.current.cursor);
      remember(); await enqueue({ questionId: remote.questionIds[latest.current.cursor], cursor: latest.current.cursor, elapsedSeconds: 0 });
    } catch (err) { setError(err.message); }
  }
  function exportDraft() {
    const file = new Blob([JSON.stringify(readLocal(attemptId), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = `study-draft-${attemptId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function simulate(command) { return jsonPost('/api/practical/simulate', { attemptId, questionId: attempt.questionIds[cursor], command }); }
  async function testFlow(rules, flow) { return jsonPost('/api/practical/firewall/test', { attemptId, questionId: attempt.questionIds[cursor], rules, flow }); }

  if (!attempt) return <div className="practical-loading" role="status">{error || 'Loading your saved attempt…'}</div>;
  const item = attempt.items[cursor];
  const completed = attempt.status !== 'in_progress';
  const result = attempt.results?.[item.id];
  const feedback = completed ? result : attempt.feedback?.[item.id];
  const answered = attempt.questionIds.filter((id) => responses[id] !== undefined && responses[id] !== null && responses[id] !== '').length;
  const missedIds = completed ? attempt.questionIds.filter((id) => { const r = attempt.results?.[id]; return !r || r.earned < r.possible; }) : [];
  const missedSet = new Set(missedIds);
  const visibleIds = completed && reviewFilter === 'missed' ? missedIds : attempt.questionIds;
  const nextReviewIndex = () => { const after = visibleIds.find((id) => attempt.questionIds.indexOf(id) > cursor); return after === undefined ? -1 : attempt.questionIds.indexOf(after); };
  const prevReviewIndex = () => { const before = [...visibleIds].reverse().find((id) => attempt.questionIds.indexOf(id) < cursor); return before === undefined ? -1 : attempt.questionIds.indexOf(before); };
  function reviewMissed() { setReviewFilter('missed'); if (missedIds.length) goTo(attempt.questionIds.indexOf(missedIds[0])); }
  return <div className="exam-workspace">
    <>{draftConflict && <section className="practical-error" role="alert"><p>Your browser draft differs from saved server answers. It has been kept until you choose how to reconcile it.</p><button onClick={() => resolveDraft(false)}>Use server answers</button><button disabled={attempt.status !== 'in_progress'} onClick={() => resolveDraft(true)}>Use browser answers</button><button onClick={exportDraft}>Export browser draft</button></section>}</><div className="exam-topbar"><button className="plain-back" type="button" onClick={onBack}>← {attempt.mode === 'exam' ? 'Practice exams' : 'Practice by skill'}</button><div><strong>{attempt.title}</strong><span>Question {cursor + 1}/{attempt.itemCount}</span><span>Objective {item.objective_id || '—'}</span>{attempt.deadlineAt && <span className={now >= Date.parse(attempt.deadlineAt) ? 'time-low' : ''}>{timeLabel(attempt.deadlineAt, now)} remaining</span>}</div></div>
    {error && <div className="practical-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {completed && showResults && <section className="exam-result-summary"><div><small>{attempt.status === 'timed_out' ? 'Time limit reached' : 'Attempt complete'}</small><h1>{attempt.title} results</h1><strong>{attempt.score.percent}%</strong><p>{attempt.score.earned} of {attempt.score.possible} practice points. This percentage is not a CompTIA scaled score.</p></div><div className="result-breakdown"><span>Knowledge <b>{scoreLabel(attempt.score.roles.knowledge)}</b></span><span>Short practical <b>{scoreLabel(attempt.score.roles.short_interactive)}</b></span><span>Complex PBQ <b>{scoreLabel(attempt.score.roles.pbq)}</b></span></div><details><summary>Domain and objective gaps</summary><div className="result-gaps">{Object.entries(attempt.score.domains).map(([domain, score]) => <span key={domain}>Domain {domain}: {scoreLabel(score)}</span>)}{Object.entries(attempt.score.objectives).filter(([, score]) => score.earned < score.possible).slice(0, 15).map(([objective, score]) => <span key={objective}>Objective {objective}: {scoreLabel(score)}</span>)}</div></details><div className="result-review-actions"><button className="practical-primary" type="button" disabled={!missedIds.length} onClick={reviewMissed}>{missedIds.length ? `Review ${missedIds.length} missed question${missedIds.length === 1 ? '' : 's'}` : 'No missed questions'}</button><button type="button" onClick={() => { setReviewFilter('all'); setShowResults(false); }}>Review every question</button></div></section>}
    <div className="exam-layout"><div className="exam-main"><div className="exam-question-bar"><span>{item.question_kind === 'multiple_choice' ? 'Knowledge question' : item.question_kind === 'legacy_pbq' ? 'Original PBQ lab' : item.question_kind === 'pbq' ? 'Complex practical' : 'Short practical'}</span><div><button className={flags[item.id] ? 'flagged' : ''} type="button" disabled={completed} onClick={toggleFlag}>{flags[item.id] ? '⚑ Revisit marked' : '⚐ Mark to revisit'}</button><button type="button" onClick={() => onBookmark?.(item.id, !bookmarks[item.id])}>{bookmarks[item.id] ? '★ Bookmarked' : '☆ Bookmark'}</button></div></div><QuestionRenderer key={item.id} item={item} reviewContext={{ examId: attempt.examId || undefined, bankVersion: attempt.manifestVersion }} response={responses[item.id] ?? null} onChange={changeResponse} feedback={feedback} disabled={completed} onSimulate={simulate} onTestFlow={testFlow} />{!completed && attempt.mode === 'learning' && hintOpen && <div className="learning-hint" role="status"><strong>Study hint</strong><p>{item.interaction.type === 'simulated_cli' ? 'Identify the requested tool, allowed lab target, and exact flags before interpreting output.' : item.interaction.type === 'firewall_rules' ? 'Start with the narrowest allowed flow. Test neighboring sources, destinations, protocols, and ports.' : item.interaction.type === 'numeric' ? item.stimulus.formula_reference || 'Write the formula and units before calculating.' : item.interaction.type === 'text_entry' ? `Recall the complete expansion in the context of ${item.topic.replaceAll('_', ' ')}.` : 'Use the scenario evidence and objective to eliminate unsupported choices.'}</p></div>}<div className="exam-actions"><span aria-live="polite">{saveStatus}</span><div><button type="button" onClick={() => goTo(completed ? prevReviewIndex() : cursor - 1)} disabled={completed ? prevReviewIndex() < 0 : cursor === 0}>Previous</button>{!completed && attempt.mode === 'learning' && <button type="button" onClick={() => setHintOpen(true)} disabled={hintOpen}>Hint</button>}{!completed && attempt.mode === 'learning' && <button type="button" onClick={checkAnswer}>Check answer</button>}{!completed && <button type="button" onClick={() => goTo(Math.min(attempt.itemCount - 1, cursor + 1))} disabled={cursor === attempt.itemCount - 1}>Skip / Save & next</button>}{completed && <button type="button" onClick={() => goTo(nextReviewIndex())} disabled={nextReviewIndex() < 0}>{reviewFilter === 'missed' ? 'Next missed' : 'Next review'}</button>}{!completed && <button className="practical-primary" type="button" onClick={submit}>Submit {attempt.mode === 'exam' ? 'exam' : 'session'}</button>}</div></div></div><aside className="question-navigator"><div><strong>Question navigator</strong><small>{completed ? `${attempt.itemCount - missedIds.length} of ${attempt.itemCount} fully correct` : `${answered} of ${attempt.itemCount} answered`}</small></div>{completed && <div className="review-filter" role="group" aria-label="Review filter"><button type="button" className={reviewFilter === 'all' ? 'active' : ''} aria-pressed={reviewFilter === 'all'} onClick={() => setReviewFilter('all')}>All</button><button type="button" className={reviewFilter === 'missed' ? 'active' : ''} aria-pressed={reviewFilter === 'missed'} onClick={reviewMissed}>Missed only ({missedIds.length})</button></div>}<div className="question-grid">{visibleIds.map((id) => { const index = attempt.questionIds.indexOf(id); const missed = completed && missedSet.has(id); return <button type="button" aria-label={`Question ${index + 1}${flags[id] ? ', flagged' : ''}${completed ? missed ? ', missed' : ', correct' : responses[id] !== undefined ? ', answered' : ''}`} aria-current={index === cursor ? 'step' : undefined} className={`${index === cursor ? 'current' : ''} ${completed ? missed ? 'missed' : 'correct' : responses[id] !== undefined ? 'answered' : ''} ${flags[id] ? 'flagged' : ''}`} onClick={() => goTo(index)} key={id}>{index + 1}</button>; })}</div>{completed && reviewFilter === 'missed' && !missedIds.length && <p>Every question earned full credit.</p>}<p>{completed ? <><span className="nav-legend correct" /> Correct <span className="nav-legend missed" /> Missed</> : <><span className="nav-legend answered" /> Answered</>} <span className="nav-legend flagged" /> Flagged</p></aside></div>
  </div>;
}
