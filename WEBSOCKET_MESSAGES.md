# Tracer WebSocket messages

Tracer connects your app to a server over a WebSocket. It reports every Dio request and response to the server, and lets the server replace responses before the app sees them.

## Setup

```dart
import 'package:dio/dio.dart';
import 'package:tracer/tracer.dart';

Future<void> main() async {
  await TracerSocket.instance.initialize(
    'ws://192.168.1.10:8080',
    modificationTimeout: const Duration(minutes: 2), // optional
  );

  final dio = Dio()
    ..interceptors.addAll([
      TracerRequestInterceptor(),
      TracerResponseInterceptor(),
    ]);
}
```

`initialize` returns `false` if it cannot connect. It never throws. While disconnected, both interceptors let traffic through unchanged.

## Envelope

Every message, in both directions, is one JSON text frame with this shape:

```json
{ "action": "<action>", "data": <payload> }
```

| `action`            | Direction       | Sent when                                    |
| ------------------- | --------------- | -------------------------------------------- |
| `request`           | app → server    | Before every request is sent                 |
| `response`          | app → server    | Every response, including 4xx/5xx            |
| `interception`      | server → app    | The server turns interception on or off      |
| `modified_response` | server → app    | The server answers an intercepted `response` |

The app ignores messages with an unknown `action` and messages that are not valid JSON.

---

## App → server

### `request`

Sent by `TracerRequestInterceptor` for every request.

```json
{
  "action": "request",
  "data": {
    "id": "1760275200000000-0",
    "method": "POST",
    "url": "https://api.example.com/users?page=1",
    "headers": { "content-type": "application/json", "authorization": "Bearer …" },
    "data": { "name": "Ada" },
    "timestamp": "2026-10-12T15:00:00.000"
  }
}
```

| Field       | Type   | Notes                                                                      |
| ----------- | ------ | -------------------------------------------------------------------------- |
| `id`        | string | Unique per request. The matching `response` carries the same `id`.         |
| `method`    | string | `GET`, `POST`, …                                                           |
| `url`       | string | Full URL, query string included.                                           |
| `headers`   | object | Request headers.                                                           |
| `data`      | any    | The request body. See [Bodies](#bodies). `null` when there is no body.     |
| `timestamp` | string | ISO-8601, device local time.                                               |

### `response`

Sent by `TracerResponseInterceptor` for every response, successful or not.

```json
{
  "action": "response",
  "data": {
    "id": "1760275200000000-0",
    "method": "POST",
    "url": "https://api.example.com/users?page=1",
    "statusCode": 201,
    "statusMessage": "Created",
    "headers": { "content-type": ["application/json; charset=utf-8"] },
    "responseType": "json",
    "data": { "id": 7, "name": "Ada" },
    "intercepted": true,
    "timestamp": "2026-10-12T15:00:00.250"
  }
}
```

| Field           | Type    | Notes                                                                                     |
| --------------- | ------- | ----------------------------------------------------------------------------------------- |
| `id`            | string  | Same `id` as the `request`.                                                               |
| `method`, `url` | string  | Copied from the request so the response can be shown on its own.                          |
| `statusCode`    | number  |                                                                                           |
| `statusMessage` | string  | May be `null`.                                                                            |
| `headers`       | object  | Each value is a **list** of strings.                                                      |
| `responseType`  | string  | `json`, `plain`, `bytes` or `stream`. Tells you what shape `data` must have if you modify it. |
| `data`          | any     | The response body as the app will receive it.                                             |
| `intercepted`   | boolean | `true`: the app is **waiting** for a `modified_response` with this `id`. `false`: report only, do not reply. |
| `timestamp`     | string  | ISO-8601, device local time.                                                              |

---

## Server → app

### `interception`

Turns interception on or off. The app keeps this value until the next `interception` message or until the socket disconnects.

```json
{ "action": "interception", "data": "true" }
```

```json
{ "action": "interception", "data": "false" }
```

- `data` can be the string `"true"`/`"false"` (any case) or a JSON boolean. Anything else counts as `false`.
- Interception starts **off** when the app connects.
- Interception is reset to **off** when the socket disconnects.
- Turning it **off** releases every response the app is still waiting on. Those responses continue unmodified.

### `modified_response`

Your reply to a `response` that had `"intercepted": true`. Its `id` must match that response's `id`.

```json
{
  "action": "modified_response",
  "data": {
    "id": "1760275200000000-0",
    "statusCode": 200,
    "statusMessage": "OK",
    "headers": { "content-type": "application/json", "x-mocked": ["yes"] },
    "data": { "id": 7, "name": "Changed by Tracer" }
  }
}
```

| Field           | Required | Type   | Notes                                                                          |
| --------------- | -------- | ------ | ------------------------------------------------------------------------------ |
| `id`            | yes      | string | The `id` of the intercepted `response`.                                        |
| `statusCode`    | no       | number | A numeric string is also accepted.                                             |
| `statusMessage` | no       | string |                                                                                |
| `headers`       | no       | object | Values can be a string or a list of strings. If present, it **replaces all** original headers. |
| `data`          | no       | any    | Replaces the body. Sending `"data": null` sets the body to `null`.             |

Any field you leave out keeps its original value. To send the response back unchanged, reply with just the `id`:

```json
{ "action": "modified_response", "data": { "id": "1760275200000000-0" } }
```

---

## Interception flow

### Interception off (default)

```
App                                   Server
 │ ── request  {id: A, …} ───────────▶ │
 │ ── response {id: A, intercepted: false} ─▶ │   (no reply expected)
 │  app receives the original response
```

### Interception on

```
App                                   Server
 │ ◀── interception "true" ─────────── │
 │ ── request  {id: A, …} ───────────▶ │
 │ ── response {id: A, intercepted: true} ──▶ │
 │        … app waits …                │   edit the response
 │ ◀── modified_response {id: A, …} ── │
 │  app receives the modified response
```

The app stops waiting and uses the **original** response when any of these happens first:

- the `modificationTimeout` passed to `initialize` elapses (default 2 minutes),
- the server sends `interception` `"false"`,
- the socket disconnects.

A `modified_response` that arrives after this is ignored.

---

## Rules

### Success or error follows the status code

After modification, the request's `validateStatus` decides how the app receives the response. By default, 2xx is a success and anything else is an error:

| Original     | Modified `statusCode` | App receives                                         |
| ------------ | --------------------- | ---------------------------------------------------- |
| 200          | 200                   | Successful `Response` with the new data              |
| 200          | 500                   | `DioException` (`badResponse`) carrying the new response |
| 404          | 200                   | Successful `Response`. The error is cancelled.       |
| 404          | 404 / omitted         | `DioException` (`badResponse`) carrying the new response |

Requests that fail without a response, such as timeouts or no network, are not reported.

### `data` must match `responseType`

The app receives `data` exactly as you send it. Send the shape the app's code expects:

| `responseType` | Send `data` as                                    |
| -------------- | ------------------------------------------------- |
| `json`         | The decoded JSON: an object, array, string, number, … |
| `plain`        | A string                                          |
| `bytes`        | An array of byte values (`0`–`255`)               |
| `stream`       | Never intercepted. `intercepted` is always `false`. |

If the app calls `dio.get<Map<String, dynamic>>(…)` and you send an array, the app gets a type error.

### Bodies

Request and response bodies are sent as-is when they are JSON-encodable. Anything else is sent as its `toString()`. `FormData` request bodies are described instead of sent:

```json
{
  "fields": [{ "name": "title", "value": "Hello" }],
  "files": [
    { "name": "avatar", "filename": "me.png", "contentType": "image/png", "length": 20480 }
  ]
}
```
