import { normalizeSiteIconForStorage, siteIconUrlFromStored } from "../site-icon.ts";
import { ApiError } from "../errors.ts";

export interface SiteSettings {
	siteName: string;
	siteIconUrl: string;
}

/**
 * 运行时配置：原先散落在环境变量里，现在除三个引导变量
 * （管理员账号、管理员密码、加密密钥）外全部落到 site_settings 表，
 * 由后台设置页维护。不设任何环境变量也能按这里的默认值运行。
 */
export interface RuntimeSettings extends SiteSettings {
	/** 单文件上限（字节）。 */
	maxFileSize: number;
	/** 允许的 MIME 前缀；空数组表示不限制。 */
	allowedFileTypes: string[];
	messageRetentionDays: number;
	softDeleteRetentionDays: number;
	orphanUploadRetentionDays: number;
	/** 惰性 GC 的最小间隔（分钟）。 */
	gcIntervalMinutes: number;
	/** 本站 origin 列表，用于识别升级前保存的完整 /files/ 图标 URL。 */
	siteOrigins: string[];
	allowOpenRegistration: boolean;
	smtpRelayUrl: string;
	smtpApiKey: string;
	/** 外部图床的上传接口；配置后附件走图床直链，不再进 D1。留空则回退本地加密存储。 */
	externalUploadUrl: string;
}

export interface UpdateSiteSettingsInput {
	siteName?: string;
	siteIconUrl?: string;
	siteOrigin?: string;
	maxFileSize?: unknown;
	allowedFileTypes?: unknown;
	messageRetentionDays?: unknown;
	softDeleteRetentionDays?: unknown;
	orphanUploadRetentionDays?: unknown;
	gcIntervalMinutes?: unknown;
	siteOrigins?: unknown;
	allowOpenRegistration?: unknown;
	smtpRelayUrl?: unknown;
	smtpApiKey?: unknown;
	externalUploadUrl?: unknown;
}

interface SiteSettingRow {
	setting_key: string;
	setting_value: string;
}

/** 未配置外部图床时的上限天花板：正文落 D1 单行，必须留在 2MB 之内。 */
export const MAX_UPLOAD_CEILING_BYTES = 1_900_000;
/** 配置了外部图床时的上限天花板：不再受 D1 单行约束。 */
export const MAX_EXTERNAL_UPLOAD_CEILING_BYTES = 100 * 1024 * 1024;
export const MIN_UPLOAD_BYTES = 65_536;
export const MAX_ALLOWED_FILE_TYPES = 20;
export const MAX_SITE_ORIGINS = 10;

export const RUNTIME_SETTING_DEFAULTS: RuntimeSettings = {
	siteName: "Edgechat",
	siteIconUrl: "",
	// 默认 1MiB：附件正文直接落 D1 单行，必须留在 2MB 上限之内。
	maxFileSize: 1_048_576,
	allowedFileTypes: ["image/", "video/", "audio/", "application/pdf", "text/"],
	messageRetentionDays: 7,
	softDeleteRetentionDays: 60,
	orphanUploadRetentionDays: 1,
	gcIntervalMinutes: 60,
	siteOrigins: [],
	allowOpenRegistration: false,
	smtpRelayUrl: '',
	smtpApiKey: '',
	externalUploadUrl: '',
};

/** 设置项在表里的键名，导出给后台表单复用，避免两处写死字符串。 */
export const RUNTIME_SETTING_KEYS = {
	siteName: "site_name",
	siteIconUrl: "site_icon_url",
	maxFileSize: "max_file_size",
	allowedFileTypes: "allowed_file_types",
	messageRetentionDays: "message_retention_days",
	softDeleteRetentionDays: "soft_delete_retention_days",
	orphanUploadRetentionDays: "orphan_upload_retention_days",
	gcIntervalMinutes: "gc_interval_minutes",
	siteOrigins: "site_origins",
	allowOpenRegistration: "allow_open_registration",
	smtpRelayUrl: "smtp_relay_url",
	smtpApiKey: "smtp_api_key",
	externalUploadUrl: "external_upload_url",
} as const;

