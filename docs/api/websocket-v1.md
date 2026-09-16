# EdgeChat WebSocket v1

> **当前部署状态：不可用。** 纯 D1 部署没有 Durable Objects，`/api/v1/realtime/ws`
> 在通过 upgrade 校验后直接返回 `501 realtime_unsupported`，且**不消费**票据。
> 客户端应当改用 `GET /api/v1/rooms/:kind/:id/sync?cursor=` 与
> `GET /api/v1/rooms/:kind/:id/messages` 做游标轮询；`POST /api/v1/realtime/tickets`
> 保留用于将来支持长连接的部署，现阶段调用没有意义。下面记录的帧格式仍然有效，
> 供恢复实时连接时参照。

Android clients use WebSocket only while the app is visible. Sending, deleting and retrying messages stays on the idempotent HTTP API.

## Connection

1. Call `POST /api/v1/realtime/tickets` with Bearer authentication.
2. Use scope `inbox`, or scope `room` with `roomKind` and `roomId`.
3. Connect to `/api/v1/realtime/ws?ticket=...` within 60 seconds.

The ticket is bound to one device session and one scope. It is consumed once, including a failed redemption after the server has atomically claimed it. Long-lived access and refresh tokens never appear in the WebSocket URL; only the single-use 60-second ticket is carried in the query string.

## Frames

Every server frame is JSON and contains `protocolVersion: 1` plus `type`.

- `ready`: the connection is authorized; room sockets include `room`.
- `message`: includes the canonical `message`, including `mentionUserIds`, resolved `mentions`, and optional `replyToMessageId` / `replyTo` preview fields. A deleted or expired target is represented by `replyTo.deleted: true`. Room clients merge by `message.id` and `message.clientMessageId`.
- `message_deleted`: includes `messageId`.
- `message_pinned`: includes the canonical pinned `message` for the room.
- `message_unpinned`: includes `messageId`; clients clear the pin only when it still matches that ID.
- `room_message`: inbox signal with `room`, `messageId`, `createdAt`, `unreadCount`, `mentionsMe`, `replyToMe`, `contentPreview` and `sender`; `mentionUnreadCount` keeps its legacy name but counts both mentions and replies, and is included only for directly addressed recipients so clients preserve their current value otherwise. The client then runs room sync.
- `error`: includes a client-safe `error` message and never contains a stack trace.

Example:

```json
{"protocolVersion":1,"type":"room_message","room":{"id":7,"kind":"private","name":"team"},"messageId":52,"createdAt":"2026-09-04 12:00:00","unreadCount":3,"mentionUnreadCount":1,"mentionsMe":false,"replyToMe":true,"contentPreview":"handled","sender":{"kind":"local","id":4,"username":"bob","displayName":"Bob","avatarUrl":"","source":"edgechat"}}
```

## Lifecycle and recovery

- Keep one inbox socket and, when open, one current-room socket while the app is visible.
- Close both with code `1000` when the app enters the background.
- Do not reconnect after normal closure, policy failure, authentication failure or authorization failure (`1000`, `1008`, `4401`, `4403`).
- Other failures retry after 1 second, 2 seconds and then 5 seconds.
- After foreground restore, reconnect or process restart, call the HTTP room sync endpoint. WebSocket delivery is never the sole source of truth.
