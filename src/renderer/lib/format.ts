export type MethodTone = 'get' | 'post' | 'patch' | 'delete' | 'other';
export type StatusTone = 'info' | 'success' | 'redirect' | 'error';

const METHOD_LABELS: Record<string, string> = {
  PATCH: 'PTCH',
  DELETE: 'DEL',
  OPTIONS: 'OPT',
};

const STATUS_TAGS: Record<number, string> = {
  101: 'WS',
  200: 'OK',
  201: 'CRT',
  202: 'ACC',
  204: 'NC',
  206: 'PART',
  301: 'MOV',
  302: 'FND',
  304: 'NM',
  307: 'TMP',
  308: 'PRM',
  400: 'BAD',
  401: 'AUTH',
  403: 'FORB',
  404: 'NF',
  405: 'NA',
  408: 'TO',
  409: 'CONF',
  413: 'BIG',
  422: 'UNPR',
  429: 'RATE',
  500: 'ERR',
  502: 'BGW',
  503: 'UNAV',
  504: 'GTO',
};

export function methodLabel(method: string): string {
  const upper = method.toUpperCase();
  return METHOD_LABELS[upper] ?? upper;
}

export function methodTone(method: string): MethodTone {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'get';
    case 'POST':
      return 'post';
    case 'PUT':
    case 'PATCH':
      return 'patch';
    case 'DELETE':
      return 'delete';
    default:
      return 'other';
  }
}

export function statusTone(code: number): StatusTone {
  if (code >= 400) return 'error';
  if (code >= 300) return 'redirect';
  if (code >= 200) return 'success';
  return 'info';
}

export function statusLabel(code: number): string {
  const fallback: Record<StatusTone, string> = {
    info: 'INFO',
    success: 'OK',
    redirect: 'RDR',
    error: 'ERR',
  };
  return `${code} ${STATUS_TAGS[code] ?? fallback[statusTone(code)]}`;
}

/** Compact size for the traffic list: `54B`, `4.1K`, `78K`, `1.2M`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ['K', 'M', 'G'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 100 ? value.toFixed(1) : value.toFixed(0);
  return `${rounded.replace(/\.0$/, '')}${units[unit]}`;
}

/** Readable size for status bars: `242 Bytes`, `1.4 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'Byte' : 'Bytes'}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function splitUrl(url: string): { path: string; host: string } {
  try {
    const parsed = new URL(url);
    return { path: `${parsed.pathname}${parsed.search}`, host: parsed.host };
  } catch {
    return { path: url, host: '' };
  }
}

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Approximate wire size of a body as the app sees it. */
export function bodySize(data: unknown, responseType?: string): number {
  if (data === null || data === undefined) return 0;
  if (typeof data === 'string') return byteLength(data);
  if (responseType === 'bytes' && Array.isArray(data)) return data.length;
  return byteLength(JSON.stringify(data) ?? '');
}
