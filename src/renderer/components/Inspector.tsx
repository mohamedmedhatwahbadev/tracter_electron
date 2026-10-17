import { useEffect, useMemo, useState } from 'react';
import type { ModifiedResponse, ResponseType } from '../../shared/tracer';
import { changedLines } from '../lib/code';
import {
  applyModification,
  bodyText,
  buildModification,
  createDraft,
  headerRows,
  parseBody,
  ResponseDraft,
} from '../lib/draft';
import { byteLength, formatBytes } from '../lib/format';
import type { Flow } from '../state/flows';
import CodeEditor from './CodeEditor';
import HeadersSection from './HeadersSection';
import { flowMethod, flowUrl } from './FlowList';
import pausedBadgeIcon from '../assets/icons/paused-badge.svg';
import dropIcon from '../assets/icons/drop.svg';
import resumeIcon from '../assets/icons/resume.svg';
import forwardIcon from '../assets/icons/forward.svg';
import copyIcon from '../assets/icons/copy.svg';
import lockIcon from '../assets/icons/lock.svg';
import payloadIcon from '../assets/icons/payload.svg';
import formatIcon from '../assets/icons/format.svg';
import resetIcon from '../assets/icons/reset.svg';
import jsonValidIcon from '../assets/icons/json-valid.svg';
import './Inspector.css';

type Tab = 'request' | 'response';

interface InspectorProps {
  flow: Flow;
  draft: ResponseDraft | undefined;
  clientAddress: string | undefined;
  pausedCount: number;
  onDraftChange: (key: string, draft: ResponseDraft) => void;
  onForward: (flow: Flow, modification: ModifiedResponse) => void;
  onResumeAll: () => void;
}

const isMac = navigator.platform.toLowerCase().includes('mac');

const BODY_LABELS: Record<ResponseType, string> = {
  json: 'JSON',
  plain: 'Plain Text',
  bytes: 'Bytes',
  stream: 'Stream',
};

function banner(flow: Flow) {
  const id = `#${flow.seq}`;
  switch (flow.state) {
    case 'paused':
      return {
        tone: 'warning',
        badge: `PAUSED FLOW ${id}`,
        text: 'Response Intercepted — Edit status, headers or body before forwarding',
      };
    case 'pending':
      return {
        tone: 'info',
        badge: `IN FLIGHT ${id}`,
        text: 'Request sent — waiting for the server to respond',
      };
    case 'forwarded':
      return {
        tone: 'success',
        badge: `FORWARDED ${id}`,
        text: flow.modification
          ? 'Your modified response was delivered to the app'
          : 'Response forwarded to the app unchanged',
      };
    case 'released':
      return {
        tone: 'neutral',
        badge: `RELEASED ${id}`,
        text: 'The app stopped waiting (timeout, interception off or disconnect) and used the original response',
      };
    default:
      return {
        tone: 'neutral',
        badge: `COMPLETED ${id}`,
        text: 'Captured in pass-through mode — read only',
      };
  }
}

function responseBadge(flow: Flow, changes: number) {
  if (!flow.response) return 'Awaiting';
  if (flow.state === 'paused') return changes > 0 ? 'STAGED' : 'HELD';
  if (flow.state === 'forwarded' && flow.modification) return 'MODIFIED';
  return String(
    applyModification(flow.response, flow.modification).statusCode,
  );
}

