export type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'text';

export interface Token {
  kind: TokenKind;
  text: string;
}

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

/** Splits one line of (possibly invalid) JSON into highlightable tokens. */
export function tokenizeJsonLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  JSON_TOKEN.lastIndex = 0;
  let match = JSON_TOKEN.exec(line);
  while (match) {
    if (match.index > last) {
      tokens.push({ kind: 'text', text: line.slice(last, match.index) });
    }
    const [whole, string, colon, number, literal] = match;
    if (string !== undefined && colon !== undefined) {
      tokens.push({ kind: 'key', text: string });
      tokens.push({ kind: 'punct', text: colon });
    } else if (string !== undefined) {
      tokens.push({ kind: 'string', text: string });
    } else if (number !== undefined) {
      tokens.push({ kind: 'number', text: number });
    } else if (literal !== undefined) {
      tokens.push({ kind: 'literal', text: literal });
    } else {
      tokens.push({ kind: 'punct', text: whole });
    }
    last = match.index + whole.length;
    match = JSON_TOKEN.exec(line);
  }
  if (last < line.length) tokens.push({ kind: 'text', text: line.slice(last) });
  return tokens;
}

const MAX_DIFF_CELLS = 1_000_000;

/** Indices of lines in `after` that are not part of the longest common subsequence with `before`. */
export function changedLines(before: string[], after: string[]): Set<number> {
  const changed = new Set<number>();

  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const old = before.slice(start, endBefore);
  const cur = after.slice(start, endAfter);

  if (old.length * cur.length > MAX_DIFF_CELLS) {
    cur.forEach((line, index) => {
      if (line !== old[index]) changed.add(start + index);
    });
    return changed;
  }

  // lcs[i][j] = LCS length of old[i..] and cur[j..]
  const lcs = Array.from(
    { length: old.length + 1 },
    () => new Uint32Array(cur.length + 1),
  );
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = cur.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        old[i] === cur[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (j < cur.length) {
    if (i < old.length && old[i] === cur[j]) {
      i += 1;
      j += 1;
    } else if (i < old.length && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i += 1;
    } else {
      changed.add(start + j);
      j += 1;
    }
  }
  return changed;
}
