-- Cloudflare Pages Functions 不支持 Cron Triggers，定时 GC 改由请求路径惰性触发；
-- 用单行状态表记录上一轮开始时间，认领语句据此判断是否已经到下一个间隔。
CREATE TABLE IF NOT EXISTS gc_state (
  id TEXT PRIMARY KEY,
  last_started_at TEXT,
  last_finished_at TEXT,
  last_error TEXT NOT NULL DEFAULT ''
);
