import { hashPassword } from "../auth.ts";
import { ensureGeneralChannelMembership } from "./general-channel.ts";
import type { AppBindings } from "../types.ts";

/** 引导用的两个环境变量；缺任一项就不做引导。 */
export const BOOTSTRAP_ADMIN_USERNAME_ENV = "EDGECHAT_ADMIN_USERNAME";
export const BOOTSTRAP_ADMIN_PASSWORD_ENV = "EDGECHAT_ADMIN_PASSWORD";

/** 与注册一致的下限，避免用短密码引导出一个弱口令管理员。 */
const MIN_PASSWORD_LENGTH = 6;
const MAX_USERNAME_LENGTH = 64;

export type BootstrapAdminResult = "created" | "exists" | "taken" | "skipped";

type BootstrapEnv = Pick<AppBindings, "DB"> & Record<string, unknown>;

export function readBootstrapAdmin(env: BootstrapEnv): { username: string; password: string } {
	const username = String(env[BOOTSTRAP_ADMIN_USERNAME_ENV] || "").trim();
	const password = String(env[BOOTSTRAP_ADMIN_PASSWORD_ENV] || "");
	return { username, password };
}

/**
 * 引导管理员：账号不存在时按环境变量创建，已存在则原样跳过（不覆盖密码、
 * 也不把同名的普通账号提权，避免被占名后被动提权）。
 * 并发下可能撞上 UNIQUE 约束，按「已存在」处理即可。
 */
export async function ensureBootstrapAdmin(env: BootstrapEnv): Promise<BootstrapAdminResult> {
	const { username, password } = readBootstrapAdmin(env);
	if (!username || username.length > MAX_USERNAME_LENGTH) return "skipped";
	if (password.length < MIN_PASSWORD_LENGTH) return "skipped";

	const existing = await env.DB.prepare(
		"SELECT id, is_admin FROM users WHERE username = ? COLLATE NOCASE LIMIT 1",
	)
		.bind(username)
		.first<{ id: number; is_admin: number }>();
	if (existing) {
		return Number(existing.is_admin) ? "exists" : "taken";
	}

	const hashed = await hashPassword(password);
	try {
		await env.DB.prepare(
			`INSERT INTO users (username, display_name, password_hash, password_salt, is_admin)
			 VALUES (?, ?, ?, ?, 1)`,
		)
			.bind(username, username, hashed.hash, hashed.salt)
			.run();
	} catch (error) {
		if (String((error as { message?: unknown })?.message || error).includes("UNIQUE")) {
			return "exists";
		}
		throw error;
	}

	const created = await env.DB.prepare(
		"SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1",
	)
		.bind(username)
		.first<{ id: number }>();
	if (created?.id) {
		await ensureGeneralChannelMembership(env.DB, created.id);
	}
	return "created";
}
