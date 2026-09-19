export function emptyState() {
  return { attempts: 0, correct: 0, incorrect: 0, consecutiveCorrect: 0, status: "unseen" };
}

export function recordAnswer(previous, isCorrect, now = Date.now(), responseMs = 0) {
  const state = previous ?? emptyState();
  const attempts = state.attempts + 1;
  const correct = state.correct + (isCorrect ? 1 : 0);
  const incorrect = state.incorrect + (isCorrect ? 0 : 1);
  const consecutiveCorrect = isCorrect ? state.consecutiveCorrect + 1 : 0;
  const retrievals = isCorrect ? [...(state.retrievals ?? []), now].slice(-3) : [];
  const separated = retrievals.length >= 3
    && retrievals[1] - retrievals[0] >= 24 * 60 * 60 * 1000
    && retrievals[2] - retrievals[1] >= 24 * 60 * 60 * 1000;
  const status = !isCorrect ? "weak" : separated ? "mastered" : "learning";
  const gap = !isCorrect ? 5 : consecutiveCorrect === 1 ? 0 : consecutiveCorrect === 2 ? 1 : consecutiveCorrect === 3 ? 3 : 7;
  return { ...state, attempts, correct, incorrect, consecutiveCorrect, retrievals, firstSeenAt: state.firstSeenAt ?? now, lastSeenAt: now, lastResponseMs: responseMs, nextReviewAt: now + gap * 24 * 60 * 60 * 1000, status };
}

export function due(state, now = Date.now()) {
  return !state || state.status === "unseen" || !state.nextReviewAt || state.nextReviewAt <= now;
}

export function selectNext(questions, states, now = Date.now(), exclude = new Set()) {
  const rank = (question) => {
    const state = states[question.id];
    if (exclude.has(question.id)) return 99;
    if (!state || state.status === "unseen") return 0;
    if (state.status === "weak" && due(state, now)) return 1;
    if (state.status === "learning" && due(state, now)) return 2;
    if (state.status === "mastered" && due(state, now)) return 3;
    return 4;
  };
  return [...questions].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0];
}

export function grade(question, answer) { return question.answer === answer; }
