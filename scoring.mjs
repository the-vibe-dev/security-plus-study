export function exactSet(selected, expected) {
  return Array.isArray(selected) && Array.isArray(expected) && selected.length === expected.length && new Set(selected).size === selected.length && selected.every((id) => expected.includes(id));
}

export function gradeQuiz(question, selectedIds) {
  return exactSet(selectedIds, question.correctIds);
}

export function gradeTask(task, key, response) {
  let correct = false;
  const expected = key.correct_response;
  switch (key.scoring.method) {
    case 'exact':
      correct = typeof response === 'string' && response === expected;
      break;
    case 'set_exact':
      correct = exactSet(response, expected);
      break;
    case 'ordered_exact':
      correct = Array.isArray(response) && response.length === expected.length && response.every((value, index) => value === expected[index]);
      break;
    case 'numeric': {
      const present = typeof response === 'number' || (typeof response === 'string' && response.trim() !== '');
      const value = present ? Number(response) : NaN;
      correct = Number.isFinite(value) && Math.abs(value - expected) <= (key.scoring.tolerance ?? 0);
      break;
    }
    default:
      throw new Error(`Unsupported scoring method: ${key.scoring.method}`);
  }
  return { correct, points: correct ? task.max_points : 0, possible: task.max_points, explanation: key.explanation, correctResponse: expected };
}

export function gradePbq(pbq, responses) {
  const keys = new Map(pbq.answer_key.map((key) => [key.task_id, key]));
  const tasks = pbq.tasks.map((task) => ({ taskId: task.id, ...gradeTask(task, keys.get(task.id), responses[task.id]) }));
  return { points: tasks.reduce((sum, task) => sum + task.points, 0), possible: pbq.max_points, tasks };
}
