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
function sessionStats(answers) { const summary = terminalSummary(answers); return { ...summary, accuracy: summary.answered ? summary.correct / summary.answered : 0, averageResponseMs: summary.answered ? Math.round(answers.reduce((total, answer) => total + (Number(answer.responseMs) || 0), 0) / summary.answered) : 0, passed: summary.answered >= EXAM_QUESTION_COUNT && summary.correct >= PREP_PASS_TARGET }; }
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
  const errors = []; const counts = Object.fromEntries(Object.keys(TASK_DISTRIBUTION).map((task) => [task, 0])); const ids = new Set();
  if (bank.length !== 300) errors.push(`expected 300 questions, got ${bank.length}`);
  for (const question of bank) { if (ids.has(question.id)) errors.push(`duplicate question id ${question.id}`); ids.add(question.id); if (!TASK_DISTRIBUTION[question.task]) errors.push(`invalid task for ${question.id}`); else counts[question.task] += 1; if (!question.question || !question.options?.[question.answer]) errors.push(`incomplete question ${question.id}`); if (!question.explanation) errors.push(`missing explanation ${question.id}`); }
  for (const [task, expected] of Object.entries({ 1: 120, 2: 36, 3: 24, 4: 36, 5: 84 })) if (counts[task] !== expected) errors.push(`task ${task}: expected ${expected}, got ${counts[task]}`);
  return { valid: errors.length === 0, errors, counts };
}
export function buildMockPlan(bank, states = {}, now = Date.now()) { const chosen = []; const used = new Set(); for (const [task, count] of Object.entries(TASK_DISTRIBUTION)) for (const question of byPriority(bank.filter((item) => item.task === Number(task)), states, now, used).slice(0, count)) { chosen.push(question); used.add(question.id); } return chosen; }
export function buildAdaptiveReviewPlan(bank, states = {}, now = Date.now(), size = EXAM_QUESTION_COUNT) { return byPriority(bank, states, now).slice(0, Math.min(size, bank.length)); }
export function daysUntilExam(date = new Date()) { const today = new Date(date); today.setHours(0, 0, 0, 0); return Math.ceil((new Date(`${EXAM_DATE}T00:00:00`) - today) / (24 * 60 * 60 * 1000)); }
export function isExamDay(date = new Date()) { return daysUntilExam(date) === 0; }
export function sessionModeForDate(date = new Date()) { const days = daysUntilExam(date); if (days <= 0) return "exam-day"; if (days <= 2) return "mock"; if (days <= 4) return "weak-review"; return "coverage"; }
export function sessionPlanForDate(bank, states = {}, date = new Date()) { const now = new Date(date).getTime(); const mode = sessionModeForDate(date); if (mode === "exam-day") return { mode, questions: [], durationMs: 0 }; if (mode === "mock") return { mode, questions: buildMockPlan(bank, states, now), durationMs: EXAM_DURATION_MS }; if (mode === "coverage") return { mode, questions: byPriority(bank, states, now, new Set(), false).slice(0, EXAM_QUESTION_COUNT), durationMs: EXAM_DURATION_MS }; return { mode, questions: buildAdaptiveReviewPlan(bank, states, now), durationMs: EXAM_DURATION_MS }; }
export function selectTerminalQuestion(bank, states, now = Date.now(), exclude = new Set()) { return selectNext(bank, states, now, exclude); }
export function buildSessionPlan(bank, states, now = Date.now(), sessionSize = EXAM_QUESTION_COUNT) { return buildAdaptiveReviewPlan(bank, states, now, sessionSize); }
export function reviewInterval(correct, state) { if (!correct) return 5; const next = state?.nextReviewAt; if (!next || !state?.lastSeenAt) return 0; return Math.max(0, Math.round((next - state.lastSeenAt) / (24 * 60 * 60 * 1000))); }

export function terminalDashboardMetrics(bank, states, events = [], now = Date.now(), sessionAnswers = []) {
  const counts = { unseen: 0, learning: 0, weak: 0, mastered: 0, due: 0 }; for (const question of bank) { const state = states[question.id]; const status = state?.status ?? "unseen"; counts[status] += 1; if (status !== "unseen" && due(state, now)) counts.due += 1; }
  const dates = new Set(events.filter((event) => event?.type === "ANSWER_RECORDED").map((event) => calendarDay(event.timestamp))); let streak = 0; let cursor = new Date(now); while (dates.has(calendarDay(cursor.getTime()))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  const summary = sessionStats(sessionAnswers); return { ...counts, streak, dailyAnswered: events.filter((event) => event?.type === "ANSWER_RECORDED" && calendarDay(event.timestamp) === calendarDay(now)).length, dailyComplete: sessionAnswers.length >= EXAM_QUESTION_COUNT, sessionAccuracy: summary.accuracy, averageResponseMs: summary.averageResponseMs };
}
function calendarDay(timestamp) { const date = new Date(timestamp); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
export function completionSummary(answers, beforeStates = {}, afterStates = {}, bank = []) {
  const summary = sessionStats(answers); const byTask = Object.fromEntries(Object.keys(TASK_DISTRIBUTION).map((task) => [task, { answered: 0, correct: 0 }]));
  for (const answer of answers) { const task = bank.find((question) => question.id === answer.questionId)?.task; if (task) { byTask[task].answered += 1; byTask[task].correct += answer.correct ? 1 : 0; } }
  const newlyMastered = Object.keys(afterStates).filter((id) => afterStates[id]?.status === "mastered" && beforeStates[id]?.status !== "mastered").length; const weak = answers.filter((answer) => !answer.correct).length; const weakestTask = Object.entries(byTask).filter(([, value]) => value.answered).sort(([, a], [, b]) => (a.correct / a.answered) - (b.correct / b.answered))[0]?.[0];
  return { ...summary, byTask, newlyMastered, weak, weakestTask: weakestTask ? Number(weakestTask) : undefined, nextAction: summary.passed ? "Keep the streak with a short review tomorrow." : "Review the missed and weak questions while they are fresh.", unlockMessage: summary.passed ? "Safety target reached (20/25)." : "Safety target not reached (20/25)." };
}
export function renderCompletionSummary(summary) { return `Score ${summary.correct}/${summary.answered} · ${Math.round(summary.accuracy * 100)}% · ${summary.passed ? "PASS" : "REVIEW"}\n${summary.newlyMastered} newly mastered · ${summary.weak} weak\n${summary.nextAction}`; }
export function reduceTerminalEvents(events) { return [...events].filter((event) => event?.type === "ANSWER_RECORDED").sort((a, b) => a.timestamp - b.timestamp || String(a.deviceId).localeCompare(String(b.deviceId)) || String(a.eventId).localeCompare(String(b.eventId))).reduce(applyTerminalAnswer, {}); }
export function applyTerminalAnswer(states, event) { const questionId = Number(event.payload?.questionId); if (!Number.isFinite(questionId)) return states; states[questionId] = recordAnswer(states[questionId], Boolean(event.payload?.correct), event.timestamp, Number(event.payload?.responseMs) || 0); return states; }
export function makeAnswerEvent({ questionId, selected, correct, responseMs, eventId, deviceId, timestamp, sessionId }) { return { eventId, deviceId, timestamp, type: "ANSWER_RECORDED", payload: { questionId, answer: selected, selected, correct, responseMs, sessionId } }; }
