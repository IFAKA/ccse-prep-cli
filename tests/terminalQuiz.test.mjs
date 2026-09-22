import { describe, expect, it } from "vitest";
import { answerKeyForInput, answerReview, buildAdaptiveReviewPlan, buildMockPlan, canFinish, completionSummary, EXAM_DURATION_MS, explanationForQuestion, PREP_PASS_TARGET, questionBankFingerprint, readinessSummary, reduceTerminalEvents, resumeSession, sessionModeForDate, sessionPlanForDate, selectTerminalQuestion, terminalSummary, TASK_DISTRIBUTION, validateQuestionBank, wrongAnswerReview } from "../src/terminalQuiz.mjs";
import questionsData from "../data/ccse-2026-questions.json" with { type: "json" };

const questions = questionsData.questions;

describe("terminal quiz", () => {
  it("maps j, k, and l directly to a, b, and c", () => {
    expect(answerKeyForInput("j")).toBe("a");
    expect(answerKeyForInput("K")).toBe("b");
    expect(answerKeyForInput("l")).toBe("c");
    expect(answerKeyForInput("x")).toBeUndefined();
  });

  it("requires a complete 25-question session", () => {
    const answers = Array.from({ length: 24 }, (_, index) => ({ correct: index % 2 === 0 }));
    expect(canFinish(answers)).toBe(false);
    answers.push({ correct: false });
    expect(canFinish(answers)).toBe(true);
    expect(terminalSummary(answers)).toEqual({ answered: 25, correct: 12 });
  });

  it("uses persisted answers to prioritize unseen and due weak questions", () => {
    const now = 100000;
    const events = [
      { eventId: "weak", deviceId: "terminal", timestamp: now - 1, type: "ANSWER_RECORDED", payload: { questionId: 1001, correct: false, responseMs: 10 } },
      { eventId: "learning", deviceId: "terminal", timestamp: now, type: "ANSWER_RECORDED", payload: { questionId: 1002, correct: true, responseMs: 10 } },
    ];
    const states = reduceTerminalEvents(events);
    expect(selectTerminalQuestion(questions, states, now).id).toBe(1003);
    expect(selectTerminalQuestion(questions.slice(0, 2), states, now, new Set([1002])).id).toBe(1001);
  });

  it("updates the schedule when a current-session answer is recorded", () => {
    const states = reduceTerminalEvents([]);
    const next = selectTerminalQuestion(questions, states, 0);
    expect(next.id).toBe(1001);
    states[next.id] = reduceTerminalEvents([
      { eventId: "answer", deviceId: "terminal", timestamp: 0, type: "ANSWER_RECORDED", payload: { questionId: next.id, correct: true, responseMs: 10 } },
    ])[next.id];
    expect(selectTerminalQuestion(questions, states, 0, new Set([next.id])).id).toBe(1002);
  });

  it("builds concise review entries for every wrong answer", () => {
    const bank = [{
      id: 1,
      question: "¿Cuál es la capital?",
      options: { a: "Madrid", b: "Lisboa", c: "París" },
      answer: "a",
      explanation: "Madrid es la capital de España.",
    }];
    expect(wrongAnswerReview([
      { questionId: 1, selected: "b", correct: false },
      { questionId: 1, selected: "a", correct: true },
    ], bank)).toEqual([{
      question: "¿Cuál es la capital?",
      wrong: "Lisboa",
      correct: "Madrid",
      explanation: "Madrid es la capital de España.",
    }]);
  });

  it("builds a Why explanation for correct and incorrect answers", () => {
    const bank = [{
      id: 1,
      question: "¿Quién hace el control?",
      options: { a: "La Policía Nacional.", b: "La Policía local.", c: "La Guardia Civil." },
      answer: "a",
    }];
    const reviews = answerReview([
      { questionId: 1, selected: "a", correct: true },
      { questionId: 1, selected: "b", correct: false },
    ], bank);
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({ correctAnswer: true, explanation: "«La Policía Nacional.» es la persona o institución que corresponde." });
    expect(reviews[1]).toMatchObject({ correctAnswer: false, explanation: "«La Policía Nacional.» es la persona o institución que corresponde." });
  });

  it("provides an explanation for every reviewed answer", () => {
    const reviews = answerReview(questions.slice(0, 10).map((question) => ({
      questionId: question.id,
      selected: question.answer,
      correct: true,
    })), questions);
    expect(reviews).toHaveLength(10);
    expect(reviews.every((review) => review.correctAnswer && review.explanation.length > 0)).toBe(true);
  });

  it("provides a concise explanation for every exam question", () => {
    expect(questions.every((question) => {
      const correct = question.options[question.answer];
      return typeof correct === "string" && explanationForQuestion(question, correct).length > 0;
    })).toBe(true);
  });

  it("validates the bundled official 2026 bank shape", () => {
    expect(validateQuestionBank(questions)).toMatchObject({ valid: true, counts: { 1: 120, 2: 36, 3: 24, 4: 36, 5: 84 } });
  });

  it("builds the official 10/3/2/3/7 mock distribution", () => {
    const plan = buildMockPlan(questions, {}, Date.now(), () => 0.5);
    expect(plan).toHaveLength(25);
    expect(plan.reduce((counts, question) => { counts[question.task] += 1; return counts; }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toEqual(TASK_DISTRIBUTION);
    expect(EXAM_DURATION_MS).toBe(45 * 60 * 1000);
  });

  it("samples mock questions independently of training state", () => {
    const weakStates = Object.fromEntries(questions.map((question) => [question.id, { status: "weak", attempts: 4, correct: 0 }]));
    const random = () => 0.5;
    expect(buildMockPlan(questions, {}, 0, random).map(({ id }) => id))
      .toEqual(buildMockPlan(questions, weakStates, 1, random).map(({ id }) => id));
  });

  it("varies mock samples and reaches both ends of each task bank", () => {
    let state = 0x12345678;
    const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 0x100000000; };
    const seen = new Set();
    for (let exam = 0; exam < 10000; exam += 1) {
      const plan = buildMockPlan(questions, {}, 0, random);
      expect(plan).toHaveLength(25);
      expect(new Set(plan.map(({ id }) => id)).size).toBe(25);
      expect(plan.reduce((counts, question) => { counts[question.task] += 1; return counts; }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toEqual(TASK_DISTRIBUTION);
      for (const question of plan) seen.add(question.id);
    }
    expect(seen.size).toBe(300);
  });

  it("uses weak questions before unseen questions in adaptive review", () => {
    const states = reduceTerminalEvents([{ eventId: "weak", deviceId: "terminal", timestamp: 1, type: "ANSWER_RECORDED", payload: { questionId: 1001, correct: false } }]);
    expect(buildAdaptiveReviewPlan(questions, states, 1)[0].id).toBe(1001);
  });

  it("switches from broad coverage to weak review, mocks, and no exam-day session", () => {
    expect(sessionModeForDate(new Date("2026-09-19T12:00:00Z"))).toBe("coverage");
    expect(sessionModeForDate(new Date("2026-09-20T12:00:00Z"))).toBe("weak-review");
    expect(sessionModeForDate(new Date("2026-09-22T12:00:00Z"))).toBe("mock");
    expect(sessionModeForDate(new Date("2026-09-24T12:00:00Z"))).toBe("exam-day");
    expect(PREP_PASS_TARGET).toBe(20);
  });

  it("marks review and mock plans with their learning behavior", () => {
    const review = sessionPlanForDate(questions, {}, new Date("2026-09-20T12:00:00Z"));
    const mock = sessionPlanForDate(questions, {}, new Date("2026-09-22T12:00:00Z"));
    expect(review).toMatchObject({ sessionKind: "weak-review", feedbackMode: "immediate" });
    expect(mock).toMatchObject({ sessionKind: "mock", feedbackMode: "end-of-session" });
    expect(new Set(mock.questions.map((question) => question.id)).size).toBe(25);
  });

  it("puts the previous completed session's misses into delayed review first", () => {
    const events = [{ type: "SESSION_COMPLETED", timestamp: 10, payload: { wrongQuestionIds: [1005, 1001] } }];
    const plan = sessionPlanForDate(questions, {}, new Date("2026-09-20T12:00:00Z"), events);
    expect(plan.delayedQuestionIds.slice(0, 2)).toEqual([1005, 1001]);
    expect(plan.questions.slice(0, 2).map((question) => question.id)).toEqual([1005, 1001]);
  });

  it("separates delayed and fresh scores and keeps both pass thresholds", () => {
    const answers = Array.from({ length: 25 }, (_, index) => ({ questionId: index + 1, correct: index < 20 }));
    const summary = completionSummary(answers, { 1: { status: "weak" } }, {}, answers.map(({ questionId }) => ({ id: questionId, task: 1 })), { delayedQuestionIds: [1], total: 25, sessionKind: "weak-review" });
    expect(summary).toMatchObject({ officialPassed: true, safetyPassed: true, unanswered: 0, wrongQuestionIds: [21, 22, 23, 24, 25] });
    expect(summary.delayedReview).toMatchObject({ answered: 1, correct: 1 });
    expect(summary.freshScore).toMatchObject({ answered: 24, correct: 19 });
  });

  it("reports an incomplete timed-out session without passing it", () => {
    const answers = Array.from({ length: 14 }, (_, index) => ({ questionId: index + 1, correct: true }));
    const summary = completionSummary(answers, {}, {}, questions, { timedOut: true, total: 25, sessionKind: "mock" });
    expect(summary).toMatchObject({ timedOut: true, unanswered: 11, officialPassed: false, safetyPassed: false });
  });

  it("enforces the real pass boundary at exactly 15 correct", () => {
    for (const [correct, expected] of [[0, false], [14, false], [15, true], [16, true], [25, true]]) {
      const answers = Array.from({ length: 25 }, (_, index) => ({ correct: index < correct }));
      expect(completionSummary(answers).officialPassed).toBe(expected);
    }
  });

  it("gives no official points for wrong or blank answers", () => {
    const wrongAnswers = Array.from({ length: 25 }, (_, index) => ({ correct: index < 14 }));
    const blanks = Array.from({ length: 14 }, () => ({ correct: true }));
    expect(completionSummary(wrongAnswers).correct).toBe(14);
    expect(completionSummary(blanks, {}, {}, [], { total: 25 }).unanswered).toBe(11);
    expect(completionSummary(blanks, {}, {}, [], { total: 25 }).officialPassed).toBe(false);
    expect(completionSummary([], {}, {}, [], { total: 25 })).toMatchObject({ correct: 0, answered: 0, unanswered: 25, officialPassed: false });
  });

  it("rejects duplicate text, malformed choices, missing IDs, and wrong task IDs", () => {
    const base = questions.map((question) => ({ ...question, options: { ...question.options } }));
    base[1].question = base[0].question;
    base[2].options = { a: "", b: "x", c: "x" };
    base[3].id = 9999;
    const errors = validateQuestionBank(base).errors.join(" ");
    expect(errors).toContain("duplicate question text");
    expect(errors).toContain("empty or invalid answer choice");
    expect(errors).toContain("duplicate answer choices");
    expect(errors).toContain("unreachable id 9999");
    const contaminated = questions.map((question) => ({ ...question, options: { ...question.options } }));
    contaminated[0].options.c += " PREGUNTAS";
    expect(validateQuestionBank(contaminated).errors.join(" ")).toContain("suspicious extracted text");
  });

  it("keeps readiness evidence limited to complete mocks", () => {
    const events = [];
    const fingerprints = questionBankFingerprint(questions);
    let randomState = 42;
    const random = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 0x100000000; };
    function addMock(index, score) {
      const sessionId = `s-${index}`;
      const plan = buildMockPlan(questions, {}, index, random);
      events.push({ eventId: `done-${index}`, timestamp: index, type: "SESSION_COMPLETED", payload: { sessionId, sessionKind: "mock", answered: 25, correct: score, bankFingerprint: fingerprints, questionIds: plan.map(({ id }) => id) } });
      for (const [answerIndex, question] of plan.entries()) {
        const selected = answerIndex < score ? question.answer : Object.keys(question.options).find((key) => key !== question.answer);
        events.push({ eventId: `answer-${index}-${answerIndex}`, timestamp: index, type: "ANSWER_RECORDED", payload: { sessionId, questionId: question.id, selected, correct: selected === question.answer, responseMs: 50, bankFingerprint: fingerprints } });
      }
      return plan;
    }
    const plans = [addMock(0, 20), addMock(1, 21), addMock(2, 20), addMock(3, 22)];
    events.push({ eventId: "training", timestamp: 10, type: "SESSION_COMPLETED", payload: { sessionKind: "practice", answered: 25, correct: 25 } });
    const seenStates = Object.fromEntries(questions.slice(0, 100).map(({ id }) => [id, { status: "learning" }]));
    const readiness = readinessSummary(events, questions, seenStates);
    expect(readiness.lastMocks).toHaveLength(4);
    expect(readiness.mockQuestionsSeen).toBe(new Set(plans.flat().map(({ id }) => id)).size);
    expect(readiness.uniqueQuestionsSeen).toBe(100);
    expect(readiness.remainingUnseenQuestions).toBe(200);
    expect(readiness.consistentMargin).toBe(true);
    addMock(4, 14);
    expect(readinessSummary(events, questions, seenStates).consistentMargin).toBe(false);
    const changedBank = questions.map((question, index) => index ? question : { ...question, question: `${question.question} cambiada` });
    expect(readinessSummary(events, changedBank).lastMocks).toHaveLength(0);
  });

  it("resumes only the same valid bank and question sequence", () => {
    const fingerprint = questionBankFingerprint(questions);
    const plan = buildMockPlan(questions, {}, 0, () => 0.25);
    const started = { type: "SESSION_STARTED", timestamp: 1, payload: { sessionId: "s", sessionKind: "mock", bankFingerprint: fingerprint, questionIds: plan.map(({ id }) => id) } };
    const answer = { type: "ANSWER_RECORDED", payload: { sessionId: "s", questionId: plan[0].id, selected: plan[0].answer, correct: true, responseMs: 100 } };
    expect(resumeSession(started, [answer], questions, fingerprint).answers).toHaveLength(1);
    expect(resumeSession(started, [answer], questions, "stale")).toBeUndefined();
    expect(resumeSession({ ...started, payload: { ...started.payload, questionIds: plan.map(({ id }) => id).fill(99999) } }, [], questions, fingerprint)).toBeUndefined();
    expect(() => resumeSession(started, [{ ...answer, payload: { ...answer.payload, correct: false } }], questions, fingerprint))
      .toThrow("do not match the resumable question sequence");
  });
});
