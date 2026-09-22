#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import packageData from "../package.json" with { type: "json" };
import questionsData from "../data/ccse-2026-questions.json" with { type: "json" };
import { runTerminalTui } from "../src/terminalTui.mjs";
import { explicitSessionPlan, explanationForQuestion, questionBankFingerprint, readinessSummary, reduceTerminalEvents, resumeSession, sessionPlanForDate, validateQuestionBank } from "../src/terminalQuiz.mjs";
import { appendEvent as appendStoredEvent, readEvents } from "../src/eventStore.mjs";
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
  await appendStoredEvent(eventLogPath, event);
}

async function loadEvents() {
  return readEvents(eventLogPath);
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function runQuiz(bank, forcedKind) {
  const deviceId = await stableDeviceId();
  const events = await loadEvents();
  const states = reduceTerminalEvents(events, questionBankFingerprint(bank));
  const now = Date.now();
  const bankFingerprint = questionBankFingerprint(bank);
  const plan = forcedKind ? explicitSessionPlan(bank, states, forcedKind, now) : sessionPlanForDate(bank, states, new Date(now), events);
  if (plan.mode === "exam-day") {
    console.log("CCSE exam day: automatic preparation is paused. Good luck.");
    return true;
  }
  const today = dayKey(now);
  const started = [...events].reverse().find((event) => event.type === "SESSION_STARTED" && event.payload?.day === today && event.payload?.deviceId === deviceId);
  const completedIds = new Set(events.filter((event) => event.type === "SESSION_COMPLETED").map((event) => event.payload?.sessionId));
  const resumable = started && !completedIds.has(started.payload.sessionId);
  const sessionId = resumable ? started.payload.sessionId : `${deviceId}-${today}-${randomUUID()}`;
  const resumeData = resumable ? resumeSession(started, events, bank, bankFingerprint) : undefined;
  const validResume = Boolean(resumeData);
  const actualSessionId = validResume ? sessionId : `${deviceId}-${today}-${randomUUID()}`;
  const sessionInitialStates = reduceTerminalEvents(events.filter((event) => event.type !== "ANSWER_RECORDED" || event.payload?.sessionId !== actualSessionId), bankFingerprint);
  const sessionPlan = validResume
    ? { ...plan, startedAt: started.timestamp, questions: resumeData.questions }
    : { ...plan, startedAt: now };
  if (!resumable) {
    await appendEvent({ eventId: `${actualSessionId}-started`, deviceId, timestamp: now, type: "SESSION_STARTED", payload: { sessionId: actualSessionId, day: today, mode: plan.mode, sessionKind: plan.sessionKind, feedbackMode: plan.feedbackMode, delayedQuestionIds: plan.delayedQuestionIds ?? [], deviceId, bankFingerprint, questionIds: plan.questions.map((question) => question.id) } });
  } else if (!validResume) {
    await appendEvent({ eventId: `${actualSessionId}-started`, deviceId, timestamp: now, type: "SESSION_STARTED", payload: { sessionId: actualSessionId, day: today, mode: plan.mode, sessionKind: plan.sessionKind, feedbackMode: plan.feedbackMode, delayedQuestionIds: plan.delayedQuestionIds ?? [], deviceId, bankFingerprint, questionIds: plan.questions.map((question) => question.id) } });
  }
  let completed = false;
  let completionWrite;
  await runTerminalTui({ bank, states, sessionInitialStates, events, deviceId, bankFingerprint, appendEvent, now, plan: sessionPlan, sessionId: actualSessionId, resumeAnswers: validResume ? resumeData.answers : [], onDone: async (summary) => {
    completed = true;
    completionWrite = appendEvent({ eventId: `${actualSessionId}-completed`, deviceId, timestamp: Date.now(), type: "SESSION_COMPLETED", payload: { sessionId: actualSessionId, mode: sessionPlan.mode, sessionKind: sessionPlan.sessionKind, feedbackMode: sessionPlan.feedbackMode, bankFingerprint, ...summary } });
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
    console.log("  ccse --mock          Start an unbiased 25-question mock exam");
    console.log("  ccse --practice      Review weak and unseen questions with feedback");
    console.log("  ccse --bank-info     Show active question-bank status");
    console.log("  ccse --update-bank   Force a question-bank refresh");
    console.log("  ccse --validate-bank Validate the bundled bank");
    console.log("  ccse --path          Show the local progress-log path");
    console.log("  ccse --readiness     Show recent unbiased mock evidence");
    console.log("\nIncludes 300 questions, adaptive review, mock exams, a 45-minute timer, resume support, offline fallback, and automatic bank updates.");
    return;
  }
  if (process.argv.includes("--path")) { console.log(eventLogPath); return; }
  if (process.argv.includes("--readiness")) {
    const bankInfo = await loadQuestionBank({ bundledPayload: { ...questionsData, questions: bundledBank }, dataDir });
    const events = await loadEvents();
    const fingerprint = questionBankFingerprint(bankInfo.bank);
    const readiness = readinessSummary(events, bankInfo.bank, reduceTerminalEvents(events, fingerprint));
    console.log(JSON.stringify(readiness, null, 2));
    return;
  }
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
  const forcedKind = process.argv.includes("--mock") ? "mock" : process.argv.includes("--practice") ? "practice" : undefined;
  const completed = await runQuiz(bankInfo.bank, forcedKind);
  if (!completed) process.exitCode = 3;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
