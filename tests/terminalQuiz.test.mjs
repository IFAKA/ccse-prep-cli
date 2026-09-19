import { describe, expect, it } from "vitest";
import { answerKeyForInput, answerReview, buildMockPlan, canFinish, EXAM_DURATION_MS, explanationForQuestion, PREP_PASS_TARGET, reduceTerminalEvents, sessionModeForDate, selectTerminalQuestion, terminalSummary, TASK_DISTRIBUTION, validateQuestionBank, wrongAnswerReview } from "../src/terminalQuiz.mjs";
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
    const plan = buildMockPlan(questions, {}, Date.now());
    expect(plan).toHaveLength(25);
    expect(plan.reduce((counts, question) => { counts[question.task] += 1; return counts; }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toEqual(TASK_DISTRIBUTION);
    expect(EXAM_DURATION_MS).toBe(45 * 60 * 1000);
  });

  it("uses weak questions before unseen questions in adaptive review", () => {
    const states = reduceTerminalEvents([{ eventId: "weak", deviceId: "terminal", timestamp: 1, type: "ANSWER_RECORDED", payload: { questionId: 1001, correct: false } }]);
    expect(buildMockPlan(questions, states, 1)[0].id).toBe(1001);
  });

  it("switches from broad coverage to weak review, mocks, and no exam-day session", () => {
    expect(sessionModeForDate(new Date("2026-09-19T12:00:00Z"))).toBe("coverage");
    expect(sessionModeForDate(new Date("2026-09-20T12:00:00Z"))).toBe("weak-review");
    expect(sessionModeForDate(new Date("2026-09-22T12:00:00Z"))).toBe("mock");
    expect(sessionModeForDate(new Date("2026-09-24T12:00:00Z"))).toBe("exam-day");
    expect(PREP_PASS_TARGET).toBe(20);
  });
});
