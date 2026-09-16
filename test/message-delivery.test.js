import assert from "node:assert/strict";
import test from "node:test";

import {
	MessageSubmissionError,
	createMessageSubmission,
} from "../worker/src/message-submission.js";

test("消息提交 module 统一持久化参数与广播 packet", async () => {
	const calls = [];
	const message = { id: 11, content: "hello" };
	const submit = createMessageSubmission({
		async persistMessage(env, args) {
			calls.push({ env, args });
			return message;
		},
	});
	const env = {};
	const result = await submit(
		env,
		{ room: { id: 3 }, principal: { userId: 7 } },
		{ content: "hello", attachment: { key: "a" } },
	);

	assert.deepEqual(calls, [{
		env,
		args: {
			channelId: 3,
			senderId: 7,
			content: "hello",
			attachment: { key: "a" },
			mentionUserIds: [],
		},
	}]);
	assert.equal(result.message, message);
	assert.deepEqual(JSON.parse(result.packet), { protocolVersion: 1, type: "message", message });
});

test("消息提交只转换可预期的空消息错误", async () => {
	const submitEmpty = createMessageSubmission({
		async persistMessage() {
			throw new Error("Message content cannot be empty");
		},
	});
	await assert.rejects(
		submitEmpty({}, { room: {}, principal: {} }, {}),
		(error) => error instanceof MessageSubmissionError && error.message === "消息内容不能为空",
	);

	const original = new Error("database unavailable");
	const submitFailure = createMessageSubmission({
		async persistMessage() {
			throw original;
		},
	});
	await assert.rejects(submitFailure({}, { room: {}, principal: {} }, {}), original);
});
