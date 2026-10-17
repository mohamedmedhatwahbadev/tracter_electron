import { KeyboardEvent, useMemo, useRef } from 'react';
import { tokenizeJsonLine } from '../lib/code';
import './CodeEditor.css';

interface CodeEditorProps {
  value: string;
  label: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** Apply JSON syntax colors. */
  json?: boolean;
  /** Zero-based indices of lines that differ from the original. */
  changed?: Set<number>;
  placeholder?: string;
  onCursorChange?: (line: number, column: number) => void;
}

// Above this size, skip per-line rendering to keep typing responsive.
const RICH_LIMIT = 200_000;
const NO_CHANGES = new Set<number>();

function Line({ text, json }: { text: string; json: boolean }) {
  if (!json) return <>{text}</>;
  return (
    <>
      {tokenizeJsonLine(text).map((token, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={index} className={`tok-${token.kind}`}>
          {token.text}
        </span>
      ))}
    </>
  );
}

/** A textarea layered over a syntax-highlighted copy of its text. */
export default function CodeEditor({
  value,
  label,
  onChange,
  readOnly = false,
  json = false,
  changed = NO_CHANGES,
  placeholder,
  onCursorChange,
}: CodeEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const rich = value.length <= RICH_LIMIT;

  // Memoized so unrelated re-renders (e.g. timers) don't re-tokenize the body.
  const { gutter, code } = useMemo(() => {
    const lines = value.split('\n');
    if (!rich) {
      return {
        gutter: <pre>{lines.map((_, index) => index + 1).join('\n')}</pre>,
        code: value,
      };
    }
    return {
      gutter: lines.map((_, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className={changed.has(index) ? 'is-changed' : undefined}
        >
          {index + 1}
        </div>
      )),
      code: lines.map((line, index) => {
        const isChanged = changed.has(index);
        return (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={`code-line ${isChanged ? 'code-line--changed' : ''}`}
          >
            <Line text={line} json={json} />
            {isChanged && !changed.has(index - 1) && (
              <span className="code-line__badge">MODIFIED VALUE</span>
            )}
          </div>
        );
      }),
    };
  }, [value, rich, changed, json]);

  const syncScroll = () => {
    const input = inputRef.current;
    if (!input) return;
    if (layerRef.current) {
      layerRef.current.scrollTop = input.scrollTop;
      layerRef.current.scrollLeft = input.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = input.scrollTop;
  };

  const reportCursor = () => {
    const input = inputRef.current;
    if (!input || !onCursorChange) return;
    const before = input.value.slice(0, input.selectionStart);
    const line = before.split('\n').length;
    onCursorChange(line, before.length - before.lastIndexOf('\n'));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || readOnly || !onChange) return;
    event.preventDefault();
    const input = event.currentTarget;
    input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
    onChange(input.value);
  };

  return (
    <div className="code-editor">
      <div className="code-editor__gutter" ref={gutterRef} aria-hidden>
        {gutter}
      </div>
      <div className="code-editor__surface">
        <div className="code-editor__layer" ref={layerRef} aria-hidden>
          <pre className={`code-editor__code ${json ? '' : 'is-plain'}`}>
            {code}
          </pre>
        </div>
        <textarea
          ref={inputRef}
          className="code-editor__input"
          aria-label={label}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          onChange={(event) => onChange?.(event.target.value)}
          onScroll={syncScroll}
          onSelect={reportCursor}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
