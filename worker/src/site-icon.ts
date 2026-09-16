const R2_SITE_ICON_PREFIX = "r2:";

export type StoredSiteIconKind = "none" | "local" | "external" | "ambiguous";

export interface StoredSiteIcon {
	kind: StoredSiteIconKind;
	key: string | null;
}

function decodeFilePath(pathname: unknown): string | null {
	if (!String(pathname || "").startsWith("/files/")) return null;
	const encodedKey = String(pathname).slice("/files/".length);
	if (!encodedKey) return null;
	try {
		return decodeURIComponent(encodedKey);
	} catch {
		return null;
	}
}

function absoluteHttpUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

function normalizedOrigins(origins: unknown[]): Set<string> {
	return new Set(
		origins
			.map((origin) => absoluteHttpUrl(String(origin || "").trim())?.origin)
			.filter((origin): origin is string => Boolean(origin)),
	);
}

export function siteIconUrlFromStored(value: unknown): string {
	const stored = String(value || "").trim();
	if (!stored.startsWith(R2_SITE_ICON_PREFIX)) return stored;
	const key = stored.slice(R2_SITE_ICON_PREFIX.length);
	return key ? `/files/${encodeURIComponent(key)}` : "";
}

export function normalizeSiteIconForStorage(value: unknown, trustedOrigins: unknown[] = []): string {
	const raw = String(value || "").trim();
	if (!raw) return "";
	if (raw.startsWith(R2_SITE_ICON_PREFIX)) return raw;

	if (raw.startsWith("/files/")) {
		const key = decodeFilePath(new URL(raw, "https://edgechat.invalid").pathname);
		return key ? `${R2_SITE_ICON_PREFIX}${key}` : raw;
	}

	const absolute = absoluteHttpUrl(raw);
	if (absolute) {
		const key = decodeFilePath(absolute.pathname);
		if (key && normalizedOrigins(trustedOrigins).has(absolute.origin)) {
			return `${R2_SITE_ICON_PREFIX}${key}`;
		}
		return raw;
	}

	// 历史版本允许直接保存 object key；非 / 开头的相对值继续按该兼容语义处理。
	return raw.startsWith("/") ? raw : `${R2_SITE_ICON_PREFIX}${raw}`;
}

export function classifyStoredSiteIcon(value: unknown, trustedOrigins: unknown[] = []): StoredSiteIcon {
	const stored = String(value || "").trim();
	if (!stored) return { kind: "none", key: null };
	if (stored.startsWith(R2_SITE_ICON_PREFIX)) {
		return { kind: "local", key: stored.slice(R2_SITE_ICON_PREFIX.length) || null };
	}
	if (stored.startsWith("/files/")) {
		return {
			kind: "local",
			key: decodeFilePath(new URL(stored, "https://edgechat.invalid").pathname),
		};
	}

	const absolute = absoluteHttpUrl(stored);
	if (absolute) {
		const key = decodeFilePath(absolute.pathname);
		if (!key) return { kind: "external", key: null };
		const origins = normalizedOrigins(trustedOrigins);
		if (origins.size > 0 && !origins.has(absolute.origin)) {
			return { kind: "external", key: null };
		}
		return {
			kind: origins.has(absolute.origin) ? "local" : "ambiguous",
			key,
		};
	}

	return stored.startsWith("/")
		? { kind: "external", key: null }
		: { kind: "local", key: stored };
}
