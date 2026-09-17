import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	POLL_HIDDEN_MS,
	advanceAfterFailure,
	advanceAfterSuccess,
	createPollState,
	nextPollDelayMs,
	resetForForeground,
} from "../frontend/src/realtime-polling.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("有事件抵达时保持 800ms 热态轮询", () => {
	const state = createPollState();
	assert.equal(nextPollDelayMs(state), 800);
	advanceAfterSuccess(state, true);
	assert.equal(nextPollDelayMs(state), 800);
});

test("连续空转逐级退避并在 5 秒封顶", () => {
	const state = createPollState();
	const delays = [];
	for (let round = 0; round < 8; round += 1) {
		advanceAfterSuccess(state, false);
		delays.push(nextPollDelayMs(state));
	}
	assert.deepEqual(delays, [800, 1500, 3000, 5000, 5000, 5000, 5000, 5000]);
});

test("页面不可见时退避到 30 秒", () => {
	const state = createPollState();
	advanceAfterSuccess(state, true);
	assert.equal(nextPollDelayMs(state, { hidden: true }), POLL_HIDDEN_MS);
});

test("请求失败指数退避封顶 30 秒，恢复成功后立刻回到热态", () => {
	const state = createPollState();
	const delays = [];
	for (let round = 0; round < 8; round += 1) {
		advanceAfterFailure(state);
		delays.push(nextPollDelayMs(state));
	}
	assert.deepEqual(delays, [
		2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000,
	]);

	advanceAfterSuccess(state, true);
	assert.equal(state.errorRounds, 0);
	assert.equal(nextPollDelayMs(state), 800);
});

test("回到前台会重置退避状态", () => {
	const state = createPollState();
	advanceAfterSuccess(state, false);
	advanceAfterSuccess(state, false);
	advanceAfterFailure(state);
	assert.notEqual(nextPollDelayMs(state), 800);

	resetForForeground(state);
	assert.equal(nextPollDelayMs(state), 800);
});

test("房间轮询接入自适应节流并感知页面可见性", () => {
	const source = readFileSync(`${projectRoot}frontend/src/ws.js`, "utf8");
	assert.match(source, /nextPollDelayMs\(pollState/);
	assert.match(source, /document\.addEventListener\("visibilitychange"/);
	assert.match(source, /window\.addEventListener\("online", wakeNow\)/);
	// 旧的「永远 800ms」写法必须消失，否则单个后台标签页仍能打满免费额度
	assert.doesNotMatch(source, /setTimeout\(fetchSync, 800\)/);
});
