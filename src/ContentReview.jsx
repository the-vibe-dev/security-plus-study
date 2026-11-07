import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { REVIEW_KEY, REASONS, STATUSES, OUTCOMES, contentIdentity, contentSnapshot, reviewId, readReviews, saveReview, exportReviews } from './contentReviewStore.js';
import './content-review.css';

const ReviewContext = createContext({ records: [], error: '', save: () => { throw new Error('Review storage is unavailable.'); } });
export function ContentReviewProvider({ children, storage }) {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  const getStorage = () => storage || window.localStorage;
  useEffect(() => {
    function reload(event) {
      if (event && event.key !== REVIEW_KEY && event.key !== null) return;
      try { setRecords(readReviews(getStorage())); setError(''); }
      catch (err) { setError(err.message); }
    }
    reload(); window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, [storage]);
  function save(input) {
    const next = saveReview(getStorage(), input);
    setRecords(next); setError('');
  }
  return <ReviewContext.Provider value={{ records, error, save }}>{children}</ReviewContext.Provider>;
}

function ReviewForm({ initial, onSave, onCancel, editing = false }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const titleId = useId();
  const firstField = useRef(null);
  useEffect(() => { firstField.current?.focus(); }, []);
  function field(key) { return { value: draft[key] || '', onChange: (event) => setDraft((prior) => ({ ...prior, [key]: event.target.value })) }; }
  return <form className="content-review-form" aria-labelledby={titleId} onSubmit={(event) => {
    event.preventDefault();
    try { onSave(draft); } catch (err) { setError(err.message); }
  }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}>
    <h3 id={titleId}>{editing ? 'Edit human review' : `Flag ${draft.target === 'explanation' ? 'explanation / answer key' : 'question / scenario'}`}</h3>
    <p>Save a concern to Human Review. This is separate from marking a question to revisit during an attempt.</p>
    <label>Reason<select ref={firstField} required {...field('reason')}><option value="">Choose a reason</option>{Object.entries(REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Concern or task ID<textarea rows="3" maxLength={4000} placeholder="What seems wrong? For a PBQ, include the task ID. Avoid private or copyrighted training material." {...field('note')} /></label>
    <label>Reference to check (optional)<input maxLength={2000} placeholder="Course/module, instructor note, book/page, or public URL" {...field('reference')} /></label>
    {editing && <>
      <label>Review status<select {...field('status')}>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Review outcome<select required={draft.status === 'resolved'} {...field('outcome')}><option value="">Choose after checking</option>{Object.entries(OUTCOMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Review notes / proposed correction<textarea rows="3" maxLength={4000} required={draft.status === 'resolved'} placeholder="Record what you verified and the supporting reference. Resolving does not change the question bank." {...field('resolution')} /></label>
    </>}
    <p className="content-review-privacy">Stored only in this browser for this site. Nothing is sent to an instructor or third party. Export before clearing browser data or switching devices.</p>
    {error && <p role="alert" className="content-review-error">{error}</p>}
    <div className="content-review-actions"><button type="submit">Save {editing ? 'review' : 'flag'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

export function FlagContent({ item, source = 'practical', feedback = null, target = 'question' }) {
  const { records, error, save } = useContext(ReviewContext);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const button = useRef(null);
  const identity = contentIdentity(item, source);
  const id = reviewId(identity, target);
  const existing = records.find((record) => record.id === id);
  useEffect(() => { setOpen(false); setNotice(''); }, [id]);
  if (target === 'explanation' && !feedback) return null;
  const initial = existing || {
    ...identity, target, title: String(item.prompt || item.question || item.title || item.id).slice(0, 2000),
    snapshot: contentSnapshot(item, source, target === 'explanation' ? feedback : null),
    reason: '', note: '', reference: '', status: 'open', outcome: '', resolution: '',
  };
  function close() { setOpen(false); button.current?.focus(); }
  return <div className="content-flag">
    <button ref={button} className="content-flag-button" type="button" aria-expanded={open} onClick={() => { setOpen((value) => !value); setNotice(''); }}>{existing ? `Content ${STATUSES[existing.status].toLowerCase()} · Edit flag` : target === 'explanation' ? '⚑ Flag explanation / answer key' : '⚑ Flag content'}</button>
    {open && <ReviewForm key={id} initial={initial} editing={Boolean(existing)} onCancel={close} onSave={(draft) => { save(draft); close(); setNotice('Saved in this browser. Find it in Human Review.'); }} />}
    {notice && <p role="status">{notice}</p>}
    {error && open && <p role="alert" className="content-review-error">{error}</p>}
  </div>;
}

function ReviewCard({ record, save }) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const button = useRef(null);
  function close() { setEditing(false); button.current?.focus(); }
  return <article className="content-review-card">
    <div className="content-review-meta"><strong>{STATUSES[record.status]}</strong><span>{record.itemId} · {record.source} · {record.target}</span></div>
    <h2>{record.title}</h2><p><strong>{REASONS[record.reason]}</strong></p>
    {record.note && <p className="content-review-text">{record.note}</p>}
    {record.reference && <p className="content-review-text"><strong>Reference:</strong> {record.reference}</p>}
    {record.outcome && <p><strong>Outcome:</strong> {OUTCOMES[record.outcome]}</p>}
    {record.resolution && <p className="content-review-text"><strong>Review notes:</strong> {record.resolution}</p>}
    <small>Flagged {new Date(record.createdAt).toLocaleString()} · Updated {new Date(record.updatedAt).toLocaleString()}</small>
    <details><summary>Captured content at time of flag</summary><pre>{JSON.stringify(record.snapshot, null, 2)}</pre></details>
    <button ref={button} type="button" aria-expanded={editing} onClick={() => { setEditing((value) => !value); setNotice(''); }}>Edit / {record.status === 'resolved' ? 'reopen' : 'resolve'} review</button>
    {editing && <ReviewForm initial={record} editing onCancel={close} onSave={(draft) => { save(draft); close(); setNotice('Review saved in this browser.'); }} />}
    {notice && <p role="status">{notice}</p>}
  </article>;
}

export function HumanReviewQueue() {
  const { records, error, save } = useContext(ReviewContext);
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const visible = records.filter((record) => (status === 'all' || (status === 'active' ? record.status !== 'resolved' : record.status === status)) && `${record.itemId} ${record.title} ${record.note} ${record.reference}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  function download() {
    try {
      const blob = new Blob([exportReviews(visible)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `security-plus-human-review-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Download requested for ${visible.length} reviews. Check the file before sharing it.`);
    } catch (err) { setNotice(`Export failed: ${err.message}`); }
  }
  return <section className="content-review-queue" aria-labelledby="human-review-title">
    <div className="practical-page-header page-heading"><h1 id="human-review-title">Human Review</h1><p>Check concerns against instructor-led training, Skillsoft, exam objectives, or trusted documentation. A flag is a question to investigate, not proof of an error.</p></div>
    <p className="content-review-privacy">Only in this browser, on this site. Export creates a local JSON file with your notes, references, and captured content. Review it before sharing, especially for private imports. No answers you entered, scores, or attempt IDs are added automatically. Resolving records a review; it does not correct the source content.</p>
    {error && <p role="alert" className="content-review-error">{error}</p>}
    <div className="content-review-toolbar">
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Open + in review</option><option value="all">All statuses</option>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Search reviews<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Item ID, question, note, reference" /></label>
      <button type="button" disabled={!visible.length || Boolean(error)} onClick={download}>Export {visible.length} shown {visible.length === 1 ? 'review' : 'reviews'} (JSON)</button>
    </div>
    <p aria-live="polite">{visible.length} shown · {records.filter((record) => record.status !== 'resolved').length} awaiting review · {records.filter((record) => record.status === 'resolved').length} resolved</p>
    {notice && <p role="status">{notice}</p>}
    {!visible.length && <p className="content-review-empty">{records.length ? 'No reviews match these filters.' : 'No content flags yet. Use “Flag content” on any question or PBQ, or “Flag explanation / answer key” after feedback is shown.'}</p>}
    {visible.map((record) => <ReviewCard key={record.id} record={record} save={save} />)}
  </section>;
}
