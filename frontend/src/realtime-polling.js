/**
 * 房间轮询节流策略（纯函数，便于单测）。
 *
 * 背景：纯 D1 部署下 /api/v1/realtime/ws 固定返回 501，实时性只能靠轮询 /sync。
 * 原实现是「永远每 800ms 一次」，一个后台标签页就是 108000 次请求/天，
 * 单页即可把 Workers 免费额度（10 万请求/天）打满，同时把 D1 行读放大 7 倍。
 *
 * 这里的节奏约定：
 * - 有事件：立刻回到热态 800ms（观感不变）
 * - 连续空转：逐级退避到 5s
 * - 页面不可见：30s（visibilitychange 回前台会立即补一次）
 * - 请求失败：指数退避到 30s（避免断网时仍在死循环）
 */

export const POLL_ACTIVE_MS = 800;
export const POLL_IDLE_MAX_MS = 5000;
export const POLL_HIDDEN_MS = 30000;
export const POLL_ERROR_BASE_MS = 2000;
export const POLL_ERROR_MAX_MS = 30000;

/** 空转第 1 轮仍保持热态，覆盖「刚打开会话、消息还在路上」的场景。 */
export const POLL_IDLE_STEPS_MS = Object.freeze([800, 800, 1500, 3000, 5000]);

export function createPollState() {
	return { idleRounds: 0, errorRounds: 0 };
}

/** 成功同步一轮：有事件就回到热态，没有就累计空转轮数。 */
export function advanceAfterSuccess(state, hasEvents) {
	state.errorRounds = 0;
	state.idleRounds = hasEvents
		? 0
		: Math.min(state.idleRounds + 1, POLL_IDLE_STEPS_MS.length - 1);
	return state;
}

/** 失败一轮：指数退避，最多记到 2^8。 */
export function advanceAfterFailure(state) {
	state.errorRounds = Math.min(state.errorRounds + 1, 8);
	return state;
}

export function nextPollDelayMs(state, { hidden = false } = {}) {
	if (state.errorRounds > 0) {
		return Math.min(
			POLL_ERROR_BASE_MS * 2 ** (state.errorRounds - 1),
			POLL_ERROR_MAX_MS,
		);
	}
	if (hidden) {
		return POLL_HIDDEN_MS;
	}
	return POLL_IDLE_STEPS_MS[
		Math.min(state.idleRounds, POLL_IDLE_STEPS_MS.length - 1)
	];
}

/** 回到前台或网络恢复：清掉退避状态，立即补一次同步。 */
export function resetForForeground(state) {
	state.idleRounds = 0;
	state.errorRounds = 0;
	return state;
}
