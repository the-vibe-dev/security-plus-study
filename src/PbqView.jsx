import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FlagContent } from './ContentReview.jsx';
import { Icon } from './icons.jsx';

function Markdown({ children }) {
  const hasTable = /^\s*\|.*\|/m.test(children || '');
  return <>{hasTable && <p className="table-hint">Swipe the table sideways to see all columns.</p>}<div className="pbq-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{children || ''}</ReactMarkdown></div></>;
}

function expectedText(task, value) {
  const labels = new Map(task.options.map((option) => [option.id, option.text]));
  if (Array.isArray(value)) return value.map((id) => labels.get(id) || id).join(task.response_type === 'ordering' ? ' → ' : ' · ');
  return labels.get(value) || String(value);
}

export function PbqView({ pbq, attempt, busy, onSave, onSubmit, onReset, onLeave, practiceStartedAt = null, practiceLimitMinutes = null }) {
  const [responses, setResponses] = useState(attempt?.responses || {});
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setResponses(attempt?.responses || {}); }, [pbq.id, attempt?.attempt]);
  useEffect(() => { if (!practiceStartedAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [practiceStartedAt]);
  const practiceRemaining = practiceStartedAt && practiceLimitMinutes ? Math.max(0, practiceLimitMinutes * 60000 - (now - practiceStartedAt)) : null;
  const results = new Map((attempt?.result?.tasks || []).map((result) => [result.taskId, result]));
  const groups = useMemo(() => {
    const output = [];
    for (const task of pbq.tasks) {
      const name = task.group || 'Tasks';
      if (!output.length || output.at(-1).name !== name) output.push({ name, tasks: [] });
      output.at(-1).tasks.push(task);
    }
    return output;
  }, [pbq.tasks]);

  function update(task, response, saveNow = true) {
    setResponses((current) => ({ ...current, [task.id]: response }));
    if (saveNow) onSave(task.id, response);
  }
  function toggle(task, id) {
    const current = Array.isArray(responses[task.id]) ? responses[task.id] : [];
    const next = current.includes(id) ? current.filter((value) => value !== id) : current.length < task.selectCount ? [...current, id] : current;
    if (next !== current) update(task, next);
  }
  function move(task, index, direction) {
    const order = Array.isArray(responses[task.id]) ? [...responses[task.id]] : task.options.map((option) => option.id);
    const other = index + direction;
    if (other < 0 || other >= order.length) return;
    [order[index], order[other]] = [order[other], order[index]];
    update(task, order);
  }

  return <>
    <button className="back-link" onClick={onLeave}><Icon name="back" size={16} /> Back to PBQs</button>
    <div className="pbq-layout"><div className="pbq-main">
      <div className="pbq-heading"><span>{pbq.id} · {pbq.difficulty} · about {pbq.time_minutes} minutes</span><h1>{pbq.title}</h1><p>Domain {pbq.primary_domain} · Objectives {pbq.objective_ids.join(', ')}</p>{practiceRemaining !== null && <p className="pbq-practice-timer">Practice-set time remaining: <strong>{Math.floor(practiceRemaining / 60000)}:{String(Math.floor((practiceRemaining % 60000) / 1000)).padStart(2, '0')}</strong>{practiceRemaining === 0 ? ' · Suggested limit reached; you may finish for study.' : ''}</p>}</div>
      <FlagContent key={pbq.id} item={pbq} source="legacy-pbq" />
      <section className="pbq-paper" id="pbq-scenario"><h2>Scenario</h2><Markdown>{pbq.scenario_md}</Markdown></section>
      {pbq.exhibits.map((exhibit, index) => <section className="pbq-paper" id={`pbq-exhibit-${index}`} key={exhibit.id}><h2>Exhibit {exhibit.id}: {exhibit.title}</h2><Markdown>{exhibit.content_md}</Markdown></section>)}
      <div className="pbq-task-heading" id="pbq-tasks"><h2>Complete the tasks</h2><p>Responses save as you work. Submit the case to reveal answers and explanations.</p></div>
      {groups.map((group) => <section className="pbq-group" key={`${group.name}-${group.tasks[0].id}`}><h3>{group.name}</h3>{group.tasks.map((task) => {
        const result = results.get(task.id);
        const disabled = Boolean(attempt?.submitted) || busy;
        const response = responses[task.id];
        return <div className="pbq-task" key={task.id}><div className="pbq-task-title"><span>{task.id}</span><strong>{task.prompt}</strong></div>
          {task.response_type === 'single_select' && <div className="pbq-options" role="radiogroup" aria-label={task.prompt}>{task.options.map((option, index) => <label key={option.id}><input type="radio" name={`${pbq.id}-${task.id}`} checked={response === option.id} disabled={disabled} onChange={() => update(task, option.id)} /><span className="answer-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span></label>)}</div>}
          {task.response_type === 'multi_select' && <><p className="select-instruction">Select {task.selectCount} options. {(Array.isArray(response) ? response : []).length} selected.</p><div className="pbq-options" role="group" aria-label={task.prompt}>{task.options.map((option, index) => <label key={option.id}><input type="checkbox" checked={Array.isArray(response) && response.includes(option.id)} disabled={disabled} onChange={() => toggle(task, option.id)} /><span className="answer-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span></label>)}</div></>}
          {task.response_type === 'number' && <label className="number-response">Your answer <input type="number" inputMode="decimal" value={response ?? ''} disabled={disabled} onChange={(event) => update(task, event.target.value, false)} onBlur={(event) => onSave(task.id, event.target.value)} /></label>}
          {task.response_type === 'ordering' && <div className="ordering-list" aria-label={task.prompt}>{(Array.isArray(response) ? response : task.options.map((option) => option.id)).map((id, index, order) => <div key={id}><span className="order-number">{index + 1}</span><span>{task.options.find((option) => option.id === id)?.text}</span><div><button type="button" disabled={disabled || index === 0} aria-label={`Move ${task.options.find((option) => option.id === id)?.text} up`} onClick={() => move(task, index, -1)}><Icon name="up" size={16} /></button><button type="button" disabled={disabled || index === order.length - 1} aria-label={`Move ${task.options.find((option) => option.id === id)?.text} down`} onClick={() => move(task, index, 1)}><Icon name="down" size={16} /></button></div></div>)}</div>}
          {result && <div className={`pbq-result ${result.correct ? 'good' : 'bad'}`} role="status"><strong>{result.correct ? 'Correct' : 'Needs review'} · {result.points}/{result.possible} practice points</strong><p>Correct response: {expectedText(task, result.correctResponse)}</p><p>{result.explanation}</p></div>}
        </div>;
      })}</section>)}
      {attempt?.submitted && <FlagContent key={`${pbq.id}-explanation`} item={pbq} source="legacy-pbq" feedback={attempt.result} target="explanation" />}
      <div className="pbq-actions">{attempt?.submitted ? <><div className="pbq-total"><strong>{attempt.result.points} / {attempt.result.possible}</strong><span>PBQ task points</span></div><button className="button secondary" onClick={onReset} disabled={busy}>Start new attempt</button></> : <><span>{Object.keys(responses).length} of {pbq.tasks.length} tasks have saved responses. Unanswered tasks receive zero points.</span><button className="button primary" onClick={() => onSubmit(responses)} disabled={busy}>{busy ? 'Saving…' : 'Submit PBQ'}</button></>}</div>
    </div><aside className="pbq-side"><div className="pbq-side-card"><strong>On this page</strong><a href="#pbq-scenario">Scenario</a>{pbq.exhibits.map((exhibit, index) => <a key={exhibit.id} href={`#pbq-exhibit-${index}`}>Exhibit {exhibit.id}</a>)}<a href="#pbq-tasks">Tasks</a><div className="pbq-side-progress"><span>{Object.keys(responses).length} / {pbq.tasks.length}</span><small>tasks saved</small></div></div></aside></div>
  </>;
}
