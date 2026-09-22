#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateQuestionBank } from "../src/terminalQuiz.mjs";

const source = new URL("../data/ccse-2026-questions.json", import.meta.url);
const payload = JSON.parse(await readFile(source, "utf8"));
const bank = payload.questions;
const validation = validateQuestionBank(bank);
const metadataErrors = [];
if (payload.count !== bank.length) metadataErrors.push(`declared count ${payload.count} differs from ${bank.length}`);
if (payload.task_counts && Object.entries(validation.counts).some(([task, count]) => Number(payload.task_counts[task]) !== count)) metadataErrors.push("declared task counts differ from records");
const duplicateIds = new Set();
const duplicateTexts = new Map();
const seenIds = new Set();
const seenTexts = new Map();
const suspicious = [];
for (const question of bank) {
  if (seenIds.has(question.id)) duplicateIds.add(question.id);
  seenIds.add(question.id);
  const text = question.question.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("es");
  if (seenTexts.has(text)) duplicateTexts.set(question.id, seenTexts.get(text));
  else seenTexts.set(text, question.id);
  const combined = [question.question, ...Object.values(question.options)].join(" ");
  if (/PREGUNTAS|�|\u0000/u.test(combined)) suspicious.push(question.id);
}
const report = {
  source: payload.source,
  declaredCount: payload.count,
  total: bank.length,
  uniqueIds: seenIds.size,
  duplicateIds: [...duplicateIds],
  duplicateTextPairs: [...duplicateTexts].map(([duplicate, original]) => ({ duplicate, original })),
  taskCounts: validation.counts,
  requiredQuestionRanges: { 1: "1001–1120", 2: "2001–2036", 3: "3001–3024", 4: "4001–4036", 5: "5001–5084" },
  malformedRecords: validation.errors,
  metadataErrors,
  suspiciousTextIds: suspicious,
  missingExplanations: bank.filter((question) => !question.explanation?.trim()).map(({ id }) => id),
};
console.log(JSON.stringify(report, null, 2));
if (!validation.valid || metadataErrors.length || duplicateIds.size || duplicateTexts.size || suspicious.length) process.exitCode = 1;
