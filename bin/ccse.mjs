#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import packageData from "../package.json" with { type: "json" };
import questionsData from "../data/ccse-2026-questions.json" with { type: "json" };
import { runTerminalTui } from "../src/terminalTui.mjs";
import { explanationForQuestion, reduceTerminalEvents, sessionPlanForDate, validateQuestionBank } from "../src/terminalQuiz.mjs";
import { formatBankInfo, loadQuestionBank } from "../src/questionBank.mjs";

const bundledBank = questionsData.questions.map((question) => ({
  ...question,
  explanation: explanationForQuestion(question),
}));
const dataDir = process.env.CCSE_DATA_DIR || join(homedir(), ".local", "share", "ccse-prep");
const eventLogPath = join(dataDir, "events.json");
const devicePath = join(dataDir, "terminal-device-id");

async function stableDeviceId() {
  await mkdir(dataDir, { recursive: true });
  try { return (await readFile(devicePath, "utf8")).trim(); } catch {}
  const id = `terminal-${randomUUID()}`;
  await writeFile(devicePath, `${id}\n`, { mode: 0o600 });
  return id;
}

async function appendEvent(event) {
  await mkdir(dataDir, { recursive: true });
  let events = [];
  try {
    const parsed = JSON.parse(await readFile(eventLogPath, "utf8"));
    if (Array.isArray(parsed.events)) events = parsed.events;
  } catch {}
  if (!events.some((current) => current.eventId === event.eventId)) events.push(event);
  await writeFile(eventLogPath, `${JSON.stringify({ schemaVersion: 2, events }, null, 2)}\n`, { mode: 0o600 });
}

async function loadEvents() {
  try {
    const parsed = JSON.parse(await readFile(eventLogPath, "utf8"));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function runQuiz(bank) {
  const deviceId = await stableDeviceId();
  const events = await loadEvents();
  const states = reduceTerminalEvents(events);
  const now = Date.now();
  const plan = sessionPlanForDate(bank, states, new Date(now), events);
  if (plan.mode === "exam-day") {
    console.log("CCSE exam day: automatic preparation is paused. Good luck.");
    return true;
  }
  const today = dayKey(now);
  const started = [...events].reverse().find((event) => event.type === "SESSION_STARTED" && event.payload?.day === today && event.payload?.deviceId === deviceId);
  const completedIds = new Set(events.filter((event) => event.type === "SESSION_COMPLETED").map((event) => event.payload?.sessionId));
  const resumable = started && !completedIds.has(started.payload.sessionId);
  const sessionId = resumable ? started.payload.sessionId : `${deviceId}-${today}`;
  const resumeAnswers = events
    .filter((event) => event.type === "ANSWER_RECORDED" && event.payload?.sessionId === sessionId)
    .map((event) => ({ questionId: Number(event.payload.questionId), selected: event.payload.selected ?? event.payload.answer, correct: Boolean(event.payload.correct), responseMs: Number(event.payload.responseMs) || 0 }));
  const sessionPlan = resumable && Array.isArray(started.payload.questionIds)
    ? { ...plan, startedAt: started.timestamp, questions: started.payload.questionIds.map((id) => bank.find((question) => question.id === id)).filter(Boolean) }
    : { ...plan, startedAt: now };
  if (!resumable) {
    await appendEvent({ eventId: `${sessionId}-started`, deviceId, timestamp: now, type: "SESSION_STARTED", payload: { sessionId, day: today, mode: plan.mode, sessionKind: plan.sessionKind, feedbackMode: plan.feedbackMode, delayedQuestionIds: plan.delayedQuestionIds ?? [], deviceId, questionIds: plan.questions.map((question) => question.id) } });
  }
  let completed = false;
  let completionWrite;
  await runTerminalTui({ bank, states, events, deviceId, appendEvent, now, plan: sessionPlan, sessionId, resumeAnswers, onDone: async (summary) => {
    completed = true;
    completionWrite = appendEvent({ eventId: `${sessionId}-completed`, deviceId, timestamp: Date.now(), type: "SESSION_COMPLETED", payload: { sessionId, mode: sessionPlan.mode, sessionKind: sessionPlan.sessionKind, feedbackMode: sessionPlan.feedbackMode, ...summary } });
    await completionWrite;
  } });
  if (completionWrite) await completionWrite;
  return completed;
}

async function main() {
  if (process.argv.includes("--version")) { console.log(`ccse-prep-cli ${packageData.version}`); return; }
  if (process.argv.includes("--help")) {
    console.log("CCSE Prep CLI — terminal-first CCSE study tool");
    console.log("\nCommands:");
    console.log("  ccse                 Start a study session");
    console.log("  ccse --bank-info     Show active question-bank status");
    console.log("  ccse --update-bank   Force a question-bank refresh");
    console.log("  ccse --validate-bank Validate the bundled bank");
    console.log("  ccse --path          Show the local progress-log path");
    console.log("\nIncludes 300 questions, adaptive review, mock exams, a 45-minute timer, resume support, offline fallback, and automatic bank updates.");
    return;
  }
  if (process.argv.includes("--path")) { console.log(eventLogPath); return; }
  if (process.argv.includes("--validate-bank")) {
    const result = validateQuestionBank(bundledBank);
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  const forceUpdate = process.argv.includes("--update-bank");
  const bankInfo = await loadQuestionBank({ bundledPayload: { ...questionsData, questions: bundledBank }, dataDir, force: forceUpdate });
  if (process.argv.includes("--bank-info")) {
    console.log(formatBankInfo(bankInfo));
    return;
  }
  if (forceUpdate) {
    if (bankInfo.source === "updated") {
      console.log(formatBankInfo(bankInfo));
      return;
    }
    process.stderr.write(`Question bank update failed; using ${bankInfo.source} data.\n`);
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY) {
    process.stderr.write("CCSE start gate needs an interactive terminal.\n");
    process.exitCode = 2;
    return;
  }
  const completed = await runQuiz(bankInfo.bank);
  if (!completed) process.exitCode = 3;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
