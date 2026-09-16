import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
	new URL("../.github/workflows/deploy-pages.yml", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

function getStep(name) {
	const marker = `      - name: ${name}\n`;
	const start = workflow.indexOf(marker);
	assert.notEqual(start, -1, `部署工作流缺少步骤：${name}`);
	const next = workflow.indexOf("      - name: ", start + marker.length);
	return workflow.slice(start, next === -1 ? undefined : next);
}

test("Cloudflare 生产凭据只注入实际调用 Cloudflare 的步骤", () => {
	const deployJobStart = workflow.indexOf("  deploy:\n");
	const stepsStart = workflow.indexOf("    steps:\n", deployJobStart);
	assert.notEqual(deployJobStart, -1);
	assert.notEqual(stepsStart, -1);
	assert.doesNotMatch(
		workflow.slice(deployJobStart, stepsStart),
		/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/,
	);

	for (const name of [
		"Checkout",
		"Setup Node.js",
		"Install dependencies",
		"Run tests",
		"Build Pages bundle",
	]) {
		assert.doesNotMatch(getStep(name), /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
	}

	for (const name of [
		"Ensure Cloudflare resources",
		"Initialize D1 schema (first creation only)",
		"Prepare D1 migrations",
		"Apply D1 migrations",
		"Verify D1 schema contract",
		"Prepare Pages encryption secret",
		"Apply Pages encryption secret",
		"Deploy Pages",
	]) {
		const step = getStep(name);
		assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
		assert.match(step, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
	}
});

test("生产部署在创建或修改云资源前运行完整测试", () => {
	const testsStart = workflow.indexOf("      - name: Run tests\n");
	const buildStart = workflow.indexOf("      - name: Build Pages bundle\n");
	const resourcesStart = workflow.indexOf("      - name: Ensure Cloudflare resources\n");
	assert.notEqual(testsStart, -1);
	assert.notEqual(buildStart, -1);
	assert.equal(testsStart < buildStart, true);
	assert.equal(testsStart < resourcesStart, true);
	assert.match(getStep("Run tests"), /run: npm test/);
	// Pages 的 _worker.js 与静态资产一起上传，必须先构建再发布。
	assert.match(getStep("Build Pages bundle"), /run: npm run build:pages/);
	assert.equal(buildStart < workflow.indexOf("      - name: Deploy Pages\n"), true);
});

test("首次部署自动创建密钥，普通部署保留密钥，手动轮换才允许更新", () => {
	const prepareStep = getStep("Prepare Pages encryption secret");
	assert.match(prepareStep, /prepare-encryption-secret\.mjs/);
	assert.match(prepareStep, /EDGECHAT_DEPLOY_TARGET: pages/);
	assert.match(
		prepareStep,
		/EDGECHAT_ENCRYPTION_KEYRING: \$\{\{ secrets\.EDGECHAT_ENCRYPTION_KEYRING \}\}/,
	);
	assert.match(prepareStep, /EDGECHAT_APPLY_ENCRYPTION_KEYRING:/);
	assert.match(prepareStep, /EDGECHAT_ROTATE_ENCRYPTION_KEY:/);
	assert.match(workflow, /apply_encryption_keyring:/);
	assert.match(workflow, /rotate_encryption_key:/);

	const applyStep = getStep("Apply Pages encryption secret");
	assert.match(applyStep, /wrangler pages secret bulk \.tmp\/pages-secrets\.json/);
	assert.match(applyStep, /if: hashFiles\('\.tmp\/pages-secrets\.json'\) != ''/);

	assert.match(getStep("Remove temporary secret files"), /rm -f \.tmp\/pages-secrets\.json/);
	assert.match(getStep("Remove temporary secret files"), /if: always\(\)/);
});

test("Pages 部署不再声明 KV、R2 或 Durable Object 绑定", () => {
	const pagesConfig = readFileSync(
		new URL("../wrangler.pages.toml", import.meta.url),
		"utf8",
	);
	assert.match(pagesConfig, /pages_build_output_dir = "frontend\/dist"/);
	assert.match(pagesConfig, /binding = "DB"/);
	assert.doesNotMatch(
		pagesConfig,
		/kv_namespaces|r2_buckets|durable_objects|\[triggers\]|main =/,
	);

	// 资源脚本只准备 D1 与 Pages 项目；KV/R2 的创建路径必须已经删除。
	const script = readFileSync(
		new URL("../.github/scripts/ensure-cloudflare-resources.mjs", import.meta.url),
		"utf8",
	).replaceAll("\r\n", "\n");
	assert.doesNotMatch(script, /kv\/namespaces|r2\/buckets|ensureKvNamespace|ensureR2Bucket/);
	assert.match(script, /ensurePagesProject/);

	assert.doesNotMatch(workflow, /wrangler\.ci\.toml|wrangler\.example\.toml|--secrets-file/);
	// D1 命令接受 --config，Pages 部署命令不接受（传了会直接报错），两者规则不同。
	assert.match(getStep("Apply D1 migrations"), /--config wrangler\.pages\.toml/);
	// 只校验命令本身：步骤里的注释需要说明为什么不传 --config。
	const deployCommand =
		getStep("Deploy Pages")
			.split("\n")
			.find((line) => line.trim().startsWith("run: ")) || "";
	assert.match(deployCommand, /wrangler pages deploy frontend\/dist --project-name/);
	assert.doesNotMatch(deployCommand, /--config/);

	const pagesScript = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	).scripts["deploy:pages"];
	assert.match(pagesScript, /wrangler pages deploy frontend\/dist --project-name/);
	assert.doesNotMatch(pagesScript, /--config/);
});
