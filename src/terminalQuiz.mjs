import { createHash } from "node:crypto";
import { due, recordAnswer, selectNext } from "./schedulerCore.mjs";

export const EXAM_QUESTION_COUNT = 25;
export const EXAM_DURATION_MINUTES = 45;
export const EXAM_DURATION_MS = EXAM_DURATION_MINUTES * 60 * 1000;
export const OFFICIAL_PASS_MARK = 15;
export const PREP_PASS_TARGET = 20;
export const TERMINAL_MINIMUM = EXAM_QUESTION_COUNT;
export const EXAM_DATE = "2026-09-24";
export const TASK_DISTRIBUTION = Object.freeze({ 1: 10, 2: 3, 3: 2, 4: 3, 5: 7 });
export const OFFICIAL_SOURCE = "https://examenes.cervantes.es/sites/default/files/manual-ccse-2026-def.pdf";

export function answerKeyForInput(input) { const key = String(input).toLowerCase(); return key === "j" ? "a" : key === "k" ? "b" : key === "l" ? "c" : undefined; }
export function terminalSummary(answers) { return { answered: answers.length, correct: answers.filter((answer) => answer.correct).length }; }
function scoreFor(answers) { const summary = terminalSummary(answers); return { ...summary, accuracy: summary.answered ? summary.correct / summary.answered : 0 }; }
function sessionStats(answers) { const summary = scoreFor(answers); return { ...summary, averageResponseMs: summary.answered ? Math.round(answers.reduce((total, answer) => total + (Number(answer.responseMs) || 0), 0) / summary.answered) : 0, officialPassed: summary.answered >= EXAM_QUESTION_COUNT && summary.correct >= OFFICIAL_PASS_MARK, safetyPassed: summary.answered >= EXAM_QUESTION_COUNT && summary.correct >= PREP_PASS_TARGET, passed: summary.answered >= EXAM_QUESTION_COUNT && summary.correct >= PREP_PASS_TARGET }; }
export const terminalSessionSummary = sessionStats;
export function canFinish(answers) { return answers.length >= EXAM_QUESTION_COUNT; }

export function answerReview(answers, bank) {
  const questions = new Map(bank.map((question) => [question.id, question]));
  return answers.map((answer) => { const question = questions.get(answer.questionId); const correct = question?.options?.[question.answer] ?? question?.answer ?? "—"; const selected = question?.options?.[answer.selected] ?? answer.selected ?? "—"; return { question: question?.question ?? `Question ${answer.questionId}`, wrong: selected, correct, selected: Boolean(answer.correct) ? correct : selected, correctAnswer: Boolean(answer.correct), ...(question?.task ? { task: question.task, topic: question.topic ?? `Tarea ${question.task}` } : {}), explanation: explanationForQuestion(question, correct) }; });
}
export function wrongAnswerReview(answers, bank) { return answerReview(answers, bank).filter((review) => !review.correctAnswer).map(({ selected, correctAnswer, ...review }) => review); }
export function explanationForQuestion(question, correct = question?.options?.[question?.answer] ?? question?.answer ?? "—") {
  if (question?.explanation) return question.explanation;
  const prompt = String(question?.question ?? "").replace(/[¿?…]/g, "").trim().toLowerCase();
  if (/^dónde|^en qué lugar/.test(prompt)) return `La respuesta correcta es «${correct}», el lugar que identifica la pregunta.`;
  if (/^quién|^qué persona/.test(prompt)) return `«${correct}» es la persona o institución que corresponde.`;
  if (/^cuándo|^a qué hora|^cuántos años|^cuántas/.test(prompt)) return `«${correct}» es el dato exacto que establece la norma o el hecho.`;
  if (/^cómo|^qué se necesita|^qué debes|^qué hay que/.test(prompt)) return `«${correct}» es el trámite, requisito o acción correcta.`;
  if (/^verdadero|^falso/.test(prompt)) return `La afirmación es ${correct.toLowerCase()}: esa es la respuesta que concuerda con la realidad.`;
  return `«${correct}» es el hecho, concepto o regla correcta.`;
}

