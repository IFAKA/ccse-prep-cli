import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateQuestionBank } from "./terminalQuiz.mjs";

export const BANK_CACHE_FILENAME = "question-bank.json";
export const BANK_METADATA_FILENAME = "question-bank-meta.json";
export const BANK_UPDATE_STATE_FILENAME = "question-bank-update.json";
export const BANK_DAILY_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const BANK_NORMAL_UPDATE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_BANK_URL = "https://raw.githubusercontent.com/IFAKA/ccse-prep-cli/master/data/ccse-2026-questions.json";

function cachePaths(dataDir) {
  return {
    bank: join(dataDir, BANK_CACHE_FILENAME),
    metadata: join(dataDir, BANK_METADATA_FILENAME),
    updateState: join(dataDir, BANK_UPDATE_STATE_FILENAME),
  };
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; }
}

function validatePayload(payload) {
  const result = validateQuestionBank(payload?.questions ?? []);
  if (!result.valid) throw new Error(`Question bank failed validation: ${result.errors.join("; ")}`);
  if (payload.count !== undefined && payload.count !== payload.questions.length) throw new Error(`Question bank count metadata mismatch: expected ${payload.questions.length}, got ${payload.count}`);
  if (payload.task_counts && Object.entries(result.counts).some(([task, count]) => Number(payload.task_counts[task]) !== count)) throw new Error("Question bank task count metadata mismatch");
  return payload;
}

function payloadText(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(path, content) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, { mode: 0o600 });
  await rename(temporaryPath, path);
}

async function loadCachedBank(paths) {
  const payload = await readJson(paths.bank);
  if (!payload) return undefined;
  try {
    validatePayload(payload);
    return { bank: payload.questions, metadata: await readJson(paths.metadata) };
  } catch {
    return undefined;
  }
}

function bankInfo(bank, metadata, source) {
  return {
    bank,
    source,
    version: metadata?.version ?? "bundled",
    effectiveDate: metadata?.effectiveDate,
    sha256: metadata?.sha256,
    fetchedAt: metadata?.fetchedAt,
    lastCheckedAt: metadata?.lastCheckedAt,
  };
}

export function bankUpdateInterval(now = Date.now()) {
  const month = new Date(now).getUTCMonth();
  return month === 11 || month === 0 ? BANK_DAILY_UPDATE_INTERVAL_MS : BANK_NORMAL_UPDATE_INTERVAL_MS;
}

export async function loadQuestionBank({ bundledPayload, dataDir, force = false, fetchImpl = globalThis.fetch, now = Date.now(), sourceUrl = process.env.CCSE_BANK_URL || DEFAULT_BANK_URL }) {
  const paths = cachePaths(dataDir);
  await mkdir(dataDir, { recursive: true });
  const cached = await loadCachedBank(paths);
  const updateState = await readJson(paths.updateState);
  const checkedRecently = Number.isFinite(updateState?.lastCheckedAt) && now - updateState.lastCheckedAt < bankUpdateInterval(now);
  if (!force && checkedRecently) {
    if (cached) return { ...bankInfo(cached.bank, cached.metadata, "cache"), updateError: updateState?.error };
    return { ...bankInfo(bundledPayload.questions, { version: "bundled" }, "bundled"), updateError: updateState?.error };
  }

  let updateError;
  try {
    if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable");
    const response = await fetchImpl(sourceUrl, { headers: { accept: "application/json" } });
    if (!response?.ok) throw new Error(`Question bank download failed (${response?.status ?? "unknown status"})`);
    const payload = validatePayload(await response.json());
    const serialized = payloadText(payload);
    const metadata = {
      schemaVersion: 1,
      version: payload.version ?? `sha256-${sha256(serialized).slice(0, 12)}`,
      effectiveDate: payload.effectiveDate,
      sha256: sha256(serialized),
      sourceUrl,
      fetchedAt: now,
      lastCheckedAt: now,
    };
    await atomicWrite(paths.bank, serialized);
    await atomicWrite(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`);
    await atomicWrite(paths.updateState, `${JSON.stringify({ lastCheckedAt: now }, null, 2)}\n`);
    return bankInfo(payload.questions, metadata, "updated");
  } catch (error) {
    updateError = error instanceof Error ? error.message : String(error);
    await atomicWrite(paths.updateState, `${JSON.stringify({ lastCheckedAt: now, error: updateError }, null, 2)}\n`).catch(() => {});
  }

  if (cached) return { ...bankInfo(cached.bank, cached.metadata, "cache"), updateError };
  validatePayload(bundledPayload);
  return { ...bankInfo(bundledPayload.questions, { version: "bundled" }, "bundled"), updateError };
}

export function formatBankInfo(info) {
  const lines = [
    `Question bank: ${info.version}`,
    `Questions: ${info.bank.length}`,
    `Source: ${info.source}`,
  ];
  if (info.effectiveDate) lines.push(`Effective date: ${info.effectiveDate}`);
  if (info.fetchedAt) lines.push(`Fetched: ${new Date(info.fetchedAt).toISOString()}`);
  if (info.updateError) lines.push(`Update check: unavailable (${info.updateError})`);
  return lines.join("\n");
}
