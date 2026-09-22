#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildMockPlan, TASK_DISTRIBUTION, validateQuestionBank } from "../src/terminalQuiz.mjs";

const trials = Number(process.argv[2] ?? 100000);
if (!Number.isInteger(trials) || trials < 1) throw new RangeError("trial count must be a positive integer");
const { questions } = JSON.parse(await readFile(new URL("../data/ccse-2026-questions.json", import.meta.url), "utf8"));
const validation = validateQuestionBank(questions);
if (!validation.valid) throw new Error(`invalid source bank: ${validation.errors.join("; ")}`);
let seed = 0x51cc5e;
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000; };
const frequencies = new Map(questions.map(({ id }) => [id, 0]));
let invariantErrors = 0;
for (let trial = 0; trial < trials; trial += 1) {
  const plan = buildMockPlan(questions, {}, trial, random);
  const unique = new Set(plan.map(({ id }) => id));
  const tasks = Object.fromEntries(Object.keys(TASK_DISTRIBUTION).map((task) => [task, 0]));
  if (plan.length !== 25 || unique.size !== 25 || plan.some(({ id }) => !frequencies.has(id))) invariantErrors += 1;
  for (const question of plan) { tasks[question.task] += 1; frequencies.set(question.id, frequencies.get(question.id) + 1); }
  if (Object.entries(TASK_DISTRIBUTION).some(([task, count]) => tasks[task] !== count)) invariantErrors += 1;
}
const byTask = {};
for (const [task, expectedCount] of Object.entries(TASK_DISTRIBUTION)) {
  const members = questions.filter((question) => question.task === Number(task));
  const expected = trials * expectedCount / members.length;
  const sigma = Math.sqrt(trials * (expectedCount / members.length) * (1 - expectedCount / members.length));
  const values = members.map(({ id }) => frequencies.get(id));
  const maxDeviationSigma = Math.max(...values.map((value) => Math.abs(value - expected) / sigma));
  byTask[task] = {
    bankSize: members.length,
    quotaPerExam: expectedCount,
    expectedPerQuestion: expected,
    minObserved: Math.min(...values),
    maxObserved: Math.max(...values),
    maximumDeviationInStandardDeviations: Number(maxDeviationSigma.toFixed(3)),
    toleranceSigma: 5,
  };
  if (maxDeviationSigma > 5) invariantErrors += 1;
}
const report = { trials, invariantErrors, uniqueQuestionsReached: [...frequencies.values()].filter((count) => count > 0).length, unreachableQuestions: [...frequencies].filter(([, count]) => count === 0).map(([id]) => id), byTask };
console.log(JSON.stringify(report, null, 2));
if (invariantErrors || report.unreachableQuestions.length) process.exitCode = 1;
