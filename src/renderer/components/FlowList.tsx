import { KeyboardEvent, memo } from 'react';
import { applyModification } from '../lib/draft';
import {
  formatDuration,
  formatSize,
  methodLabel,
  methodTone,
  splitUrl,
  statusLabel,
  statusTone,
} from '../lib/format';
import type { Flow } from '../state/flows';
import breakpointIcon from '../assets/icons/breakpoint.svg';
import './FlowList.css';

interface FlowListProps {
  flows: Flow[];
  totalCount: number;
  selectedKey: string | null;
  now: number;
  connected: boolean;
  serverUrl: string;
  filter: string;
  onSelect: (key: string) => void;
}

export function flowMethod(flow: Flow) {
  return flow.request?.method ?? flow.response?.method ?? '—';
}

export function flowUrl(flow: Flow) {
  return flow.request?.url ?? flow.response?.url ?? '';
}

function StatusCell({ flow }: { flow: Flow }) {
  if (flow.state === 'paused') {
    return <span className="flow-row__paused">PAUSED</span>;
  }
  if (!flow.response) {
    return <span className="flow-row__status text-subtle">···</span>;
  }
  const { statusCode } = applyModification(flow.response, flow.modification);
  return (
    <span
      className={`flow-row__status flow-row__status--${statusTone(statusCode)}`}
    >
      {statusLabel(statusCode)}
    </span>
  );
}

function TimeCell({ flow, now }: { flow: Flow; now: number }) {
  if (flow.state === 'paused') {
    return (
      <span className="text-warning strong">
        {formatDuration(now - (flow.heldSince ?? now))} held
      </span>
    );
  }
  if (flow.state === 'pending') {
    return (
      <span className="flow-row__live text-success">
        <span className="dot dot--small dot--pulse" />
        live
      </span>
    );
  }
  if (flow.durationMs === undefined) return <span className="text-subtle">--</span>;

  const statusCode = flow.response
    ? applyModification(flow.response, flow.modification).statusCode
    : 0;
  let tone = 'text-muted';
  if (statusCode >= 400) tone = 'text-error';
  else if (flow.durationMs < 50) tone = 'text-success';
  return <span className={tone}>{formatDuration(flow.durationMs)}</span>;
}

const FlowRow = memo(function FlowRow({
  flow,
  selected,
  now,
  onSelect,
}: {
  flow: Flow;
  selected: boolean;
  now: number;
  onSelect: (key: string) => void;
}) {
  const method = flowMethod(flow);
  const { path, host } = splitUrl(flowUrl(flow));
  const paused = flow.state === 'paused';
  const statusCode = flow.response
    ? applyModification(flow.response, flow.modification).statusCode
    : 0;
  const classes = [
    'flow-row',
    selected && 'flow-row--selected',
    paused && 'flow-row--paused',
    statusCode >= 400 && 'flow-row--error',
  ]
    .filter(Boolean)
    .join(' ');

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(flow.key);
    }
  };

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={classes}
      onClick={() => onSelect(flow.key)}
      onKeyDown={onKeyDown}
    >
      <div className="flow-grid flow-row__grid">
        <div className="flow-grid__method">
          <span className={`method-badge method-badge--${methodTone(method)}`}>
            {methodLabel(method)}
          </span>
        </div>
        <div className="flow-grid__status">
          <StatusCell flow={flow} />
        </div>
        <div className="flow-grid__path">
          <div className="flow-row__path-line">
            <span className="flow-row__path" title={path}>
              {path}
            </span>
            {flow.modification && <span className="mutated-tag">MUTATED</span>}
          </div>
          <span className="flow-row__host">{host}</span>
        </div>
        <div className="flow-grid__time">
          <TimeCell flow={flow} now={now} />
        </div>
        <div className="flow-grid__size">
          {flow.size === undefined ? (
            <span className="text-subtle">--</span>
          ) : (
            <span className={flow.size < 1024 ? 'text-subtle' : 'text-muted'}>
              {formatSize(flow.size)}
            </span>
          )}
        </div>
      </div>
      {paused && (
        <div className="breakpoint-strip">
          <span className="breakpoint-strip__label">
            <img src={breakpointIcon} alt="" />
            Breakpoint hit • Awaiting forward action
          </span>
          <span className="text-subtle">#{flow.seq}</span>
        </div>
      )}
    </div>
  );
});

export default function FlowList({
  flows,
  totalCount,
  selectedKey,
  now,
  connected,
  serverUrl,
  filter,
  onSelect,
}: FlowListProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = flows.findIndex((flow) => flow.key === selectedKey);
    const next =
      event.key === 'ArrowDown'
        ? Math.min(flows.length - 1, index + 1)
        : Math.max(0, index - 1);
    const flow = flows[next];
    if (!flow) return;
    onSelect(flow.key);
    event.currentTarget.children[next]?.scrollIntoView?.({ block: 'nearest' });
  };

  let empty: string | null = null;
  if (totalCount === 0) {
    empty = connected
      ? 'Device connected. Waiting for the first request…'
      : `Waiting for a device. Initialize Tracer with ${serverUrl}`;
  } else if (flows.length === 0) {
    empty = `No requests match “${filter}”`;
  }

  return (
    <section className="flow-list" aria-label="Captured requests">
      <div className="flow-grid flow-list__columns">
        <span className="flow-grid__method">METHOD</span>
        <span className="flow-grid__status">STATUS</span>
        <span className="flow-grid__path">PATH / HOST</span>
        <span className="flow-grid__time">TIME</span>
        <span className="flow-grid__size">SIZE</span>
      </div>
      <div
        className="flow-list__rows"
        role="listbox"
        aria-label="Requests"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {flows.map((flow) => (
          <FlowRow
            key={flow.key}
            flow={flow}
            selected={flow.key === selectedKey}
            // Only held rows show a live timer, so only they need the clock.
            now={flow.state === 'paused' ? now : 0}
            onSelect={onSelect}
          />
        ))}
        {empty && <p className="flow-list__empty">{empty}</p>}
      </div>
      <footer className="flow-list__footer">
        <span>
          Showing {flows.length}
          {flows.length !== totalCount && ` of ${totalCount}`}{' '}
          {totalCount === 1 ? 'request' : 'requests'}
        </span>
        <span
          className={`flow-list__stream ${connected ? 'text-success' : 'text-subtle'}`}
        >
          <span className="dot dot--small" />
          {connected ? 'Stream Active' : 'No Device'}
        </span>
      </footer>
    </section>
  );
}
