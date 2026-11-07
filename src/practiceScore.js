// A transparent study index, not CompTIA's unpublished exam scoring formula.
export function quizScore(session) {
  const total = session?.questionIds?.length || 0;
  const correct = Math.min(total, Math.max(0, session?.correctCount || 0));
  return { correct, total, percent: total ? Math.round(correct / total * 100) : 0 };
}

export function practiceScore(session, pbqProgress = {}) {
  const quiz = quizScore(session);
  if (session?.mode !== 'practice-set') return { quiz, complete: Boolean(session?.done), index: null };
  const pbqIds = session.pbqIds || [];
  const pbqResults = pbqIds.map((id) => pbqProgress[id]);
  const pbqsDone = pbqResults.filter((attempt) => attempt?.submitted && attempt.result?.possible > 0).length;
  const pbqPoints = pbqResults.reduce((sum, attempt) => sum + (attempt?.submitted && attempt.result?.possible > 0 ? Math.max(0, Math.min(attempt.result.possible, attempt.result.points)) : 0), 0);
  const pbqPossibleSubmitted = pbqResults.reduce((sum, attempt) => sum + (attempt?.submitted && attempt.result?.possible > 0 ? attempt.result.possible : 0), 0);
  const pbqCredits = pbqResults.reduce((sum, attempt) => sum + (attempt?.submitted && attempt.result?.possible > 0 ? Math.max(0, Math.min(1, attempt.result.points / attempt.result.possible)) : 0), 0);
  const complete = Boolean(session.done && pbqsDone === pbqIds.length && pbqIds.length > 0);
  const quizRate = quiz.total ? quiz.correct / quiz.total : 0;
  const pbqRate = pbqIds.length ? pbqCredits / pbqIds.length : 0;
  const pbqPercent = Math.round(pbqRate * 100);
  // Deliberate study weights. CompTIA has not published actual exam item/PBQ weights.
  const quizWeight = 0.75;
  const pbqWeight = 0.25;
  const quizContribution = Math.round(800 * quizWeight * quizRate);
  // Show a provisional index once the quiz section is finished. Missing PBQs earn zero until submitted.
  const index = session.done && quiz.total && pbqIds.length ? Math.round(100 + 800 * (quizWeight * quizRate + pbqWeight * pbqRate)) : null;
  const pbqContribution = index !== null ? index - 100 - quizContribution : Math.round(800 * pbqWeight * pbqRate);
  return { quiz, pbqsDone, pbqsTotal: pbqIds.length, pbqCredits, pbqPoints, pbqPossibleSubmitted, pbqPercent, quizContribution, pbqContribution, complete, index, provisional: index !== null && !complete };
}
