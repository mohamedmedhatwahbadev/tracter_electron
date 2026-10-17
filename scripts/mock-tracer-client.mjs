#!/usr/bin/env node
/**
 * Pretends to be a Flutter app using the Tracer package, so the interceptor UI
 * can be exercised without a device. Follows WEBSOCKET_MESSAGES.md:
 *
 * - sends a `request`, then a `response` with the same id
 * - when the server turned interception on, the `response` has
 *   `intercepted: true` and the "app" waits for a matching `modified_response`
 * - stops waiting on timeout, on `interception: false` or on disconnect
 *
 * Usage: node scripts/mock-tracer-client.mjs [ws://localhost:8080]
 * Env:   MOCK_INTERVAL=1500 (ms between requests)
 */

const url = process.argv[2] ?? process.env.TRACER_URL ?? 'ws://localhost:8080';
const interval = Number(process.env.MOCK_INTERVAL ?? 1500);
const modificationTimeout = 2 * 60 * 1000;

const color = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;
const dim = color(2);
const cyan = color(36);
const green = color(32);
const yellow = color(33);
const red = color(31);

let socket = null;
let interception = false;
let counter = 0;
/** id -> resolve(modifiedResponse | null) */
const waiting = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min, max) => min + Math.floor(Math.random() * (max - min));
const pick = (items) => items[Math.floor(Math.random() * items.length)];

/** Dart's DateTime.now().toIso8601String(): local time, no zone suffix. */
function localIso(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}`
  );
}

/** Microseconds since epoch plus a counter, like `1760275200000000-0`. */
function nextId() {
  const id = `${Date.now() * 1000 + between(0, 1000)}-${counter}`;
  counter += 1;
  return id;
}

const token =
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0OTIifQ.mock';

const jsonHeaders = (extra = {}) => ({
  'content-type': ['application/json; charset=utf-8'],
  date: [new Date().toUTCString()],
  server: ['nginx'],
  ...extra,
});

const requestHeaders = (extra = {}) => ({
  'content-type': 'application/json',
  accept: 'application/json',
  authorization: token,
  'x-trace-id': `trc_${Math.random().toString(16).slice(2, 14)}`,
  ...extra,
});

/** Each scenario mirrors what Dio would report for a real call. */
const scenarios = [
  () => ({
    method: 'POST',
    url: 'https://api.acme.com/v1/auth/login',
    headers: requestHeaders({ authorization: undefined }),
    data: { email: 'security.researcher@example.com', password: '••••••••' },
    statusCode: 200,
    statusMessage: 'OK',
    responseHeaders: jsonHeaders({ 'set-cookie': ['session=abc; HttpOnly', 'theme=dark'] }),
    responseType: 'json',
    response: {
      token: 'eyJhbGciOiJIUzI1NiJ9.mock',
      user: { id: 492, email: 'security.researcher@example.com', role: 'user' },
      debug_mode: false,
      session: { impersonate: false, target_account_id: null },
      timestamp: Math.floor(Date.now() / 1000),
    },
  }),
  () => ({
    method: 'GET',
    url: `https://cdn-edge.acme.com/v2/feed?page=${between(1, 5)}&limit=25`,
    headers: requestHeaders(),
    data: null,
    statusCode: 200,
    statusMessage: 'OK',
    responseHeaders: jsonHeaders({ 'cache-control': ['max-age=60'] }),
    responseType: 'json',
    response: {
      page: 1,
      items: Array.from({ length: 4 }, (_, index) => ({
        id: 1000 + index,
        title: `Post #${1000 + index}`,
        likes: between(0, 500),
      })),
      next: '/v2/feed?page=2&limit=25',
    },
  }),
  () => ({
    method: 'PATCH',
    url: 'https://api.acme.com/v1/users/492/profile',
    headers: requestHeaders(),
    data: { displayName: 'Ada', bio: 'Mobile engineer' },
    statusCode: 204,
    statusMessage: 'No Content',
    responseHeaders: { date: [new Date().toUTCString()] },
    responseType: 'json',
    response: null,
  }),
  () => ({
    method: 'POST',
    url: 'https://stripe.acme.com/api/v1/checkout/session',
    headers: requestHeaders({ 'idempotency-key': nextId() }),
    data: { cartId: 'cart_88', currency: 'usd', items: [{ sku: 'SKU-1', qty: 2 }] },
    statusCode: 201,
    statusMessage: 'Created',
    responseHeaders: jsonHeaders({ location: ['/api/v1/checkout/session/cs_123'] }),
    responseType: 'json',
    response: { id: 'cs_123', amount: 4200, currency: 'usd', status: 'open' },
  }),
  () => ({
    method: 'DELETE',
    url: 'https://api.acme.com/v1/cache/purge-all',
    headers: requestHeaders(),
    data: null,
    statusCode: 500,
    statusMessage: 'Internal Server Error',
    responseHeaders: jsonHeaders(),
    responseType: 'json',
    response: { error: 'cache_unavailable', message: 'Redis cluster unreachable' },
  }),
  () => ({
    method: 'GET',
    url: 'https://api.acme.com/v1/users/999',
    headers: requestHeaders(),
    data: null,
    statusCode: 404,
    statusMessage: 'Not Found',
    responseHeaders: jsonHeaders(),
    responseType: 'json',
    response: { message: 'User 999 not found' },
  }),
  () => ({
    method: 'PUT',
    url: 'https://api.acme.com/v1/settings',
    headers: requestHeaders(),
    data: { notifications: 'sometimes', language: 'en' },
    statusCode: 422,
    statusMessage: 'Unprocessable Entity',
    responseHeaders: jsonHeaders(),
    responseType: 'json',
    response: { errors: { notifications: ['must be one of: always, never'] } },
  }),
  () => ({
    method: 'POST',
    url: 'https://api.acme.com/v1/uploads/avatar',
    headers: requestHeaders({ 'content-type': 'multipart/form-data; boundary=dio-boundary' }),
    // FormData bodies are described, not sent.
    data: {
      fields: [{ name: 'title', value: 'Hello' }],
      files: [{ name: 'avatar', filename: 'me.png', contentType: 'image/png', length: 20480 }],
    },
    statusCode: 200,
    statusMessage: 'OK',
    responseHeaders: jsonHeaders(),
    responseType: 'json',
    response: { url: 'https://cdn.acme.com/avatars/492.png', size: 20480 },
  }),
  () => ({
    method: 'GET',
    url: 'https://api.acme.com/health',
    headers: requestHeaders({ accept: 'text/plain' }),
    data: null,
    statusCode: 200,
    statusMessage: 'OK',
    responseHeaders: { 'content-type': ['text/plain'] },
    responseType: 'plain',
    response: 'OK',
  }),
  () => ({
    method: 'GET',
    url: 'https://static.acme.com/reports/latest.pdf',
    headers: requestHeaders({ accept: 'application/pdf' }),
    data: null,
    statusCode: 200,
    statusMessage: 'OK',
    responseHeaders: { 'content-type': ['application/pdf'], 'content-length': ['8'] },
    responseType: 'bytes',
    response: [37, 80, 68, 70, 45, 49, 46, 55], // "%PDF-1.7"
  }),
  () => ({
    method: 'GET',
    url: 'https://api.acme.com/v1/notifications/stream',
    headers: requestHeaders({ accept: 'text/event-stream' }),
    data: null,
    statusCode: 200,
    statusMessage: 'OK',
    responseHeaders: { 'content-type': ['text/event-stream'] },
    // Streams are never intercepted; the body is sent as its toString().
    responseType: 'stream',
    response: "Instance of 'ResponseBody'",
  }),
];

