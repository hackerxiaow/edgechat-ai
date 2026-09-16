import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureCloudflareResources,
  ensureD1Database,
  ensurePagesProject,
  resourceNames,
} from "../.github/scripts/ensure-cloudflare-resources.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("D1 reuses the existing database instead of creating a second production stack", async () => {
  const requests = [];
  const result = await ensureD1Database(
    {
      accountId: "account",
      apiToken: "token",
      async fetchImpl(url, init) {
        requests.push({ url: String(url), method: init.method });
        return jsonResponse({
          success: true,
          result: [
            { uuid: "generic-id", name: "other-db" },
            { uuid: "target-id", name: "cfchat-db" },
          ],
          result_info: { total_pages: 1 },
        });
      },
    },
    "cfchat-db",
  );

  assert.deepEqual(result, { id: "target-id", created: false });
  assert.deepEqual(requests.map((request) => request.method), ["GET"]);
});

test("D1 is created when the account has no matching database yet", async () => {
  const requests = [];
  const responses = [
    jsonResponse({ success: true, result: [], result_info: { total_pages: 1 } }),
    jsonResponse({ success: true, result: { uuid: "created-id", name: "cfchat-db" } }),
  ];
  const result = await ensureD1Database(
    {
      accountId: "account",
      apiToken: "token",
      async fetchImpl(url, init) {
        requests.push({ url: String(url), method: init.method, body: init.body });
        return responses.shift();
      },
    },
    "cfchat-db",
  );

  assert.deepEqual(result, { id: "created-id", created: true });
  assert.deepEqual(requests.map((request) => request.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(requests[1].body), { name: "cfchat-db" });
});

test("Pages project is created on first deploy and reused afterwards", async () => {
  const created = [];
  const first = await ensurePagesProject(
    {
      accountId: "account",
      apiToken: "token",
      async fetchImpl(url, init) {
        created.push({ url: String(url), method: init.method, body: init.body });
        if (init.method === "GET") {
          return jsonResponse({ success: false, errors: [{ code: 8000007, message: "Not found" }] }, 404);
        }
        return jsonResponse({ success: true, result: { name: "edgechat" } });
      },
    },
    "edgechat",
    "master",
  );
  assert.deepEqual(first, { name: "edgechat", created: true });
  assert.deepEqual(created.map((request) => request.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(created[1].body), {
    name: "edgechat",
    production_branch: "master",
  });

  const reused = await ensurePagesProject({
    accountId: "account",
    apiToken: "token",
    async fetchImpl() {
      return jsonResponse({ success: true, result: { name: "edgechat" } });
    },
  });
  assert.deepEqual(reused, { name: "edgechat", created: false });
});

test("permission and credential errors still stop the deployment", async () => {
  await assert.rejects(
    ensureD1Database(
      {
        accountId: "account",
        apiToken: "token",
        async fetchImpl() {
          return jsonResponse(
            {
              success: false,
              errors: [{ code: 10000, message: "Authentication error" }],
            },
            403,
          );
        },
      },
      "cfchat-db",
    ),
    /10000: Authentication error/,
  );

  await assert.rejects(
    ensurePagesProject({
      accountId: "account",
      apiToken: "token",
      async fetchImpl() {
        return jsonResponse(
          {
            success: false,
            errors: [{ code: 10000, message: "Authentication error" }],
          },
          403,
        );
      },
    }),
    /10000: Authentication error/,
  );
});

test("resource names keep the legacy D1 database and the Pages project defaults", async () => {
  assert.deepEqual(resourceNames({}), {
    d1DatabaseName: "cfchat-db",
    pagesProjectName: "edgechat",
    productionBranch: "master",
  });
  assert.deepEqual(resourceNames({ EDGECHAT_D1_DATABASE_NAME: "custom-db" }), {
    d1DatabaseName: "custom-db",
    pagesProjectName: "edgechat",
    productionBranch: "master",
  });
});

test("the deployment script provisions D1 and Pages, never KV or R2", async () => {
  const requests = [];
  const responses = [
    jsonResponse({ success: true, result: [{ uuid: "d1-id", name: "cfchat-db" }], result_info: { total_pages: 1 } }),
    jsonResponse({ success: true, result: { name: "edgechat" } }),
  ];
  const result = await ensureCloudflareResources({
    accountId: "account",
    apiToken: "token",
    env: {},
    async fetchImpl(url, init) {
      requests.push({ url: String(url), method: init.method });
      return responses.shift();
    },
  });

  assert.deepEqual(result, {
    d1: { id: "d1-id", created: false },
    pages: { name: "edgechat", created: false },
  });
  assert.equal(
    requests.some((request) => /kv|r2/.test(request.url)),
    false,
    requests.map((request) => request.url).join("\n"),
  );
});
