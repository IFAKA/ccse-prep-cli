import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bankUpdateInterval, formatBankInfo, loadQuestionBank, BANK_DAILY_UPDATE_INTERVAL_MS, BANK_NORMAL_UPDATE_INTERVAL_MS } from "../src/questionBank.mjs";

const validPayload = {
  source: "test",
  count: 300,
  questions: (() => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    return Array.from({ length: 300 }, (_, index) => {
      const task = index < 120 ? 1 : index < 156 ? 2 : index < 180 ? 3 : index < 216 ? 4 : 5;
      counts[task] += 1;
      return {
        id: task * 1000 + counts[task], task,
        question: `Question ${index + 1}`,
        options: task === 2 ? { a: "Verdadero.", b: "Falso." } : { a: "A", b: "B", c: "C" },
        answer: "a", explanation: "Explanation", page: 1,
      };
    });
  })(),
};

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

describe("question bank updates", () => {
  it("checks daily around the annual publication window and monthly otherwise", () => {
    expect(bankUpdateInterval(new Date("2026-12-20T12:00:00Z"))).toBe(BANK_DAILY_UPDATE_INTERVAL_MS);
    expect(bankUpdateInterval(new Date("2027-01-20T12:00:00Z"))).toBe(BANK_DAILY_UPDATE_INTERVAL_MS);
    expect(bankUpdateInterval(new Date("2026-09-19T12:00:00Z"))).toBe(BANK_NORMAL_UPDATE_INTERVAL_MS);
  });

  it("downloads and caches a valid bank", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ccse-bank-"));
    const result = await loadQuestionBank({ bundledPayload: validPayload, dataDir, now: 1000, fetchImpl: async () => response(validPayload), sourceUrl: "https://example.test/bank.json" });
    expect(result.source).toBe("updated");
    expect(result.bank).toHaveLength(300);
    expect(JSON.parse(await readFile(join(dataDir, "question-bank.json"), "utf8")).questions).toHaveLength(300);
  });

  it("keeps the bundled bank when the remote bank is invalid", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ccse-bank-"));
    const result = await loadQuestionBank({ bundledPayload: validPayload, dataDir, now: 1000, fetchImpl: async () => response({ questions: [] }), sourceUrl: "https://example.test/bank.json" });
    expect(result.source).toBe("bundled");
    expect(result.updateError).toContain("failed validation");
  });

  it("rejects a partially malformed cached bank and uses the bundled bank", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ccse-bank-"));
    const malformed = structuredClone(validPayload);
    malformed.questions[0].options.a = "";
    await writeFile(join(dataDir, "question-bank.json"), JSON.stringify(malformed));
    await writeFile(join(dataDir, "question-bank-update.json"), JSON.stringify({ lastCheckedAt: 1000 }));
    const result = await loadQuestionBank({ bundledPayload: validPayload, dataDir, now: 1001 });
    expect(result.source).toBe("bundled");
    expect(result.bank).toHaveLength(300);
  });

  it("fails loudly if the bundled bank itself is malformed and refresh fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ccse-bank-"));
    const malformed = structuredClone(validPayload);
    malformed.questions[0].options.a = "";
    await expect(loadQuestionBank({ bundledPayload: malformed, dataDir, now: 1000, fetchImpl: async () => { throw new Error("offline"); } }))
      .rejects.toThrow("Question bank failed validation");
  });

  it("rejects count metadata that disagrees with the validated records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ccse-bank-"));
    await expect(loadQuestionBank({ bundledPayload: { ...validPayload, count: 299 }, dataDir, now: 1000, fetchImpl: async () => { throw new Error("offline"); } }))
      .rejects.toThrow("count metadata mismatch");
  });

  it("uses the cached bank during the update interval", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ccse-bank-"));
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return response(validPayload); };
    await loadQuestionBank({ bundledPayload: validPayload, dataDir, now: 1000, fetchImpl });
    const result = await loadQuestionBank({ bundledPayload: { ...validPayload, questions: validPayload.questions.slice(0, 1) }, dataDir, now: 1001, fetchImpl: async () => { calls += 1; return response({ questions: [] }); } });
    expect(calls).toBe(1);
    expect(result.source).toBe("cache");
    expect(result.bank).toHaveLength(300);
  });

  it("formats active bank diagnostics", () => {
    expect(formatBankInfo({ bank: validPayload.questions, source: "cache", version: "2026.09.01", effectiveDate: "2026-09-01" })).toContain("Question bank: 2026.09.01");
  });
});
