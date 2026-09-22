import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, readEvents } from "../src/eventStore.mjs";

describe("progress event store", () => {
  it("treats a missing log as empty and appends events idempotently", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ccse-events-")), "events.json");
    const event = { eventId: "one", type: "SESSION_STARTED", timestamp: 1, payload: {} };
    expect(await readEvents(path)).toEqual([]);
    await appendEvent(path, event);
    await appendEvent(path, event);
    expect(await readEvents(path)).toEqual([event]);
    expect(JSON.parse(await readFile(path, "utf8")).schemaVersion).toBe(2);
  });

  it("fails loudly on corrupt JSON and malformed event records", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ccse-events-")), "events.json");
    await writeFile(path, "{");
    await expect(readEvents(path)).rejects.toThrow("Cannot parse progress log");
    await writeFile(path, JSON.stringify({ events: [{ eventId: "bad" }] }));
    await expect(readEvents(path)).rejects.toThrow("one or more events are invalid");
    await expect(appendEvent(path, { eventId: "new", type: "SESSION_STARTED", timestamp: 1, payload: {} })).rejects.toThrow("one or more events are invalid");
  });
});