function looksLikeJson(text: string) {
  return /^\s*[{["]/.test(text);
}

export default function Inspector({
  flow,
  draft: storedDraft,
  clientAddress,
  pausedCount,
  onDraftChange,
  onForward,
  onResumeAll,
}: InspectorProps) {
  const [tab, setTab] = useState<Tab>(flow.response ? 'response' : 'request');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [copied, setCopied] = useState(false);

  const { request, response } = flow;
  const editable = flow.state === 'paused' && !!response;
  const url = flowUrl(flow);
  const info = banner(flow);

  // Editable draft for a held response; a read-only snapshot otherwise.
  const draft = useMemo(() => {
    if (!response) return undefined;
    if (editable) return storedDraft ?? createDraft(response);
    return createDraft(applyModification(response, flow.modification));
  }, [response, editable, storedDraft, flow.modification]);

  const result = useMemo(
    () => (editable && response && draft ? buildModification(response, draft) : null),
    [editable, response, draft],
  );

  const originalBody = useMemo(
    () => (response ? bodyText(response.data, response.responseType) : ''),
    [response],
  );

  const changed = useMemo(
    () =>
      editable && draft && draft.body !== originalBody
        ? changedLines(originalBody.split('\n'), draft.body.split('\n'))
        : undefined,
    [editable, draft, originalBody],
  );

  const originalHeaders = useMemo(
    () =>
      editable && response
        ? new Map(Object.entries(response.headers ?? {}))
        : undefined,
    [editable, response],
  );

  const requestView = useMemo(
    () => ({
      headers: headerRows(request?.headers),
      body: bodyText(request?.data),
    }),
    [request],
  );

  const setDraft = (patch: Partial<ResponseDraft>) => {
    if (draft) onDraftChange(flow.key, { ...draft, ...patch });
  };

  const forward = () => {
    if (result && !result.error) onForward(flow, result.modification);
  };

  useEffect(() => {
    if (!editable) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (result && !result.error) onForward(flow, result.modification);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editable, result, flow, onForward]);

  const copyUrl = () => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const showingResponse = tab === 'response' && !!response && !!draft;
  const responseType = response?.responseType ?? 'json';
  const body = showingResponse ? draft.body : requestView.body;
  const json = showingResponse
    ? responseType === 'json' || responseType === 'bytes'
    : looksLikeJson(requestView.body);
  const bodyLabel = showingResponse
    ? BODY_LABELS[responseType]
    : `${json ? 'JSON' : 'Text'}`;

  let validity: { ok: boolean; text: string } | null = null;
  if (json && body) {
    const parsed = parseBody(body, showingResponse ? responseType : 'json');
    validity = parsed.ok
      ? { ok: true, text: `${showingResponse ? bodyLabel : 'JSON'} Valid` }
      : { ok: false, text: parsed.error };
  }

  const changeCount =
    (changed?.size ?? 0) +
    (result
      ? ['statusCode', 'statusMessage', 'headers'].filter(
          (field) => field in result.modification,
        ).length
      : 0);
  const tampering = !!result && (result.changes > 0 || !!changed?.size);

  let emptyBody = 'No body';
  if (tab === 'response' && !response) emptyBody = 'Waiting for the response…';

  return (
    <section className="inspector" aria-label="Request inspector">
      <div className="inspector-banner">
        <div className="inspector-banner__status">
          <span className={`flow-badge flow-badge--${info.tone}`}>
            {info.tone === 'warning' && <img src={pausedBadgeIcon} alt="" />}
            {info.badge}
          </span>
          <span className="inspector-banner__text">{info.text}</span>
        </div>
        {editable && (
          <div className="inspector-banner__actions">
            <button
              type="button"
              className="action-button action-button--danger"
              title="Release the original response and discard your edits"
              onClick={() => onForward(flow, { id: flow.id })}
            >
              <img src={dropIcon} alt="" />
              Drop Edits
            </button>
            <button
              type="button"
              className="action-button"
              title="Release every held response unchanged"
              onClick={onResumeAll}
            >
              <img src={resumeIcon} alt="" />
              Resume Stream
              {pausedCount > 1 && (
                <span className="text-subtle">({pausedCount})</span>
              )}
            </button>
            <button
              type="button"
              className="action-button action-button--primary"
              disabled={!!result?.error}
              title={result?.error ?? 'Send the response to the app'}
              onClick={forward}
            >
              Forward Response
              <img src={forwardIcon} alt="" />
              <kbd>{isMac ? '⌘↵' : 'Ctrl↵'}</kbd>
            </button>
          </div>
        )}
        <div className="url-bar">
          <span className="url-bar__method">{flowMethod(flow)}</span>
          <input
            className="url-bar__input"
            aria-label="Request URL"
            value={url}
            readOnly
          />
          <button
            type="button"
            className="url-bar__copy"
            aria-label="Copy URL"
            title={copied ? 'Copied' : 'Copy URL'}
            onClick={copyUrl}
          >
            <img src={copyIcon} alt="" />
          </button>
        </div>
      </div>

      <div className="inspector-tabs" role="tablist">
        <div className="inspector-tabs__list">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'request'}
            className="inspector-tab"
            onClick={() => setTab('request')}
          >
            <span className="dot" />
            Request
            <span className="inspector-tab__badge">
              {request ? 'SENT' : 'MISSED'}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'response'}
            className="inspector-tab"
            onClick={() => setTab('response')}
          >
            <span className="dot" />
            {editable ? 'Intercepted Response' : 'Response'}
            <span className="inspector-tab__badge">
              {responseBadge(flow, result?.changes ?? 0)}
            </span>
          </button>
        </div>
        <div className="inspector-tabs__meta">
          {url.startsWith('https:') ? (
            <span className="inspector-tabs__secure">
              <img src={lockIcon} alt="" />
              HTTPS
            </span>
          ) : (
            <span className="text-subtle">HTTP</span>
          )}
          {clientAddress && (
            <span className="text-subtle">Device {clientAddress}</span>
          )}
        </div>
      </div>

      {showingResponse ? (
        <HeadersSection
          title="Response Headers"
          rows={draft.headers}
          original={originalHeaders}
          onChange={editable ? (headers) => setDraft({ headers }) : undefined}
          status={{
            code: draft.statusCode,
            message: draft.statusMessage,
            onChange: editable
              ? (statusCode, statusMessage) =>
                  setDraft({ statusCode, statusMessage })
              : undefined,
          }}
        />
      ) : (
        <HeadersSection title="Request Headers" rows={requestView.headers} />
      )}

      <div className="body-ribbon">
        <div className="body-ribbon__title">
          <span className="section-label">
            <img src={payloadIcon} alt="" />
            Payload Body ({bodyLabel})
          </span>
          {tampering && <span className="tampering-tag">TAMPERING ACTIVE</span>}
        </div>
        {showingResponse && editable && (
          <div className="body-ribbon__actions">
            <button
              type="button"
              className="ghost-button"
              disabled={!json || !validity?.ok}
              onClick={() => {
                const parsed = parseBody(draft.body, responseType);
                if (parsed.ok) {
                  setDraft({
                    body:
                      responseType === 'bytes'
                        ? JSON.stringify(parsed.value)
                        : JSON.stringify(parsed.value, null, 2),
                  });
                }
              }}
            >
              <img src={formatIcon} alt="" />
              Format
            </button>
            <button
              type="button"
              className="ghost-button"
              title="Discard all edits to this response"
              onClick={() =>
                response && onDraftChange(flow.key, createDraft(response))
              }
            >
              <img src={resetIcon} alt="" />
              Reset
            </button>
          </div>
        )}
      </div>

      <CodeEditor
        label={showingResponse ? 'Response body' : 'Request body'}
        value={tab === 'response' && !response ? '' : body}
        json={json}
        readOnly={!(showingResponse && editable) || responseType === 'stream'}
        changed={showingResponse ? changed : undefined}
        placeholder={emptyBody}
        onChange={(value) => setDraft({ body: value })}
        onCursorChange={(line, column) => setCursor({ line, column })}
      />

      <footer className="editor-strip">
        <div className="editor-strip__left">
          {validity && (
            <span
              className={`editor-strip__validity ${validity.ok ? 'text-success' : 'text-error'}`}
              title={validity.text}
            >
              {validity.ok && <img src={jsonValidIcon} alt="" />}
              {validity.ok ? validity.text : `Invalid: ${validity.text}`}
            </span>
          )}
          {validity && <span className="text-subtle">•</span>}
          <span className="text-muted">UTF-8</span>
          {result?.error && validity?.ok !== false && (
            <>
              <span className="text-subtle">•</span>
              <span className="text-error">{result.error}</span>
            </>
          )}
          {changeCount > 0 && (
            <>
              <span className="text-subtle">•</span>
              <span className="text-warning strong">
                {changeCount} {changeCount === 1 ? 'change' : 'changes'} staged
              </span>
            </>
          )}
        </div>
        <span className="text-subtle">
          Ln {cursor.line}, Col {cursor.column} • {formatBytes(byteLength(body))}
        </span>
      </footer>
    </section>
  );
}

export function EmptyInspector({ serverUrls }: { serverUrls: string[] }) {
  return (
    <section className="inspector inspector--empty" aria-label="Request inspector">
      <div className="inspector-empty">
        <p className="inspector-empty__title">No request selected</p>
        <p className="text-subtle">
          Pick a request from the list. With interception on, responses pause
          here so you can edit them before the app receives them.
        </p>
        <p className="text-subtle">Initialize the Tracer package with:</p>
        <ul className="inspector-empty__urls">
          {serverUrls.map((url) => (
            <li key={url} className="text-success">
              {url}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
