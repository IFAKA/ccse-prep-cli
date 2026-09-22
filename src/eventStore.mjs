import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function validateEvents(events, path) {
  if (!Array.isArray(events)) throw new Error(`Progress log is malformed at ${path}: expected an events array`);
  if (events.some((event) => !event || typeof event.eventId !== "string" || typeof event.type !== "string" || !Number.isFinite(event.timestamp) || !event.payload || typeof event.payload !== "object")) {
    throw new Error(`Progress log is malformed at ${path}: one or more events are invalid`);
  }
  return events;
}

export async function readEvents(path) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) { throw new Error(`Cannot parse progress log ${path}: ${error instanceof Error ? error.message : error}`); }
  return validateEvents(parsed?.events, path);
}

export async function appendEvent(path, event) {
  const events = await readEvents(path);
  if (!events.some((current) => current.eventId === event.eventId)) events.push(event);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ schemaVersion: 2, events }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}