function stateRank(question, states, now, prioritizeWeak) { const state = states[question.id]; if (!state || state.status === "unseen") return [prioritizeWeak ? 1 : 0, 0, question.id]; const accuracy = state.attempts ? state.correct / state.attempts : 0; const priority = state.status === "weak" ? 0 : due(state, now) ? 2 : 3; return [priority, accuracy, question.id]; }
function byPriority(questions, states, now, exclude = new Set(), prioritizeWeak = true) { return [...questions].filter((question) => !exclude.has(question.id)).sort((a, b) => { const ar = stateRank(a, states, now, prioritizeWeak); const br = stateRank(b, states, now, prioritizeWeak); return ar[0] - br[0] || ar[1] - br[1] || ar[2] - br[2]; }); }

export function validateQuestionBank(bank) {
  const errors = [];
  const expectedCounts = { 1: 120, 2: 36, 3: 24, 4: 36, 5: 84 };
  const counts = Object.fromEntries(Object.keys(expectedCounts).map((task) => [task, 0]));
  const ids = new Set();
  const texts = new Map();
  if (!Array.isArray(bank)) return { valid: false, errors: ["question bank must be an array"], counts };
  if (bank.length !== 300) errors.push(`expected 300 questions, got ${bank.length}`);
  for (const [index, question] of bank.entries()) {
    if (!question || typeof question !== "object" || Array.isArray(question)) { errors.push(`malformed question at index ${index}`); continue; }
    if (!Number.isInteger(question.id)) errors.push(`invalid question id at index ${index}`);
    else if (ids.has(question.id)) errors.push(`duplicate question id ${question.id}`);
    else ids.add(question.id);
    if (!Number.isInteger(question.task) || !Object.hasOwn(expectedCounts, question.task)) errors.push(`invalid task for ${question.id ?? index}`);
    else counts[question.task] += 1;
    const idMin = Number.isInteger(question.task) ? question.task * 1000 + 1 : 0;
    const idMax = Number.isInteger(question.task) ? idMin + (expectedCounts[question.task] ?? 0) - 1 : -1;
    if (question.id !== undefined && (question.id < idMin || question.id > idMax)) errors.push(`unexpected or unreachable id ${question.id} for task ${question.task}`);
    if (typeof question.question !== "string" || !question.question.trim()) errors.push(`missing question text ${question.id ?? index}`);
    else {
      const normalized = question.question.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("es");
      if (texts.has(normalized)) errors.push(`duplicate question text ${question.id} and ${texts.get(normalized)}`);
      else texts.set(normalized, question.id);
    }
    const options = question.options;
    const keys = options && typeof options === "object" && !Array.isArray(options) ? Object.keys(options).sort() : [];
    const expectedKeys = question.task === 2 ? ["a", "b"] : ["a", "b", "c"];
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) errors.push(`invalid answer choices for ${question.id ?? index}`);
    else {
      const values = keys.map((key) => options[key]);
      if (values.some((value) => typeof value !== "string" || !value.trim())) errors.push(`empty or invalid answer choice for ${question.id}`);
      const normalized = values.map((value) => typeof value === "string" ? value.normalize("NFKC").trim().toLocaleLowerCase("es") : "");
      if (new Set(normalized).size !== normalized.length) errors.push(`duplicate answer choices for ${question.id}`);
      if (question.task === 2 && new Set(normalized.map((value) => value.replace(/[.!?]+$/u, ""))).size === 2 && !["verdadero", "falso"].every((value) => normalized.some((choice) => choice.replace(/[.!?]+$/u, "") === value))) errors.push(`task 2 choices must be verdadero/falso for ${question.id}`);
      if (!keys.includes(question.answer) || !options[question.answer]?.trim?.()) errors.push(`invalid answer key for ${question.id ?? index}`);
      if (values.some((value) => typeof value === "string" && /PREGUNTAS|�|\u0000|Ã.|Â.|â(?:€|€™|€œ|€“|€”)/u.test(value))) errors.push(`suspicious extracted text in answer choices for ${question.id}`);
    }
    if (typeof question.question === "string" && /PREGUNTAS|�|\u0000|Ã.|Â.|â(?:€|€™|€œ|€“|€”)/u.test(question.question)) errors.push(`suspicious extracted text in question ${question.id}`);
    if (!Number.isInteger(question.page) || question.page < 1 || question.page > 102) errors.push(`invalid manual page for ${question.id ?? index}`);
    if (typeof question.explanation !== "string" || !question.explanation.trim()) errors.push(`missing explanation ${question.id ?? index}`);
  }
  for (const [task, expected] of Object.entries(expectedCounts)) if (counts[task] !== expected) errors.push(`task ${task}: expected ${expected}, got ${counts[task]}`);
  return { valid: errors.length === 0, errors, counts };
}