function send(action, data) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ action, data }));
  return true;
}

function releaseAll(reason) {
  waiting.forEach((resolve) => resolve(null));
  if (waiting.size) console.log(yellow(`↺ released ${waiting.size} held response(s): ${reason}`));
  waiting.clear();
}

function waitForModification(id) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, modificationTimeout);
    waiting.set(id, (modified) => {
      clearTimeout(timer);
      resolve(modified);
    });
  });
}

function describeOutcome(original, modified) {
  const statusCode =
    modified.statusCode === undefined ? original.statusCode : Number(modified.statusCode);
  const ok = statusCode >= 200 && statusCode < 300;
  const changed = Object.keys(modified).filter((key) => key !== 'id');
  const received = ok ? green(`Response ${statusCode}`) : red(`DioException(badResponse) ${statusCode}`);
  const what = changed.length ? `modified [${changed.join(', ')}]` : 'unchanged';
  const body = 'data' in modified ? dim(` data=${JSON.stringify(modified.data).slice(0, 120)}`) : '';
  return `${received} ${what}${body}`;
}

async function simulate() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const scenario = pick(scenarios)();
  const id = nextId();
  const path = new URL(scenario.url).pathname;

  send('request', {
    id,
    method: scenario.method,
    url: scenario.url,
    headers: Object.fromEntries(
      Object.entries(scenario.headers).filter(([, value]) => value !== undefined),
    ),
    data: scenario.data,
    timestamp: localIso(),
  });
  console.log(`${cyan('→ request ')} ${scenario.method.padEnd(6)} ${path} ${dim(id)}`);

  await sleep(between(15, 600));

  const intercepted = interception && scenario.responseType !== 'stream';
  const response = {
    id,
    method: scenario.method,
    url: scenario.url,
    statusCode: scenario.statusCode,
    statusMessage: scenario.statusMessage,
    headers: scenario.responseHeaders,
    responseType: scenario.responseType,
    data: scenario.response,
    intercepted,
    timestamp: localIso(),
  };
  if (!send('response', response)) return;

  if (!intercepted) {
    console.log(`${dim('← response')} ${scenario.statusCode} ${path}`);
    return;
  }

  console.log(`${yellow('⏸ held    ')} ${scenario.statusCode} ${path} ${dim('waiting for modified_response…')}`);
  const modified = await waitForModification(id);
  if (modified) {
    console.log(`${green('✓ app got ')} ${path} → ${describeOutcome(response, modified)}`);
  } else {
    console.log(`${yellow('✓ app got ')} ${path} → original response (released)`);
  }
}

function onMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return; // not JSON: ignored, like the real package
  }

  if (message?.action === 'interception') {
    const value = message.data;
    interception = value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
    console.log(interception ? yellow('● interception ON') : green('● interception OFF'));
    if (!interception) releaseAll('interception turned off');
  } else if (message?.action === 'modified_response') {
    const resolve = waiting.get(message.data?.id);
    if (resolve) {
      waiting.delete(message.data.id);
      resolve(message.data);
    } else {
      console.log(dim(`ignored late modified_response ${message.data?.id}`));
    }
  }
}

function connect() {
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    interception = false; // starts off on every connection
    console.log(green(`connected to ${url}`));
  });
  socket.addEventListener('message', (event) => onMessage(String(event.data)));
  socket.addEventListener('close', () => {
    interception = false;
    releaseAll('socket closed');
    console.log(dim(`disconnected from ${url}, retrying in 2s…`));
    setTimeout(connect, 2000);
  });
  socket.addEventListener('error', () => {});
}

connect();
setInterval(() => void simulate(), interval);

process.on('SIGINT', () => {
  console.log(dim('\nbye'));
  process.exit(0);
});
