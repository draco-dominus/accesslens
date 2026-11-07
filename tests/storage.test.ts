import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as E from "../src/lib/session/engine";
import { loadSession, saveSession } from "../src/lib/session/storage";

const originalLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

function memoryStorage(fail = false): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear() { data.clear(); },
    getItem(key) { if (fail) throw new DOMException("blocked", "SecurityError"); return data.get(key) ?? null; },
    key(index) { return [...data.keys()][index] ?? null; },
    removeItem(key) { if (fail) throw new DOMException("blocked", "SecurityError"); data.delete(key); },
    setItem(key, value) { if (fail) throw new DOMException("blocked", "QuotaExceededError"); data.set(key, value); },
  };
}

function setStorage(local: Storage, session: Storage) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
}

afterEach(() => {
  if (originalLocal) Object.defineProperty(globalThis, "localStorage", originalLocal);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
  if (originalSession) Object.defineProperty(globalThis, "sessionStorage", originalSession);
  else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});

describe("inspection data persistence", () => {
  it("persists the latest structured inspection beyond the current tab", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    setStorage(local, session);
    const inspection = E.createSession("inspection", 123);

    saveSession(inspection);

    assert.equal(loadSession()?.id, "inspection");
    assert.equal(session.length, 0, "legacy tab-only storage is cleared after migration");
  });

  it("falls back to tab storage when durable storage is blocked or full", () => {
    const session = memoryStorage();
    setStorage(memoryStorage(true), session);
    const inspection = E.createSession("fallback", 456);

    saveSession(inspection);

    assert.equal(loadSession()?.id, "fallback");
  });

  it("clears persisted inspection data through the same deletion path", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    setStorage(local, session);
    saveSession(E.createSession("delete-me", 789));

    saveSession(null);

    assert.equal(loadSession(), null);
  });
});
