import React, { useEffect, useMemo, useState } from 'react';
import { FlagContent } from './ContentReview.jsx';
import { Icon } from './icons.jsx';
import { practiceScore } from './practiceScore.js';

function formatTime(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function QuizView({ session, question, submitting, onSelect, onSubmit, onNext, onLeave, onTimeUp, practicePbqs = [], pbqProgress = {}, onOpenPbq }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!session.timeLimitMinutes || session.done) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session.timeLimitMinutes, session.done]);
  const remaining = session.timeLimitMinutes ? session.timeLimitMinutes * 60000 - (now - session.startedAt) : null;
  useEffect(() => { if (remaining !== null && remaining <= 0 && !session.done && !session.expired) onTimeUp(); }, [remaining, session.done, session.expired, onTimeUp]);
  const score = practiceScore(session, pbqProgress);
  const orderedChoices = useMemo(() => {
    if (!question) return [];
    const byId = new Map(question.choices.map((choice) => [choice.id, choice]));
    return (session.choiceOrder?.[question.id] || question.choices.map((choice) => choice.id)).map((id) => byId.get(id)).filter(Boolean);
  }, [question, session.choiceOrder]);

  if (session.done) return <div className="completion completion-results">
    <span>{session.expired ? '90-minute benchmark exceeded' : 'Quiz section complete'}</span>
    <h1>Your {session.mode === 'practice-set' ? 'practice set' : 'quiz'} result</h1>
    <div className="completion-score">
      <strong>{session.mode === 'practice-set' ? `${score.index}/900` : `${score.quiz.percent}%`}</strong>
      <span>{session.mode === 'practice-set' ? score.provisional ? 'Provisional exam-style estimate' : 'Exam-style estimate' : `${score.quiz.correct} of ${score.quiz.total} quiz questions correct`}</span>
    </div>
    {session.mode === 'practice-set' ? <>
      <div className="completion-score-grid">
        <div><span>Quiz accuracy · estimated 75% weight</span><strong>{score.quiz.percent}%</strong><small>{score.quiz.correct} of {score.quiz.total} correct</small></div>
        <div><span>PBQ accuracy · estimated 25% weight</span><strong>{score.pbqPercent}%</strong><small>{score.pbqsDone ? `${score.pbqPoints}/${score.pbqPossibleSubmitted} task points · ` : ''}{score.pbqsDone}/{score.pbqsTotal} PBQs submitted</small></div>
        <div><span>SY0-701 passing reference</span><strong>750/900</strong><small>Official exam scale</small></div>
      </div>
      <div className="score-breakdown" aria-label="Study index calculation">
        <span><strong>100</strong><small>base</small></span><b>+</b>
        <span><strong>{score.quizContribution}</strong><small>quiz / 600</small></span><b>+</b>
        <span><strong>{score.pbqContribution}</strong><small>PBQs / 200</small></span><b>=</b>
        <span><strong>{score.index}</strong><small>estimate</small></span>
      </div>
      <p className="score-explanation">{score.provisional ? 'Unsubmitted PBQs currently count as zero; the estimate updates when you submit them. ' : ''}The 75% quiz / 25% PBQ blend and the linear 100–900 mapping are best guesses for this study pack. CompTIA keeps actual scoring confidential; this is not an official score or pass prediction.</p>
      <div className="completion-pbqs">{practicePbqs.map((pbq) => <button key={pbq.id} onClick={() => onOpenPbq(pbq.id)}><span><strong>{pbq.id}: {pbq.title}</strong><small>{pbqProgress[pbq.id]?.submitted ? `${pbqProgress[pbq.id].result.points}/${pbqProgress[pbq.id].result.possible} task points` : pbqProgress[pbq.id]?.responses && Object.keys(pbqProgress[pbq.id].responses).length ? 'In progress' : 'Ready to start'}</small></span><Icon name="arrow" size={17} /></button>)}</div>
    </> : <p>You answered {score.quiz.correct} of {score.quiz.total} quiz questions correctly.</p>}
    <div className="completion-actions"><button className="button secondary" onClick={onLeave}>Return to practice</button></div>
  </div>;
  if (!question) return <div className="empty-note">This question is no longer in the library. <button onClick={onLeave}>Return to practice</button></div>;
  const selected = session.selectedIds || [];
  const feedback = session.feedback;
  const isMulti = question.selectCount > 1;
  return <>
    <button className="back-link" onClick={onLeave}><Icon name="back" size={16} /> Leave session</button>
    <div className="session-wrap">
      <div className="session-meta"><span>{session.title}</span><span>Question {session.index + 1} of {session.questionIds.length}</span></div>
      {remaining !== null && <div className="session-timer" aria-live="off">{session.expired ? '90-minute benchmark exceeded. You can still finish and score this quiz.' : <>Time remaining: <strong>{formatTime(remaining)}</strong></>}</div>}
      <div className="progress-track"><div style={{ width: `${(session.index + Number(Boolean(feedback))) / session.questionIds.length * 100}%` }} /></div>
      <div className="question-card"><div className="question-context"><span>{question.domain}</span>{question.objective && <span>Objective {question.objective}</span>}{question.difficulty && <span>{question.difficulty}</span>}</div>
        <h1>{question.question}</h1><FlagContent key={question.id} item={question} source="legacy-question" />
        {isMulti && <p className="select-instruction">Select exactly {question.selectCount} answers. {selected.length} of {question.selectCount} selected.</p>}
        <div className="answers" role={isMulti ? 'group' : 'radiogroup'} aria-label="Answer choices">
          {orderedChoices.map((choice, index) => {
            const checked = selected.includes(choice.id);
            const correct = feedback?.correctIds.includes(choice.id);
            const status = feedback ? correct ? 'correct' : checked ? 'incorrect' : '' : checked ? 'selected' : '';
            return <label className={`answer-choice ${status}`} key={choice.id}>
              <input type={isMulti ? 'checkbox' : 'radio'} name={`question-${question.id}`} checked={checked} disabled={Boolean(feedback) || submitting || Boolean(session.pendingAnswer)} onChange={() => onSelect(choice.id, isMulti)} />
              <span className="answer-letter">{String.fromCharCode(65 + index)}</span><span className="answer-content"><span>{choice.text}</span>{feedback?.rationales?.[choice.id] && <small>{feedback.rationales[choice.id]}</small>}</span>
            </label>;
          })}
        </div>
        {feedback && <div className={`feedback ${session.feedbackCorrect ? 'good' : 'bad'}`} role="status"><strong>{session.feedbackCorrect ? 'Correct.' : 'Not quite.'}</strong><p>{session.feedbackCorrect ? 'Your selection matches the answer key.' : `Correct ${isMulti ? 'answers' : 'answer'}: ${question.choices.filter((choice) => feedback.correctIds.includes(choice.id)).map((choice) => choice.text).join(' · ')}`}</p>{feedback.explanation && <p className="explanation">{feedback.explanation}</p>}{feedback.examTip && <p className="exam-tip"><strong>Reasoning tip:</strong> {feedback.examTip}</p>}</div>}
        {feedback && <FlagContent key={`${question.id}-explanation`} item={question} source="legacy-question" feedback={feedback} target="explanation" />}
        <div className="question-footer"><span>{feedback ? 'Review the reasoning, then continue.' : session.pendingAnswer ? 'Your selection is held until it is confirmed.' : `Choose ${question.selectCount} ${isMulti ? 'answers' : 'answer'} to submit.`}</span>{feedback ? <button className="button primary" onClick={onNext}>{session.index === session.questionIds.length - 1 ? 'Finish session' : 'Next question'} <Icon name="arrow" size={16} /></button> : <button className="button primary" disabled={selected.length !== question.selectCount || submitting} onClick={onSubmit}>{submitting ? 'Checking…' : session.pendingAnswer ? 'Retry answer' : 'Submit answer'}</button>}</div>
      </div>
    </div>
  </>;
}
