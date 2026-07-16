"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { GateClient, sanitizeState, isUnlocked } = require("./gate-client.js");

function memoryStorage(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test("闸门值始终限制在课程总关数内", () => {
  assert.equal(sanitizeState({ openUpTo: 0 }, 34, 1).openUpTo, 1);
  assert.equal(sanitizeState({ openUpTo: 99 }, 34, 1).openUpTo, 34);
  assert.equal(sanitizeState({ open_up_to: 7 }, 34, 1).openUpTo, 7);
});

test("默认只开放第一关", () => {
  const client = new GateClient({ total: 34, fallbackOpenUpTo: 1, storage: memoryStorage() });
  assert.equal(client.state.openUpTo, 1);
  assert.equal(isUnlocked(0, client.state), true);
  assert.equal(isUnlocked(1, client.state), false);
});

test("接口失败时保留最后一次成功状态，不会自动放开后续", async () => {
  const storage = memoryStorage({
    dew_gate_state_v1: JSON.stringify({ openUpTo: 4, version: 2, updatedAt: "2026-07-16T00:00:00Z" })
  });
  const client = new GateClient({
    apiUrl: "https://example.invalid/api/gates",
    total: 34,
    fallbackOpenUpTo: 1,
    storage,
    fetchImpl: async () => { throw new Error("offline"); }
  });
  const state = await client.refresh();
  assert.equal(state.openUpTo, 4);
  assert.equal(state.online, false);
  assert.equal(isUnlocked(4, state), false);
});

test("远端放行后更新缓存", async () => {
  const storage = memoryStorage();
  const client = new GateClient({
    apiUrl: "https://example.test/api/gates",
    total: 34,
    fallbackOpenUpTo: 1,
    storage,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ openUpTo: 6, version: 3, updatedAt: "2026-07-16T01:00:00Z" })
    })
  });
  const state = await client.refresh();
  assert.equal(state.openUpTo, 6);
  assert.equal(state.online, true);
  assert.equal(JSON.parse(storage.getItem("dew_gate_state_v1")).openUpTo, 6);
});

test("storage failures keep the course safely locked", async () => {
  const blockedStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
  const client = new GateClient({
    apiUrl: "https://example.invalid/api/gates",
    total: 38,
    fallbackOpenUpTo: 1,
    storage: blockedStorage,
    fetchImpl: async () => { throw new Error("offline"); }
  });
  const state = await client.refresh();
  assert.equal(state.openUpTo, 1);
  assert.equal(isUnlocked(1, state), false);
});