function toPositiveInteger(value: unknown, fallback: number, { min = 1, max = 3650 } = {}): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	const rounded = Math.floor(parsed);
	if (rounded < min || rounded > max) return fallback;
	return rounded;
}

function parseCommaList(raw: unknown, fallback: string[]): string[] {
	if (raw === undefined || raw === null) return fallback;
	return String(raw)
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseOrigins(raw: unknown, fallback: string[]): string[] {
	if (raw === undefined || raw === null) return fallback;
	return parseCommaList(raw, fallback)
		.map((origin) => origin.replace(/\/+$/, ""))
		.filter((origin) => /^https?:\/\/[^\s,]+$/i.test(origin))
		.slice(0, MAX_SITE_ORIGINS);
}

/** 一次 SELECT 读出全部设置并合并默认值；未配置或值非法都回退默认。 */
export async function getRuntimeSettings(db: D1Database): Promise<RuntimeSettings> {
	const { results } = await db
		.prepare("SELECT setting_key, setting_value FROM site_settings")
		.all<SiteSettingRow>();
	const map: Record<string, string> = Object.fromEntries(
		results.map((row) => [row.setting_key, row.setting_value]),
	);
	const defaults = RUNTIME_SETTING_DEFAULTS;

	return {
		siteName: String(map.site_name || "").trim() || defaults.siteName,
		siteIconUrl: siteIconUrlFromStored(map.site_icon_url),
		maxFileSize: toPositiveInteger(map.max_file_size, defaults.maxFileSize, {
			min: MIN_UPLOAD_BYTES,
			// 配了外部图床就不再受 D1 单行限制，上限放宽。
			max: map.external_upload_url ? MAX_EXTERNAL_UPLOAD_CEILING_BYTES : MAX_UPLOAD_CEILING_BYTES,
		}),
		allowedFileTypes:
			map.allowed_file_types === undefined || map.allowed_file_types === ""
				? defaults.allowedFileTypes
				: parseCommaList(map.allowed_file_types, defaults.allowedFileTypes),
		messageRetentionDays: toPositiveInteger(
			map.message_retention_days,
			defaults.messageRetentionDays,
		),
		softDeleteRetentionDays: toPositiveInteger(
			map.soft_delete_retention_days,
			defaults.softDeleteRetentionDays,
		),
		orphanUploadRetentionDays: toPositiveInteger(
			map.orphan_upload_retention_days,
			defaults.orphanUploadRetentionDays,
		),
		gcIntervalMinutes: toPositiveInteger(map.gc_interval_minutes, defaults.gcIntervalMinutes, {
			min: 5,
			max: 10_080,
		}),
		siteOrigins: parseOrigins(map.site_origins, defaults.siteOrigins),
		allowOpenRegistration: map.allow_open_registration === "1",
		smtpRelayUrl: map.smtp_relay_url || defaults.smtpRelayUrl,
		smtpApiKey: map.smtp_api_key || defaults.smtpApiKey,
		externalUploadUrl: String(map.external_upload_url || '').trim(),
	};
}

export async function getSiteSettings(db: D1Database): Promise<SiteSettings> {
	const settings = await getRuntimeSettings(db);
	return { siteName: settings.siteName, siteIconUrl: settings.siteIconUrl };
}

function upsert(db: D1Database, key: string, value: string): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO site_settings (setting_key, setting_value, updated_at)
			 VALUES (?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(setting_key) DO UPDATE
			 SET setting_value = excluded.setting_value,
			     updated_at = CURRENT_TIMESTAMP`,
		)
		.bind(key, value);
}

/** 校验并写回设置项；未出现在入参里的字段保持原值。 */
export async function updateSiteSettings(
	db: D1Database,
	input: UpdateSiteSettingsInput,
): Promise<RuntimeSettings> {
	const { siteName, siteIconUrl, siteOrigin = "" } = input;
	const statements: D1PreparedStatement[] = [];
	const defaults = RUNTIME_SETTING_DEFAULTS;

	if (siteName !== undefined) {
		statements.push(
			upsert(db, RUNTIME_SETTING_KEYS.siteName, String(siteName || "").trim() || defaults.siteName),
		);
	}
	if (siteIconUrl !== undefined) {
		statements.push(
			upsert(
				db,
				RUNTIME_SETTING_KEYS.siteIconUrl,
				normalizeSiteIconForStorage(siteIconUrl, [siteOrigin]),
			),
		);
	}
	if (input.maxFileSize !== undefined) {
		statements.push(
			upsert(
				db,
				RUNTIME_SETTING_KEYS.maxFileSize,
				String(
					toPositiveInteger(input.maxFileSize, defaults.maxFileSize, {
						min: MIN_UPLOAD_BYTES,
						max: MAX_UPLOAD_CEILING_BYTES,
					}),
				),
			),
		);
	}
	if (input.allowedFileTypes !== undefined) {
		const types = parseCommaList(input.allowedFileTypes, [])
			.slice(0, MAX_ALLOWED_FILE_TYPES)
			.join(",");
		statements.push(upsert(db, RUNTIME_SETTING_KEYS.allowedFileTypes, types));
	}
	if (input.messageRetentionDays !== undefined) {
		statements.push(
			upsert(
				db,
				RUNTIME_SETTING_KEYS.messageRetentionDays,
				String(toPositiveInteger(input.messageRetentionDays, defaults.messageRetentionDays)),
			),
		);
	}
	if (input.softDeleteRetentionDays !== undefined) {
		statements.push(
			upsert(
				db,
				RUNTIME_SETTING_KEYS.softDeleteRetentionDays,
				String(
					toPositiveInteger(input.softDeleteRetentionDays, defaults.softDeleteRetentionDays),
				),
			),
		);
	}
	if (input.orphanUploadRetentionDays !== undefined) {
		statements.push(
			upsert(
				db,
				RUNTIME_SETTING_KEYS.orphanUploadRetentionDays,
				String(
					toPositiveInteger(
						input.orphanUploadRetentionDays,
						defaults.orphanUploadRetentionDays,
					),
				),
			),
		);
	}
	if (input.gcIntervalMinutes !== undefined) {
		statements.push(
			upsert(
				db,
				RUNTIME_SETTING_KEYS.gcIntervalMinutes,
				String(
					toPositiveInteger(input.gcIntervalMinutes, defaults.gcIntervalMinutes, {
						min: 5,
						max: 10_080,
					}),
				),
			),
		);
	}
	if (input.siteOrigins !== undefined) {
		statements.push(
			upsert(db, RUNTIME_SETTING_KEYS.siteOrigins, parseOrigins(input.siteOrigins, []).join(",")),
		);
	}
	if (input.allowOpenRegistration !== undefined) {
		statements.push(
			upsert(db, RUNTIME_SETTING_KEYS.allowOpenRegistration, input.allowOpenRegistration ? "1" : "0"),
		);
	}
	if (input.smtpRelayUrl !== undefined) {
		statements.push(
			upsert(db, RUNTIME_SETTING_KEYS.smtpRelayUrl, String(input.smtpRelayUrl || "").trim()),
		);
	}
	if (input.smtpApiKey !== undefined) {
		statements.push(
			upsert(db, RUNTIME_SETTING_KEYS.smtpApiKey, String(input.smtpApiKey || "").trim()),
		);
	}
	if (input.externalUploadUrl !== undefined) {
		const raw = String(input.externalUploadUrl || "").trim();
		if (raw && !/^https:\/\//i.test(raw)) {
			throw new ApiError("外部图床地址必须是 https 链接");
		}
		statements.push(upsert(db, RUNTIME_SETTING_KEYS.externalUploadUrl, raw));
	}

	if (statements.length) {
		await db.batch(statements);
	}
	return getRuntimeSettings(db);
}