export function questionBankFingerprint(bank) {
  const content = bank.map(({ id, task, question, options, answer }) => ({ id, task, question, options: Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))), answer })).sort((a, b) => a.id - b.id);
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function resumeSession(startedEvent, events, bank, fingerprint) {
  const payload = startedEvent?.payload;
  if (payload?.bankFingerprint !== fingerprint || !Array.isArray(payload.questionIds) || payload.questionIds.length !== EXAM_QUESTION_COUNT) return undefined;
  const questionsById = new Map(bank.map((question) => [question.id, question]));
  const questions = payload.questionIds.map((id) => questionsById.get(id));
  if (questions.some((question) => !question) || new Set(questions.map((question) => question.id)).size !== EXAM_QUESTION_COUNT) return undefined;
  if (payload.sessionKind === "mock") {
    const counts = Object.fromEntries(Object.keys(TASK_DISTRIBUTION).map((task) => [task, 0]));
    for (const question of questions) counts[question.task] += 1;
    if (Object.entries(TASK_DISTRIBUTION).some(([task, count]) => counts[task] !== count)) return undefined;
  }
  const answers = events.filter((event) => event?.type === "ANSWER_RECORDED" && event.payload?.sessionId === payload.sessionId);
  if (answers.length > EXAM_QUESTION_COUNT || answers.some((event, index) => {
    const question = questions[index];
    const selected = event.payload.selected ?? event.payload.answer;
    return question?.id !== Number(event.payload.questionId) || !Object.hasOwn(question.options, selected) || event.payload.correct !== (selected === question.answer) || !Number.isFinite(event.payload.responseMs) || event.payload.responseMs < 0;
  })) throw new Error("Progress log contains answers that do not match the resumable question sequence");
  return {
    questions,
    answers: answers.map((event) => ({ questionId: Number(event.payload.questionId), selected: event.payload.selected ?? event.payload.answer, correct: event.payload.correct, responseMs: event.payload.responseMs })),
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("random source must return a number in [0, 1)");
    const swap = Math.floor(value * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

// Mock samples ignore training state and shuffle independently within each official task quota.
export function buildMockPlan(bank, _states = {}, _now = Date.now(), random = Math.random) {
  return Object.entries(TASK_DISTRIBUTION).flatMap(([task, count]) => shuffled(bank.filter((item) => item.task === Number(task)), random).slice(0, count));
}
export function buildAdaptiveReviewPlan(bank, states = {}, now = Date.now(), size = EXAM_QUESTION_COUNT, delayedQuestionIds = []) { const questionsById = new Map(bank.map((question) => [question.id, question])); const delayedQuestions = delayedQuestionIds.map(Number).map((id) => questionsById.get(id)).filter(Boolean); const delayed = new Set(delayedQuestions.map((question) => question.id)); const remaining = byPriority(bank, states, now, delayed); return [...delayedQuestions, ...remaining].slice(0, Math.min(size, bank.length)); }
export function daysUntilExam(date = new Date()) { const today = new Date(date); today.setHours(0, 0, 0, 0); return Math.ceil((new Date(`${EXAM_DATE}T00:00:00`) - today) / (24 * 60 * 60 * 1000)); }
export function isExamDay(date = new Date()) { return daysUntilExam(date) === 0; }
export function sessionModeForDate(date = new Date()) { const days = daysUntilExam(date); if (days <= 0) return "exam-day"; if (days <= 2) return "mock"; if (days <= 4) return "weak-review"; return "coverage"; }
export function lastCompletedSession(events = []) { return [...events].filter((event) => event?.type === "SESSION_COMPLETED").sort((a, b) => b.timestamp - a.timestamp)[0]?.payload ?? {}; }
export function sessionPlanForDate(bank, states = {}, date = new Date(), events = []) {
  const now = new Date(date).getTime(); const mode = sessionModeForDate(date); const previous = lastCompletedSession(events); const delayedQuestionIds = Array.isArray(previous.wrongQuestionIds) ? previous.wrongQuestionIds.map(Number) : [];
  if (mode === "exam-day") return { mode, sessionKind: mode, feedbackMode: "end-of-session", questions: [], delayedQuestionIds: [], durationMs: 0 };
  if (mode === "mock") return { mode, sessionKind: "mock", feedbackMode: "end-of-session", questions: buildMockPlan(bank, states, now), delayedQuestionIds: [], durationMs: EXAM_DURATION_MS };
  const sessionKind = mode === "coverage" ? "coverage" : "weak-review";
  const questionsById = new Map(bank.map((question) => [question.id, question])); const delayedQuestions = delayedQuestionIds.map((id) => questionsById.get(id)).filter(Boolean);
  const questions = mode === "coverage"
    ? [...delayedQuestions, ...byPriority(bank, states, now, new Set(delayedQuestions.map((question) => question.id)), false)].slice(0, EXAM_QUESTION_COUNT)
    : buildAdaptiveReviewPlan(bank, states, now, EXAM_QUESTION_COUNT, delayedQuestionIds);
  return { mode, sessionKind, feedbackMode: "immediate", questions, delayedQuestionIds: questions.filter((question) => delayedQuestionIds.includes(question.id)).map((question) => question.id), durationMs: EXAM_DURATION_MS };
}
export function explicitSessionPlan(bank, states = {}, kind = "mock", now = Date.now()) {
  if (kind === "mock") return { mode: "mock", sessionKind: "mock", feedbackMode: "end-of-session", questions: buildMockPlan(bank), delayedQuestionIds: [], durationMs: EXAM_DURATION_MS, startedAt: now };
  if (kind === "practice") return { mode: "practice", sessionKind: "practice", feedbackMode: "immediate", questions: buildAdaptiveReviewPlan(bank, states, now), delayedQuestionIds: [], durationMs: EXAM_DURATION_MS, startedAt: now };
  throw new RangeError(`unknown session kind: ${kind}`);
}
export function selectTerminalQuestion(bank, states, now = Date.now(), exclude = new Set()) { return selectNext(bank, states, now, exclude); }
export function buildSessionPlan(bank, states, now = Date.now(), sessionSize = EXAM_QUESTION_COUNT) { return buildAdaptiveReviewPlan(bank, states, now, sessionSize); }
export function reviewInterval(correct, state) { if (!correct) return 5; const next = state?.nextReviewAt; if (!next || !state?.lastSeenAt) return 0; return Math.max(0, Math.round((next - state.lastSeenAt) / (24 * 60 * 60 * 1000))); }

export function terminalDashboardMetrics(bank, states, events = [], now = Date.now(), sessionAnswers = []) {
  const counts = { unseen: 0, learning: 0, weak: 0, mastered: 0, due: 0 }; for (const question of bank) { const state = states[question.id]; const status = state?.status ?? "unseen"; counts[status] += 1; if (status !== "unseen" && due(state, now)) counts.due += 1; }
  const dates = new Set(events.filter((event) => event?.type === "ANSWER_RECORDED").map((event) => calendarDay(event.timestamp))); let streak = 0; let cursor = new Date(now); while (dates.has(calendarDay(cursor.getTime()))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  const summary = sessionStats(sessionAnswers); return { ...counts, streak, dailyAnswered: events.filter((event) => event?.type === "ANSWER_RECORDED" && calendarDay(event.timestamp) === calendarDay(now)).length, dailyComplete: sessionAnswers.length >= EXAM_QUESTION_COUNT, sessionAccuracy: summary.accuracy, averageResponseMs: summary.averageResponseMs };
}
function calendarDay(timestamp) { const date = new Date(timestamp); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
export function completionSummary(answers, beforeStates = {}, afterStates = {}, bank = [], metadata = {}) {
  const summary = sessionStats(answers); const delayedIds = new Set((metadata.delayedQuestionIds ?? []).map(Number)); const delayedAnswers = answers.filter((answer) => delayedIds.has(Number(answer.questionId))); const unseenAnswers = answers.filter((answer) => !beforeStates[answer.questionId] || beforeStates[answer.questionId].status === "unseen"); const freshAnswers = metadata.sessionKind === "mock" ? answers : unseenAnswers.filter((answer) => !delayedIds.has(Number(answer.questionId)));
  const byTask = Object.fromEntries(Object.keys(TASK_DISTRIBUTION).map((task) => [task, { answered: 0, correct: 0 }]));
  for (const answer of answers) { const task = bank.find((question) => question.id === answer.questionId)?.task; if (task) { byTask[task].answered += 1; byTask[task].correct += answer.correct ? 1 : 0; } }
  const newlyMastered = Object.keys(afterStates).filter((id) => afterStates[id]?.status === "mastered" && beforeStates[id]?.status !== "mastered").length; const weak = answers.filter((answer) => !answer.correct).length; const weakestTask = Object.entries(byTask).filter(([, value]) => value.answered).sort(([, a], [, b]) => (a.correct / a.answered) - (b.correct / b.answered))[0]?.[0];
  const delayedReview = scoreFor(delayedAnswers); const freshScore = scoreFor(freshAnswers); const officialPassed = summary.answered >= EXAM_QUESTION_COUNT && summary.correct >= OFFICIAL_PASS_MARK; const safetyPassed = summary.answered >= EXAM_QUESTION_COUNT && summary.correct >= PREP_PASS_TARGET;
  const recentlySeenAnswered = Math.max(0, summary.answered - unseenAnswers.length); const confidenceWarning = summary.correct >= PREP_PASS_TARGET && recentlySeenAnswered > unseenAnswers.length ? "Warning: this high score is based mostly on recently seen questions; confirm readiness with fresh questions." : undefined;
  return { ...summary, officialPassed, safetyPassed, passed: safetyPassed, delayedReview, freshScore, recentlySeenAnswered, confidenceWarning, timedOut: Boolean(metadata.timedOut), unanswered: Math.max(0, (metadata.total ?? EXAM_QUESTION_COUNT) - summary.answered), questionIds: answers.map((answer) => answer.questionId), wrongQuestionIds: answers.filter((answer) => !answer.correct).map((answer) => answer.questionId), byTask, newlyMastered, weak: answers.filter((answer) => !answer.correct).length, weakestTask: weakestTask ? Number(weakestTask) : undefined, nextAction: safetyPassed ? "Keep the streak with a short review tomorrow." : "Review the missed and weak questions while they are fresh.", unlockMessage: safetyPassed ? "Safety target reached (20/25)." : "Safety target not reached (20/25)." };
}
export function readinessSummary(events = [], bank = [], states = {}) {
  const fingerprint = questionBankFingerprint(bank);
  const startedById = new Map(events.filter((event) => event?.type === "SESSION_STARTED").map((event) => [event.payload?.sessionId, event.payload]));
  const answerEvents = new Map();
  for (const event of events.filter((entry) => entry?.type === "ANSWER_RECORDED" && entry.payload?.bankFingerprint === fingerprint)) {
    const id = event.payload.sessionId;
    answerEvents.set(id, [...(answerEvents.get(id) ?? []), event.payload]);
  }
  const questionsById = new Map(bank.map((question) => [question.id, question]));
  const mocks = events.filter((event) => event?.type === "SESSION_COMPLETED" && event.payload?.sessionKind === "mock" && event.payload.bankFingerprint === fingerprint && !event.payload.timedOut && event.payload.answered === EXAM_QUESTION_COUNT)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp)).map((event) => {
      const ids = event.payload.questionIds ?? startedById.get(event.payload.sessionId)?.questionIds ?? [];
      const answers = answerEvents.get(event.payload.sessionId) ?? [];
      if (ids.length !== EXAM_QUESTION_COUNT || answers.length !== EXAM_QUESTION_COUNT || new Set(ids).size !== EXAM_QUESTION_COUNT) throw new Error(`Mock history is incomplete or malformed for session ${event.payload.sessionId}`);
      const taskCounts = Object.fromEntries(Object.keys(TASK_DISTRIBUTION).map((task) => [task, 0]));
      let correct = 0;
      for (const [index, answer] of answers.entries()) {
        const question = questionsById.get(ids[index]);
        const selected = answer.selected ?? answer.answer;
        if (!question || question.id !== Number(answer.questionId) || !Object.hasOwn(question.options, selected) || typeof answer.correct !== "boolean" || answer.correct !== (selected === question.answer)) throw new Error(`Mock history has an invalid answer in session ${event.payload.sessionId}`);
        taskCounts[question.task] += 1;
        if (answer.correct) correct += 1;
      }
      if (Object.entries(TASK_DISTRIBUTION).some(([task, count]) => taskCounts[task] !== count) || correct !== event.payload.correct) throw new Error(`Mock history score or task counts do not match answers in session ${event.payload.sessionId}`);
      return { correct, answered: answers.length, questionIds: ids };
    }).slice(-5);
  const recent = mocks.slice(-3);
  const uniqueSeen = new Set(mocks.flatMap((mock) => mock.questionIds));
  const recentScores = recent.map(({ correct, answered }) => `${correct}/${answered}`);
  const consistent = recent.length === 3 && recent.every((mock) => mock.correct >= PREP_PASS_TARGET && mock.answered === EXAM_QUESTION_COUNT);
  const counts = { weak: 0, learning: 0, mastered: 0, unseen: 0 };
  for (const question of bank) counts[states[question.id]?.status in counts ? states[question.id].status : "unseen"] += 1;
  return { lastMocks: mocks.map(({ correct, answered }) => ({ correct, answered })), minimum: mocks.length ? Math.min(...mocks.map((mock) => mock.correct)) : undefined, mean: mocks.length ? mocks.reduce((sum, mock) => sum + mock.correct, 0) / mocks.length : undefined, uniqueQuestionsSeen: bank.length - counts.unseen, remainingUnseenQuestions: counts.unseen, mockQuestionsSeen: uniqueSeen.size, mockQuestionsNotYetSampled: Math.max(0, bank.length - uniqueSeen.size), weakQuestions: counts.weak, uncertainQuestions: counts.learning, knownQuestions: counts.mastered, consistentMargin: consistent };
}
export function renderCompletionSummary(summary) { return `Score ${summary.correct}/${summary.answered} · ${Math.round(summary.accuracy * 100)}% · ${summary.officialPassed ? "OFFICIAL PASS" : "REVIEW"}\nSafety target: ${summary.safetyPassed ? "met" : "not met"} (20/25)\nFresh/mock: ${summary.freshScore.correct}/${summary.freshScore.answered} · Delayed: ${summary.delayedReview.correct}/${summary.delayedReview.answered}\n${summary.nextAction}`; }
export function reduceTerminalEvents(events, bankFingerprint) { return [...events].filter((event) => event?.type === "ANSWER_RECORDED" && (bankFingerprint === undefined || event.payload?.bankFingerprint === bankFingerprint)).sort((a, b) => a.timestamp - b.timestamp || String(a.deviceId).localeCompare(String(b.deviceId)) || String(a.eventId).localeCompare(String(b.eventId))).reduce(applyTerminalAnswer, {}); }
export function applyTerminalAnswer(states, event) { const questionId = Number(event.payload?.questionId); if (!Number.isFinite(questionId)) return states; states[questionId] = recordAnswer(states[questionId], Boolean(event.payload?.correct), event.timestamp, Number(event.payload?.responseMs) || 0); return states; }
export function makeAnswerEvent({ questionId, selected, correct, responseMs, eventId, deviceId, timestamp, sessionId }) { return { eventId, deviceId, timestamp, type: "ANSWER_RECORDED", payload: { questionId, answer: selected, selected, correct, responseMs, sessionId } }; }
