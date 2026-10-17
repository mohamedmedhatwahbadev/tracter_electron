import type {
  ModifiedResponse,
  ResponseType,
  TracerResponse,
} from '../../shared/tracer';

export interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

/** Editable copy of an intercepted response. */
export interface ResponseDraft {
  statusCode: string;
  statusMessage: string;
  headers: HeaderRow[];
  body: string;
}

let lastRowId = 0;

export function headerRow(key = '', value = ''): HeaderRow {
  lastRowId += 1;
  return { id: lastRowId, key, value };
}

/** One row per value, so multi-value headers such as set-cookie survive a round trip. */
export function headerRows(headers: Record<string, unknown> | undefined) {
  return Object.entries(headers ?? {}).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).map((item) =>
      headerRow(key, typeof item === 'string' ? item : JSON.stringify(item)),
    ),
  );
}

export function bodyText(data: unknown, responseType?: ResponseType): string {
  if (data === undefined || data === null) {
    return responseType === 'json' ? 'null' : '';
  }
  if (typeof data === 'string' && responseType !== 'json') return data;
  if (responseType === 'bytes') return JSON.stringify(data);
  return JSON.stringify(data, null, 2) ?? '';
}

export function createDraft(response: TracerResponse): ResponseDraft {
  return {
    statusCode: String(response.statusCode),
    statusMessage: response.statusMessage ?? '',
    headers: headerRows(response.headers),
    body: bodyText(response.data, response.responseType),
  };
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

export function parseBody(text: string, responseType: ResponseType): Parsed {
  if (responseType === 'plain') return { ok: true, value: text };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  if (
    responseType === 'bytes' &&
    !(
      Array.isArray(value) &&
      value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    )
  ) {
    return { ok: false, error: 'Bytes must be an array of numbers 0–255' };
  }
  return { ok: true, value };
}

function groupHeaders(rows: HeaderRow[]): Record<string, string[]> {
  const headers: Record<string, string[]> = {};
  rows.forEach(({ key, value }) => {
    const name = key.trim();
    if (!name) return;
    headers[name] = [...(headers[name] ?? []), value];
  });
  return headers;
}

function sameHeaders(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  const normalize = (headers: Record<string, string[]>) =>
    JSON.stringify(
      Object.keys(headers)
        .sort()
        .map((key) => [key, headers[key]]),
    );
  return normalize(a) === normalize(b);
}

export interface DraftResult {
  /** Only the fields that differ from the original, as the protocol expects. */
  modification: ModifiedResponse;
  changes: number;
  error: string | null;
}

export function buildModification(
  response: TracerResponse,
  draft: ResponseDraft,
): DraftResult {
  const modification: ModifiedResponse = { id: response.id };
  let error: string | null = null;

  const statusCode = Number(draft.statusCode.trim());
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    error = 'Status code must be a number between 100 and 599';
  } else if (statusCode !== response.statusCode) {
    modification.statusCode = statusCode;
  }

  if (draft.statusMessage !== (response.statusMessage ?? '')) {
    modification.statusMessage = draft.statusMessage || null;
  }

  const headers = groupHeaders(draft.headers);
  if (!sameHeaders(headers, response.headers ?? {})) {
    modification.headers = headers;
  }

  if (draft.body !== bodyText(response.data, response.responseType)) {
    const parsed = parseBody(draft.body, response.responseType);
    if (!parsed.ok) {
      error = error ?? parsed.error;
    } else if (
      JSON.stringify(parsed.value) !== JSON.stringify(response.data ?? null)
    ) {
      modification.data = parsed.value;
    }
  }

  return {
    modification,
    changes: Object.keys(modification).length - 1,
    error,
  };
}

/** The response as the app received it, after any modification we sent. */
export function applyModification(
  response: TracerResponse,
  modification: ModifiedResponse | undefined,
): TracerResponse {
  if (!modification) return response;
  const headers = modification.headers
    ? Object.fromEntries(
        Object.entries(modification.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value : [value],
        ]),
      )
    : response.headers;
  return {
    ...response,
    statusCode: modification.statusCode ?? response.statusCode,
    statusMessage:
      modification.statusMessage === undefined
        ? response.statusMessage
        : modification.statusMessage,
    headers,
    data: 'data' in modification ? modification.data : response.data,
  };
}
