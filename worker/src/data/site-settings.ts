import { normalizeSiteIconForStorage, siteIconUrlFromStored } from "../site-icon.js";

export interface SiteSettings {
	siteName: string;
	siteIconUrl: string;
}

export interface UpdateSiteSettingsInput {
	siteName?: string;
	siteIconUrl?: string;
	siteOrigin?: string;
}

interface SiteSettingRow {
	setting_key: string;
	setting_value: string;
}

export async function getSiteSettings(db: D1Database): Promise<SiteSettings> {
	const { results } = await db
		.prepare("SELECT setting_key, setting_value FROM site_settings")
		.all<SiteSettingRow>();
	const map: Record<string, string> = Object.fromEntries(
		results.map((row) => [row.setting_key, row.setting_value]),
	);
	return {
		siteName: String(map.site_name || "Edgechat"),
		siteIconUrl: siteIconUrlFromStored(map.site_icon_url),
	};
}

export async function updateSiteSettings(
	db: D1Database,
	{ siteName, siteIconUrl, siteOrigin = "" }: UpdateSiteSettingsInput,
): Promise<SiteSettings> {
	const statements: D1PreparedStatement[] = [];
	if (siteName !== undefined) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('site_name', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(String(siteName || "Edgechat").trim() || "Edgechat"),
		);
	}
	if (siteIconUrl !== undefined) {
		const storedIcon = normalizeSiteIconForStorage(siteIconUrl, [siteOrigin]);
		statements.push(
			db
				.prepare(
					`INSERT INTO site_settings (setting_key, setting_value, updated_at)
					 VALUES ('site_icon_url', ?, CURRENT_TIMESTAMP)
					 ON CONFLICT(setting_key) DO UPDATE
					 SET setting_value = excluded.setting_value,
					     updated_at = CURRENT_TIMESTAMP`,
				)
				.bind(storedIcon),
		);
	}
	if (statements.length) {
		await db.batch(statements);
	}
	return getSiteSettings(db);
}
