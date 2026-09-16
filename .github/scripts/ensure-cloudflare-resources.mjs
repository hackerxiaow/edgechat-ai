#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = "https://api.cloudflare.com/client/v4";

const LEGACY_D1_DATABASE_NAME = "cfchat-db";
const DEFAULT_PAGES_PROJECT_NAME = "edgechat";
const DEFAULT_PRODUCTION_BRANCH = "master";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readEnv(env, ...names) {
  for (const name of names) {
    const value = env[name];
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function resourceNames(env) {
  return {
    d1DatabaseName:
      readEnv(env, "EDGECHAT_D1_DATABASE_NAME", "CFCHAT_D1_DATABASE_NAME") ??
      LEGACY_D1_DATABASE_NAME,
    pagesProjectName:
      readEnv(env, "EDGECHAT_PAGES_PROJECT_NAME") ?? DEFAULT_PAGES_PROJECT_NAME,
    productionBranch:
      readEnv(env, "EDGECHAT_PAGES_PRODUCTION_BRANCH") ?? DEFAULT_PRODUCTION_BRANCH,
  };
}

function setOutput(name, value) {
  const stringValue = String(value);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${stringValue}\n`);
  }
  console.log(`[output] ${name}=${stringValue}`);
}

function extractApiError(payload, fallback) {
  if (!payload || !Array.isArray(payload.errors) || payload.errors.length === 0) {
    return fallback;
  }
  return payload.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
}

class CloudflareApiError extends Error {
  constructor({ method, path, status, payload, fallback }) {
    super(
      `Cloudflare API request failed (${method} ${path}): ${extractApiError(payload, fallback)}`,
    );
    this.name = "CloudflareApiError";
    this.status = status;
    this.errors = Array.isArray(payload?.errors) ? payload.errors : [];
  }
}

async function cloudflareRequest(
  { apiToken, fetchImpl },
  method,
  path,
  { query, body, allowNotFound = false } = {},
) {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      if (allowNotFound && response.status === 404) {
        return null;
      }
      throw new CloudflareApiError({
        method,
        path,
        status: response.status,
        payload: null,
        fallback: text || `HTTP ${response.status}`,
      });
    }
    throw new Error(`Unable to parse Cloudflare API response: ${text}`);
  }

  if (!response.ok || payload?.success === false) {
    if (allowNotFound && response.status === 404) {
      return null;
    }
    throw new CloudflareApiError({
      method,
      path,
      status: response.status,
      payload,
      fallback: "Unknown Cloudflare API error",
    });
  }

  return payload;
}

function normalizeD1Record(item) {
  return {
    id: item.uuid ?? item.id ?? item.database_id ?? "",
    name: item.name ?? "",
  };
}

async function listD1Databases(context) {
  const all = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const payload = await cloudflareRequest(
      context,
      "GET",
      `/accounts/${context.accountId}/d1/database`,
      { query: { page, per_page: perPage } },
    );
    const records = Array.isArray(payload.result) ? payload.result.map(normalizeD1Record) : [];
    all.push(...records);

    const resultInfo = payload.result_info;
    const reachedLastPage =
      !resultInfo?.total_pages || Number(page) >= Number(resultInfo.total_pages);
    if (reachedLastPage) {
      break;
    }
    page += 1;
  }

  return all;
}

export async function ensureD1Database(context, d1DatabaseName) {
  const databases = await listD1Databases(context);
  const existing = databases.find((database) => database.name === d1DatabaseName && database.id);
  if (existing) {
    console.log(`D1 database already exists: ${d1DatabaseName} (${existing.id})`);
    return { id: existing.id, created: false };
  }

  console.log(`Creating D1 database: ${d1DatabaseName}`);
  const payload = await cloudflareRequest(
    context,
    "POST",
    `/accounts/${context.accountId}/d1/database`,
    { body: { name: d1DatabaseName } },
  );
  const id = payload.result?.uuid ?? payload.result?.id ?? payload.result?.database_id;
  if (!id) {
    throw new Error("D1 create response is missing database id");
  }

  return { id, created: true };
}

/**
 * Pages 项目必须先存在才能 pages deploy；已存在时只复用，绝不覆盖已有配置。
 */
export async function ensurePagesProject(
  context,
  projectName = DEFAULT_PAGES_PROJECT_NAME,
  productionBranch = DEFAULT_PRODUCTION_BRANCH,
) {
  const existing = await cloudflareRequest(
    context,
    "GET",
    `/accounts/${context.accountId}/pages/projects/${encodeURIComponent(projectName)}`,
    { allowNotFound: true },
  );
  if (existing?.result?.name) {
    console.log(`Pages project already exists: ${existing.result.name}`);
    return { name: existing.result.name, created: false };
  }

  console.log(`Creating Pages project: ${projectName}`);
  const payload = await cloudflareRequest(
    context,
    "POST",
    `/accounts/${context.accountId}/pages/projects`,
    { body: { name: projectName, production_branch: productionBranch } },
  );
  const name = payload.result?.name;
  if (!name) {
    throw new Error("Pages project create response is missing project name");
  }

  return { name, created: true };
}

export async function ensureCloudflareResources({
  accountId,
  apiToken,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const names = resourceNames(env);
  const context = { accountId, apiToken, fetchImpl };

  console.log("Ensuring Cloudflare resources for the Pages + D1 deployment...");
  console.log(`Target account: ${accountId}`);
  console.log(
    "Using legacy Cloudflare resource names by default to avoid creating a second production stack.",
  );

  const d1 = await ensureD1Database(context, names.d1DatabaseName);
  const pages = await ensurePagesProject(
    context,
    names.pagesProjectName,
    names.productionBranch,
  );

  setOutput("d1_database_name", names.d1DatabaseName);
  setOutput("d1_database_id", d1.id);
  setOutput("d1_created", d1.created);
  setOutput("pages_project_name", pages.name);
  setOutput("pages_project_created", pages.created);

  return { d1, pages };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  ensureCloudflareResources({
    accountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
    apiToken: requireEnv("CLOUDFLARE_API_TOKEN"),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
