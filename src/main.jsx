import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, jsonPost } from './api.js';
import { DOMAINS, domainName } from './domains.js';
import { Icon } from './icons.jsx';
import { QuizView } from './QuizView.jsx';
import { PbqView } from './PbqView.jsx';
import { Dashboard } from './Dashboard.jsx';
import { ContentReviewProvider, HumanReviewQueue } from './ContentReview.jsx';
import { PracticalApp } from './PracticalApp.jsx';
import { practiceScore } from './practiceScore.js';
import { readSessionStore, saveSessionStore } from './sessionStore.js';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import './styles.css';
import './security-pack.css';
import './redesign.css';
import './quiz-results.css';

const initialSessions = readSessionStore();
function shuffled(items) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function countLabel(value, singular, plural = `${singular}s`) { return `${value} ${value === 1 ? singular : plural}`; }
function setLabel(set) { return set.id === 'security-plus-sy0-701' ? 'Test Prep 1' : set.name; }

function App() {
  const [tab, setTab] = useState('overview');
  const [questions, setQuestions] = useState([]);
  const [pbqs, setPbqs] = useState([]);
  const [sets, setSets] = useState([]);
  const [practiceSets, setPracticeSets] = useState([]);
  const [progress, setProgress] = useState({ answers: {}, pbqs: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [selectedSet, setSelectedSet] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [objectiveFilter, setObjectiveFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [pbqDomainFilter, setPbqDomainFilter] = useState('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [session, setSession] = useState(initialSessions.at(-1) || null);
  const [savedSessions, setSavedSessions] = useState(initialSessions);
  const [submitting, setSubmitting] = useState(false);
  const [activePbqId, setActivePbqId] = useState(null);
  const [pbqBusy, setPbqBusy] = useState(false);
  const fileInput = useRef(null);
  const searchInput = useRef(null);
  const saveQueue = useRef(Promise.resolve());

  async function refresh() {
    const [libraryData, questionData, pbqData, practiceData, progressData] = await Promise.all([
      api('/api/library'), api('/api/questions'), api('/api/pbqs'), api('/api/practice-sets'), api('/api/progress'),
    ]);
    setSets(libraryData.sets);
    setQuestions(questionData.questions);
    setPbqs(pbqData.pbqs);
    setPracticeSets(practiceData.sets);
    setProgress(progressData);
  }
  useEffect(() => { refresh().catch((err) => setError(err.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!session) return;
    setSavedSessions((previous) => [...previous.filter((item) => item.id !== session.id), session].slice(-80));
  }, [session]);
  useEffect(() => { saveSessionStore(localStorage, savedSessions); }, [savedSessions]);

  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const pbqById = useMemo(() => new Map(pbqs.map((pbq) => [pbq.id, pbq])), [pbqs]);
  const scopedQuestions = useMemo(() => selectedSet === 'all' ? questions : questions.filter((question) => question.setId === selectedSet), [questions, selectedSet]);
  const visiblePbqs = useMemo(() => pbqs.filter((pbq) => (selectedSet === 'all' || pbq.setId === selectedSet) && (pbqDomainFilter === 'all' || String(pbq.primary_domain) === pbqDomainFilter)), [pbqs, selectedSet, pbqDomainFilter]);
  const visiblePracticeSets = useMemo(() => practiceSets.filter((practice) => selectedSet === 'all' || practice.subjectId === selectedSet), [practiceSets, selectedSet]);
  const filteredQuestions = useMemo(() => scopedQuestions.filter((question) => (domainFilter === 'all' || domainName(question.domain) === domainFilter) && (objectiveFilter === 'all' || question.objective === objectiveFilter) && (difficultyFilter === 'all' || question.difficulty === difficultyFilter)), [scopedQuestions, domainFilter, objectiveFilter, difficultyFilter]);
  const objectives = useMemo(() => [...new Set(scopedQuestions.filter((question) => domainFilter === 'all' || domainName(question.domain) === domainFilter).map((question) => question.objective).filter(Boolean))].sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b)), [scopedQuestions, domainFilter]);
  const currentIds = new Set(questions.map((question) => question.id));
  const answered = Object.entries(progress.answers || {}).filter(([id]) => currentIds.has(id)).map(([, answer]) => answer);
  const attempts = answered.reduce((sum, answer) => sum + answer.attempts, 0);
  const correct = answered.reduce((sum, answer) => sum + answer.correct, 0);
  const missed = scopedQuestions.filter((question) => progress.answers?.[question.id]?.lastCorrect === false);
  const pbqCompleted = pbqs.filter((pbq) => progress.pbqs?.[pbq.id]?.submitted);
  const pbqNeedsReview = pbqCompleted.filter((pbq) => progress.pbqs[pbq.id].result?.points < progress.pbqs[pbq.id].result?.possible);
  const currentQuestion = session ? questionById.get(session.questionIds[session.index]) : null;
  const activePbq = activePbqId ? pbqById.get(activePbqId) : null;
  const latestPracticeSessions = useMemo(() => Object.fromEntries(practiceSets.map((practice) => [practice.id, savedSessions.filter((item) => item.practiceSetId === practice.id).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0]])), [practiceSets, savedSessions]);
  const unfinishedDrills = savedSessions.filter((item) => !item.done && item.mode !== 'practice-set').slice(-5).reverse();
  const completedSessions = savedSessions.filter((item) => item.done).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  function navigate(destination) {
    setTab(destination);
    setError('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function submitGlobalSearch(event) {
    event.preventDefault();
    setLibrarySearch(globalSearch.trim());
    setSearchOpen(false);
    navigate('library');
  }
  function startSession(mode, pool, title, practice = null) {
    if (!pool.length) { setNotice('No questions match this selection. Import questions or change your filters.'); setTab('practice'); return; }
    const chosen = mode === 'practice-set' ? pool : shuffled(pool).slice(0, 10);
    const choiceOrder = Object.fromEntries(chosen.map((question) => [question.id, shuffled(question.choices.map((choice) => choice.id))]));
    setSession({ id: crypto.randomUUID(), mode, title, practiceSetId: practice?.id || null, pbqIds: practice?.pbq_ids || [], questionIds: chosen.map((question) => question.id), choiceOrder, index: 0, selectedIds: [], pendingAnswer: null, feedback: null, feedbackCorrect: false, correctCount: 0, answeredCount: 0, startedAt: Date.now(), timeLimitMinutes: practice?.time_limit_minutes || null, done: false, expired: false });
    setNotice('');
    setError('');
    setTab('session');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function resumeSession(saved) {
    setSession(saved);
    setError('');
    setNotice('');
    setTab('session');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function startPracticeSet(practice) {
    const unfinished = savedSessions.filter((item) => item.practiceSetId === practice.id && !item.done).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
    if (unfinished) { resumeSession(unfinished); return; }
    const pool = practice.quiz_ids.map((id) => questionById.get(id)).filter(Boolean);
    if (pool.length !== practice.quiz_ids.length) { setError('Some practice-set questions are missing from the library.'); return; }
    startSession('practice-set', pool, practice.title, practice);
  }
  function selectAnswer(id, multi) {
    setSession((current) => {
      if (!current || current.feedback || current.pendingAnswer) return current;
      const selected = current.selectedIds || [];
      if (!multi) return { ...current, selectedIds: [id] };
      const limit = questionById.get(current.questionIds[current.index])?.selectCount || 1;
      const next = selected.includes(id) ? selected.filter((value) => value !== id) : selected.length < limit ? [...selected, id] : selected;
      return { ...current, selectedIds: next };
    });
  }
  async function submitAnswer() {
    if (!session || !currentQuestion || submitting || session.selectedIds.length !== currentQuestion.selectCount) return;
    setSubmitting(true);
    setError('');
    try {
      const answer = session.pendingAnswer || { id: currentQuestion.id, selectedIds: [...session.selectedIds], requestId: `${session.id || session.startedAt}:${session.index}:${currentQuestion.id}` };
      if (!session.pendingAnswer) setSession((current) => ({ ...current, pendingAnswer: answer }));
      let result;
      try { result = await jsonPost('/api/answer', answer); }
      catch (err) {
        if (!(err instanceof TypeError)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300));
        result = await jsonPost('/api/answer', answer);
      }
      setProgress((previous) => ({ ...previous, answers: { ...previous.answers, [currentQuestion.id]: result.progress } }));
      setSession((current) => ({ ...current, pendingAnswer: null, feedback: result.feedback, feedbackCorrect: result.correct, correctCount: current.correctCount + Number(result.correct), answeredCount: current.answeredCount + 1 }));
    } catch (err) { setError(err instanceof TypeError ? 'Connection interrupted. Your answer is held; select Retry answer.' : err.message); }
    finally { setSubmitting(false); }
  }
  function nextQuestion() {
    setSession((current) => current.index === current.questionIds.length - 1 ? { ...current, done: true } : { ...current, index: current.index + 1, selectedIds: [], pendingAnswer: null, feedback: null, feedbackCorrect: false });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const timeUp = useCallback(() => setSession((current) => current && !current.expired ? { ...current, expired: true } : current), []);
  function leaveSession() { setSession(null); navigate('practice'); }

  function openPbq(id) { setActivePbqId(id); navigate('pbq'); }
  function savePbqResponse(taskId, response) {
    if (!activePbqId) return Promise.resolve();
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => jsonPost('/api/pbq/response', { pbqId: activePbqId, taskId, response })).then(({ attempt }) => setProgress((previous) => ({ ...previous, pbqs: { ...previous.pbqs, [activePbqId]: attempt } }))).catch((err) => setError(err.message));
    return saveQueue.current;
  }
  async function submitPbq(responses) {
    if (!activePbqId || pbqBusy) return;
    setPbqBusy(true);
    try {
      await saveQueue.current;
      const { attempt } = await jsonPost('/api/pbq/submit', { pbqId: activePbqId, responses });
      setProgress((previous) => ({ ...previous, pbqs: { ...previous.pbqs, [activePbqId]: attempt } }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError(err.message); }
    finally { setPbqBusy(false); }
  }
  async function resetPbq() {
    if (!activePbqId || pbqBusy || !window.confirm('Start a new attempt? Your previous PBQ responses and task result will be replaced.')) return;
    setPbqBusy(true);
    try {
      const { attempt } = await jsonPost('/api/pbq/reset', { pbqId: activePbqId });
      setProgress((previous) => ({ ...previous, pbqs: { ...previous.pbqs, [activePbqId]: attempt } }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError(err.message); }
    finally { setPbqBusy(false); }
  }
  async function importFile(file) {
    if (!file) return;
    setImporting(true); setError(''); setNotice('');
    try {
      const result = await api('/api/import', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' }, body: await file.arrayBuffer() });
      await refresh();
      setNotice(`Imported ${result.set.count} quiz questions and ${result.set.pbqCount} PBQs from ${result.set.name}.`);
      setTab('library');
    } catch (err) { setError(err.message); }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function deleteSet(id, name) {
    if (!window.confirm(`Remove “${name}” and its study progress?`)) return;
    try {
      await api('/api/library', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      if (selectedSet === id) setSelectedSet('all');
      const removedIds = new Set(questions.filter((question) => question.setId === id).map((question) => question.id));
      setSavedSessions((previous) => previous.filter((item) => !item.questionIds.some((questionId) => removedIds.has(questionId))));
      setSession(null);
      setActivePbqId(null);
      await refresh();
      setNotice('Question set and its progress removed.');
    } catch (err) { setError(err.message); }
  }

  const importButton = <button className="button primary" type="button" disabled={importing} onClick={() => fileInput.current?.click()}><Icon name="upload" size={17} />{importing ? 'Importing…' : 'Import question file'}</button>;
  const navItems = [['overview', 'Overview', 'home'], ['practice', 'Practice', 'file'], ['pbqs', 'PBQs', 'pbq'], ['review', 'Review', 'review'], ['library', 'Library', 'library'], ['human-review', 'Human Review', 'review']];
  const activeNav = tab === 'session' ? 'practice' : tab === 'pbq' ? 'pbqs' : tab;
  const currentPageLabel = tab === 'session' ? session?.title || 'Practice session' : tab === 'pbq' ? activePbq?.title || 'PBQ' : { overview: 'Overview', practice: 'Practice', pbqs: 'Performance-based questions', review: 'Review', library: 'Library', 'human-review': 'Human Review', settings: 'Settings' }[tab] || 'Overview';
  return <>
    <div className="app-frame">
      <aside className="study-sidebar" aria-label="Site navigation">
        <button className="sidebar-brand" onClick={() => navigate('overview')}><img src="/brand-mark-inverse.svg" alt="" /><span><strong>Security+ Study</strong><small>SY0-701</small></span></button>
        <nav className="sidebar-nav" aria-label="Main navigation">{navItems.map(([key, label, icon]) => <button key={key} className={activeNav === key ? 'active' : ''} aria-current={activeNav === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon name={icon} size={21} /><span>{label}</span></button>)}</nav>
        <div className="sidebar-bottom"><button className={activeNav === 'settings' ? 'active' : ''} aria-current={activeNav === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Icon name="settings" size={21} />Settings</button><div className="sidebar-note"><strong>{questions.length} questions · {pbqs.length} PBQs</strong><span>Progress saves automatically.</span></div></div>
      </aside>
      <div className="workspace">
        <header className="mobile-header"><button className="mobile-brand" onClick={() => navigate('overview')}><img src="/brand-mark.svg" alt="" /><span>Security+ Study</span></button><div><button aria-label="Search questions" onClick={() => { setSearchOpen((value) => !value); setTimeout(() => searchInput.current?.focus(), 0); }}><Icon name="search" size={20} /></button><button aria-label="Settings" onClick={() => navigate('settings')}><Icon name="settings" size={21} /></button></div></header>
        <header className={`utility-bar ${searchOpen ? 'search-open' : ''}`}><form className="global-search" role="search" onSubmit={submitGlobalSearch}><Icon name="search" size={18} /><input ref={searchInput} aria-label="Search question library" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search questions or topics" /><button type="submit" aria-label="Search"><Icon name="arrow" size={17} /></button></form><div className="utility-context"><span>Security+ SY0-701</span><Icon name="arrow" size={14} /><strong>{currentPageLabel}</strong></div></header>
    <main className="main-shell">
      {error && <div className="message error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="message success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
      {loading ? <div className="loading">Loading your study space…</div> : <>
        {tab === 'overview' && <Dashboard questions={questions} pbqs={pbqs} practiceSets={practiceSets} answered={answered} attempts={attempts} correct={correct} pbqCompleted={pbqCompleted} missed={missed} session={session} savedSessions={savedSessions} completedSessions={completedSessions} pbqProgress={progress.pbqs} onResume={resumeSession} onNavigate={navigate} onStartMixed={() => startSession('mixed', scopedQuestions, 'Mixed practice')} onStartReview={() => startSession('missed', missed, 'Missed questions')} onChooseDomain={(domain) => { setDomainFilter(domain); setObjectiveFilter('all'); navigate('practice'); }} />}
        {tab === 'practice' && <><div className="page-heading"><h1>Practice</h1><p>Choose a focused drill or work through a supplied practice set.</p></div><div className="filter-grid"><label>Question set<select value={selectedSet} onChange={(event) => setSelectedSet(event.target.value)}><option value="all">All imported sets</option>{sets.map((set) => <option key={set.id} value={set.id}>{setLabel(set)}</option>)}</select></label><label>Domain<select value={domainFilter} onChange={(event) => { setDomainFilter(event.target.value); setObjectiveFilter('all'); }}><option value="all">All domains</option>{DOMAINS.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select></label><label>Objective<select value={objectiveFilter} onChange={(event) => setObjectiveFilter(event.target.value)}><option value="all">All objectives</option>{objectives.map((objective) => <option key={objective} value={objective}>{objective}</option>)}</select></label><label>Difficulty<select value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)}><option value="all">All difficulties</option>{['foundational', 'intermediate', 'advanced'].map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty}</option>)}</select></label></div><div className="practice-feature"><div><h2>Focused question drill</h2><p>{countLabel(filteredQuestions.length, 'question')} match your filters. A drill uses up to 10 questions and shows reasoning after each answer.</p></div><button className="button primary" disabled={!filteredQuestions.length} onClick={() => startSession('drill', filteredQuestions, 'Focused drill')}>Start drill <Icon name="arrow" size={17} /></button></div>{unfinishedDrills.length > 0 && <section className="quiz-history-section"><div className="section-heading"><h2>Unfinished drills</h2><p>Pick up where you stopped.</p></div><div className="quiz-history-list">{unfinishedDrills.map((draft) => <button key={draft.id} onClick={() => resumeSession(draft)}><span><strong>{draft.title}</strong><small>{draft.answeredCount || 0} of {draft.questionIds.length} answered</small></span><span>Resume →</span></button>)}</div></section>}<div className="section-heading practice-domains"><h2>Practice by domain</h2><p>Select a domain to begin a 10-question drill.</p></div><div className="domain-choices">{DOMAINS.map((domain) => { const pool = scopedQuestions.filter((item) => domainName(item.domain) === domain); return <button key={domain} disabled={!pool.length} onClick={() => startSession('domain', pool, domain)}><span><strong>{domain}</strong><small>{pool.length ? countLabel(pool.length, 'question') : 'No questions imported for this domain'}</small></span><Icon name="arrow" size={18} /></button>; })}</div>
          {visiblePracticeSets.length > 0 && <section className="practice-set-section"><div className="section-heading"><h2>Practice sets</h2><p>Each supplied set has 85 quiz questions and five linked PBQs. Finish the quiz section to see an exam-style estimate; it updates as you submit PBQs. You can reopen unfinished quizzes.</p></div><div className="practice-set-list">{visiblePracticeSets.map((practice) => { const saved = latestPracticeSessions[practice.id]; const score = saved && practiceScore(saved, progress.pbqs); return <div className="practice-set-card" key={practice.id}><div><h3>{practice.title}</h3><p>85 quiz questions · 5 PBQs · 90-minute benchmark</p>{saved && <p className="practice-set-status">{saved.done ? `${score.quiz.percent}% quiz · ${score.pbqPercent}% PBQ credit (${score.pbqsDone}/${score.pbqsTotal} submitted) · ${score.index}/900 exam-style estimate${score.provisional ? " (provisional)" : ""}` : `${saved.answeredCount || 0}/${saved.questionIds.length} quiz questions answered · Resume any time`}</p>}</div><div className="practice-card-actions"><button className="button secondary" onClick={() => saved ? resumeSession(saved) : startPracticeSet(practice)}>{saved ? saved.done ? "View results" : "Resume quiz" : "Start quiz"}</button>{saved?.done && <button className="text-link" onClick={() => { const pool = practice.quiz_ids.map((id) => questionById.get(id)).filter(Boolean); startSession("practice-set", pool, practice.title, practice); }}>New attempt</button>}</div><div className="practice-pbq-links">{practice.pbq_ids.map((id) => <button key={id} onClick={() => openPbq(id)}>{id}: {pbqById.get(id)?.title || 'PBQ'} <Icon name="arrow" size={14} /></button>)}</div></div>; })}</div></section>}
          {!questions.length && <div className="empty-note">Import your question ZIP to start practicing. <button onClick={() => navigate('library')}>Open library</button></div>}</>}
        {tab === 'pbqs' && <><div className="page-heading"><h1>Performance-based practice</h1><p>Read each scenario and exhibit, complete the tasks, then submit to see task-level feedback.</p></div><div className="toolbar"><label htmlFor="pbq-set">Study set</label><select id="pbq-set" value={selectedSet} onChange={(event) => setSelectedSet(event.target.value)}><option value="all">Both test preps</option>{sets.map((set) => <option key={set.id} value={set.id}>{setLabel(set)}</option>)}</select><label htmlFor="pbq-domain">Domain</label><select id="pbq-domain" value={pbqDomainFilter} onChange={(event) => setPbqDomainFilter(event.target.value)}><option value="all">All domains</option>{DOMAINS.map((domain, index) => <option key={domain} value={String(index + 1)}>{domain}</option>)}</select><span>{countLabel(visiblePbqs.length, 'PBQ')} match your filters</span></div>{visiblePbqs.length ? <div className="pbq-list">{visiblePbqs.map((pbq) => { const attempt = progress.pbqs?.[pbq.id]; return <button key={pbq.id} onClick={() => openPbq(pbq.id)}><span className="pbq-list-id">{pbq.id}</span><span><strong>{pbq.title}</strong><small>Domain {pbq.primary_domain} · Objectives {pbq.objective_ids.join(', ')} · {pbq.difficulty} · {pbq.tasks.length} tasks</small></span><em>{attempt?.submitted ? `${attempt.result.points}/${attempt.result.possible} task points` : attempt?.responses && Object.keys(attempt.responses).length ? 'In progress' : 'Start'}</em><Icon name="arrow" size={18} /></button>; })}</div> : <div className="empty-note">{pbqs.length ? "No PBQs match these filters." : "PBQs will appear here after you import the Security+ study pack."}</div>}</>}
        {tab === 'review' && <><div className="page-heading"><h1>Review missed questions</h1><p>Return to questions you last answered incorrectly and check your understanding.</p></div><div className="review-summary"><div><strong>{missed.length}</strong><span>quiz questions to review</span></div><button className="button primary" disabled={!missed.length} onClick={() => startSession('missed', missed, 'Missed questions')}>Start review <Icon name="arrow" size={17} /></button></div>{missed.length ? <div className="review-list">{missed.map((question) => <div key={question.id}><span>{question.objective ? `Objective ${question.objective} · ` : ''}{domainName(question.domain)}</span><strong>{question.question}</strong></div>)}</div> : <div className="empty-note">Missed questions will appear here after you practice.</div>}{pbqNeedsReview.length > 0 && <><div className="section-heading review-pbq-heading"><h2>PBQs to revisit</h2><p>These cases have tasks to review.</p></div><div className="pbq-list">{pbqNeedsReview.map((pbq) => <button key={pbq.id} onClick={() => openPbq(pbq.id)}><span className="pbq-list-id">{pbq.id}</span><span><strong>{pbq.title}</strong><small>{progress.pbqs[pbq.id].result.points} of {progress.pbqs[pbq.id].result.possible} task points</small></span><Icon name="arrow" size={18} /></button>)}</div></>}</>}
        {tab === 'library' && <><div className="page-heading"><h1>Question library</h1><p>Import and manage the question sets you use for practice.</p></div><div className="import-panel"><div><h2>Add a study pack</h2><p>Upload the Security+ ZIP to include all quiz questions, PBQs, and practice sets. Generic CSV or JSON multiple-choice files are also supported.</p></div>{importButton}</div>{sets.length ? <><div className="section-heading library-heading"><h2>Imported sets</h2><p>{countLabel(questions.length, 'quiz question')} · {countLabel(pbqs.length, 'PBQ')} across {countLabel(sets.length, 'set')}.</p></div><div className="set-list">{sets.map((set) => <div className="set-row" key={set.id}><span className="set-icon"><Icon name="file" /></span><div><strong>{setLabel(set)}</strong><small>{set.count} quiz questions · {set.pbqCount} PBQs · {set.practiceSetCount} practice sets · Imported {new Date(set.importedAt).toLocaleDateString()}</small><small>{set.files.map((file) => file.name).join(', ')}</small></div><button onClick={() => deleteSet(set.id, set.name)}>Remove</button></div>)}</div><div className="section-heading question-heading"><h2>Browse questions</h2><p>Search the bank by question text or topic. Answers stay hidden until you submit a practice response.</p></div><div className="library-search-bar"><input className="search-input" aria-label="Search questions" placeholder="Search question text or topic" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} /><select aria-label="Filter questions by study set" value={selectedSet} onChange={(event) => setSelectedSet(event.target.value)}><option value="all">Both test preps</option>{sets.map((set) => <option key={set.id} value={set.id}>{setLabel(set)}</option>)}</select></div><div className="question-preview">{questions.filter((item) => (selectedSet === 'all' || item.setId === selectedSet) && `${item.question} ${item.topic}`.toLowerCase().includes(librarySearch.toLowerCase())).slice(0, 40).map((item) => <div key={`${item.setId}-${item.id}`}><span>{item.id} · {item.objective ? `Objective ${item.objective} · ` : ''}{domainName(item.domain)}{item.selectCount > 1 ? ` · Select ${item.selectCount}` : ''}</span><strong>{item.question}</strong></div>)}</div></> : <div className="empty-note">Your library is empty. Import your first question set above.</div>}</>}
        {tab === 'human-review' && <HumanReviewQueue />}
        {tab === 'settings' && <><div className="page-heading"><h1>Settings</h1><p>Your study data is stored on this site.</p></div><div className="settings-card"><h2>Study approach</h2><p>Focused drills use up to 10 questions. The Security+ pack includes 300 quiz items and 25 PBQs. Quiz answers use exact-set grading. PBQ tasks award practice points separately after submission.</p><h2>Import format</h2><p>The Security+ ZIP contains all required data. Generic CSV files can use <code>question</code>, <code>option_a</code> through <code>option_f</code>, and <code>correct_option</code>. JSON can use a <code>questions</code> array.</p><h2>Practice scoring</h2><p>Quiz accuracy uses exact-set grading. Each of the five PBQs is graded from its task points, then the five PBQ percentages are averaged. Our exam-style estimate weights quiz accuracy 75% and PBQ accuracy 25%, then maps that blend to 100–900: 100 + 800 × (0.75 × quiz accuracy + 0.25 × PBQ accuracy). With 85 quiz questions and five PBQs, this treats each PBQ as roughly 5.7 quiz questions, not as eight independent exam questions. The 25% weight and linear conversion are our best guesses, not CompTIA rules. CompTIA publishes 750 as the SY0-701 passing score but keeps item weights and its scoring conversion confidential. Use the estimate as a study guide, not a pass prediction.</p></div></>}
        {tab === 'session' && session && <QuizView session={session} question={currentQuestion} submitting={submitting} onSelect={selectAnswer} onSubmit={submitAnswer} onNext={nextQuestion} onLeave={leaveSession} onTimeUp={timeUp} practicePbqs={session.pbqIds.map((id) => pbqById.get(id)).filter(Boolean)} pbqProgress={progress.pbqs} onOpenPbq={openPbq} />}
        {tab === 'pbq' && activePbq && <PbqView pbq={activePbq} attempt={progress.pbqs?.[activePbq.id]} busy={pbqBusy} onSave={savePbqResponse} onSubmit={submitPbq} onReset={resetPbq} onLeave={() => navigate(session?.mode === 'practice-set' && session.done && session.pbqIds.includes(activePbq.id) ? 'session' : 'pbqs')} practiceStartedAt={session?.mode === 'practice-set' && session.done && session.pbqIds.includes(activePbq.id) ? session.startedAt : null} practiceLimitMinutes={session?.timeLimitMinutes} />}
      </>}
    </main>
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{navItems.map(([key, label, icon]) => <button key={key} className={activeNav === key ? 'active' : ''} aria-current={activeNav === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon name={icon} size={21} /><span>{label}</span></button>)}</nav>
      </div>
    </div>
    <input ref={fileInput} className="visually-hidden" type="file" accept=".zip,.csv,.json" onChange={(event) => importFile(event.target.files?.[0])} />
  </>;
}

function PracticalBootstrap() {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  function reload() {
    setState({ status: 'loading', data: null, error: '' });
    api('/api/practical/overview').then((data) => setState({ status: 'ready', data, error: '' })).catch((err) => {
      if (err.message === 'Practical content has not been imported.') setState({ status: 'legacy', data: null, error: '' });
      else setState({ status: 'error', data: null, error: err.message });
    });
  }
  useEffect(reload, []);
  if (state.status === 'legacy') return <App />;
  if (state.status === 'ready') return <PracticalApp initialOverview={state.data} />;
  if (state.status === 'error') return <main className="practical-loading" role="alert"><h1>Study space unavailable</h1><p>{state.error}</p><button onClick={reload}>Retry</button></main>;
  return <main className="practical-loading" role="status">Loading your Security+ study space…</main>;
}

createRoot(document.getElementById('root')).render(<ContentReviewProvider><PracticalBootstrap /></ContentReviewProvider>);
