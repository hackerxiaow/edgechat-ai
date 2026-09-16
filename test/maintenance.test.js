import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { registerMaintenanceRoutes } from "../worker/src/api/maintenance.ts";
import { inspectEnvironment, runSystemCheck } from "../worker/src/maintenance/system-check.ts";
import { authMiddleware, adminMiddleware } from "../worker/src/middleware.ts";

const okDb = { prepare: () => ({ all: async () => ({ results: [{ ok: 1 }] }) }) };

test("environment exposes presence only, never secret values", () => {
  const result = inspectEnvironment({ EDGECHAT_ENCRYPTION_KEYRING: "super-secret", EDGECHAT_ADMIN_USERNAME: "admin" });
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(result.find((x) => x.required).present, true);
});

test("system check isolates database failures and timeouts", async () => {
  const failing = await runSystemCheck({ DB: { prepare: () => { throw new Error("token leak"); } } }, { timeoutMs: 10 });
  assert.equal(failing.checks.find((x) => x.id === "d1").code, "request_failed");
  assert.equal(failing.checks.find((x) => x.id === "schema").status, "blocked");
  assert.equal(JSON.stringify(failing).includes("token leak"), false);
});

test("system check reports only D1, schema and environment on the D1-only deployment", async () => {
  const result = await runSystemCheck({ DB: okDb }, { timeoutMs: 5 });
  const ids = result.checks.map((check) => check.id);
  assert.deepEqual(ids, ["d1", "schema", "environment"]);
  // 不再有 KV / R2 / Durable Object 的探活项。
  for (const retired of ["sessions", "files", "channelRoom", "userInbox", "scheduler"]) {
    assert.equal(ids.includes(retired), false);
  }
});

test("real auth and admin middleware return 401, 403, and allow admins", async () => {
  const app = new Hono();
  app.use("/api/admin/*", authMiddleware, adminMiddleware);
  registerMaintenanceRoutes(app);
  // 会话存在 D1 的 sessions 表，夹具按 D1 建模。
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
  assert.equal((await response.json()).checks.length, 3);
});
