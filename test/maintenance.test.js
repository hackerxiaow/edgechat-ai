import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { registerMaintenanceRoutes } from "../worker/src/api/maintenance.ts";
import { inspectEnvironment, runSystemCheck } from "../worker/src/maintenance/system-check.ts";
import { authMiddleware, adminMiddleware } from "../worker/src/middleware.ts";

const okDb = { prepare: () => ({ all: async () => ({ results: [{ ok: 1 }] }) }) };

test("environment exposes presence only, never secret values", () => {
  const result = inspectEnvironment({ EDGECHAT_ENCRYPTION_KEYRING: "super-secret", ADMIN_USERNAMES: "admin" });
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(result.find((x) => x.required).present, true);
});

test("system check isolates errors, timeouts, and optional R2", async () => {
  const result = await runSystemCheck({ DB: okDb, SESSIONS: { get: async () => { throw new Error("token leak"); } }, FILES: { list: async () => [] } }, { timeoutMs: 10 });
  assert.equal(result.checks.find((x) => x.id === "sessions").code, "request_failed");
  assert.equal(result.checks.find((x) => x.id === "d1").status, "ok");
  assert.equal(JSON.stringify(result).includes("token leak"), false);
  const missing = await runSystemCheck({ DB: okDb }, { timeoutMs: 1 });
  assert.equal(missing.checks.find((x) => x.id === "files").status, "disabled");
});

test("system check reports no Durable Object probes on the D1-only deployment", async () => {
  const result = await runSystemCheck({ DB: okDb }, { timeoutMs: 5 });
  const ids = result.checks.map((check) => check.id);
  for (const retired of ["channelRoom", "userInbox", "scheduler"]) {
    assert.equal(ids.includes(retired), false);
  }
  assert.deepEqual(ids, ["d1", "schema", "sessions", "files", "environment"]);
});

test("system probes use fixed KV key and R2 limit one, and do not read payloads", async () => {
  let key; let options; let read = false;
  const result = await runSystemCheck({
    DB: okDb,
    SESSIONS: { get: async (value) => { key = value; return { secret: "must-not-be-read" }; } },
    FILES: { list: async (value) => { options = value; return { objects: [], truncated: false }; } }
  }, { timeoutMs: 10 });
  read = JSON.stringify(result).includes("must-not-be-read");
  assert.equal(key, "__edgechat_health__");
  assert.deepEqual(options, { limit: 1 });
  assert.equal(read, false);
});

test("real auth and admin middleware return 401, 403, and allow admins", async () => {
  const app = new Hono();
  app.use("/api/admin/*", authMiddleware, adminMiddleware);
  registerMaintenanceRoutes(app);
  // 会话已从 KV 迁到 D1 的 sessions 表，夹具按 D1 建模。
  const dbFor = (isAdmin, session) => ({
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              return { results: [{ username: "u", is_disabled: 0, deleted_at: null, session_version: 0, is_admin: isAdmin }] };
            },
            async first() {
              return sql.includes("FROM sessions") && session
                ? { data: JSON.stringify(session), expires_at: Math.floor(Date.now() / 1000) + 3600 }
                : null;
            },
            async run() {
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  });
  const session = { userId: 1, isAdmin: false, sessionVersion: 0 };
  assert.equal((await app.request("/api/admin/maintenance", {}, { DB: dbFor(0, null) })).status, 401);
  const authorizedEnv = { DB: dbFor(0, session) };
  assert.equal((await app.request("/api/admin/maintenance", { headers: { Authorization: "Bearer token" } }, authorizedEnv)).status, 403);
  const adminEnv = { DB: dbFor(1, { ...session, isAdmin: true }) };
  const response = await app.request("/api/admin/maintenance", { headers: { Authorization: "Bearer token" } }, adminEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).checks.length, 5);
});
