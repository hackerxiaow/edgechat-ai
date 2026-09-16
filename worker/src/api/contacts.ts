import type { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { listContacts } from "../data/users.js";

export function registerContactRoutes(app: Hono<AppEnv>) {
	app.get("/api/contacts", async (c) => {
		const users = await listContacts(c.env.DB);
		return c.json({ users });
	});
}
