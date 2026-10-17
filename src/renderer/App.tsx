import { useCallback, useEffect, useMemo, useState } from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { DEFAULT_TRACER_PORT, ModifiedResponse } from '../shared/tracer';
import TopBar from './components/TopBar';
import FlowList, { flowMethod, flowUrl } from './components/FlowList';
import Inspector, { EmptyInspector } from './components/Inspector';
import StatusBar from './components/StatusBar';
import type { ResponseDraft } from './lib/draft';
import type { Flow } from './state/flows';
import useTracer from './state/useTracer';
import './App.css';

function headerText(headers: Record<string, unknown> | undefined) {
  return Object.entries(headers ?? {}).map(
    ([key, value]) => `${key}: ${String(value)}`,
  );
}

function matches(flow: Flow, query: string) {
  const fields = [
    flowMethod(flow),
    flowUrl(flow),
    flow.response ? String(flow.response.statusCode) : '',
    ...headerText(flow.request?.headers),
    ...headerText(flow.response?.headers),
  ];
  return fields.some((field) => field.toLowerCase().includes(query));
}

/** Ticks while any response is held, for the "1.4s held" timers. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function exportFlows(flows: Flow[]) {
  const data = flows.map((flow) => ({
    id: flow.id,
    device: flow.clientId,
    state: flow.state,
    request: flow.request ?? null,
    response: flow.response ?? null,
    modification: flow.modification ?? null,
  }));
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `tracer-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Interceptor() {
  const {
    status,
    flows,
    selectedKey,
    setInterception,
    listen,
    forward,
    select,
    clear,
  } = useTracer();
  const [filter, setFilter] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ResponseDraft>>({});

  const paused = useMemo(
    () => flows.filter((flow) => flow.state === 'paused'),
    [flows],
  );
  const now = useNow(paused.length > 0);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? flows.filter((flow) => matches(flow, query)) : flows;
  }, [flows, filter]);

  const selected = flows.find((flow) => flow.key === selectedKey) ?? null;
  const port = status?.port ?? DEFAULT_TRACER_PORT;
  const serverUrls = (
    status?.addresses.length ? status.addresses : ['127.0.0.1']
  ).map((address) => `ws://${address}:${port}`);

  const dropDraft = (key: string) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  const onForward = useCallback(
    (flow: Flow, modification: ModifiedResponse) => {
      void forward(flow, modification);
      dropDraft(flow.key);
    },
    [forward],
  );

  const onResumeAll = () =>
    paused.forEach((flow) => onForward(flow, { id: flow.id }));

  const onDraftChange = useCallback((key: string, draft: ResponseDraft) => {
    setDrafts((current) => ({ ...current, [key]: draft }));
  }, []);

  const stats = useMemo(
    () => ({
      transferred: flows.reduce((total, flow) => total + (flow.size ?? 0), 0),
      modified: flows.filter((flow) => flow.modification).length,
    }),
    [flows],
  );

  return (
    <div className="app">
      <TopBar
        status={status}
        pausedCount={paused.length}
        filter={filter}
        onFilterChange={setFilter}
        onInterceptionChange={setInterception}
        onShowPaused={() => paused[0] && select(paused[0].key)}
        onListen={listen}
        onClear={clear}
        onExport={() => exportFlows(flows)}
      />
      <main className="workspace">
        <FlowList
          flows={visible}
          totalCount={flows.length}
          selectedKey={selectedKey}
          now={now}
          connected={(status?.clients.length ?? 0) > 0}
          serverUrl={serverUrls[0]}
          filter={filter.trim()}
          onSelect={select}
        />
        {selected ? (
          <Inspector
            key={`${selected.key}-${selected.response ? 'response' : 'request'}`}
            flow={selected}
            draft={drafts[selected.key]}
            clientAddress={
              status?.clients.find((client) => client.id === selected.clientId)
                ?.address
            }
            pausedCount={paused.length}
            onDraftChange={onDraftChange}
            onForward={onForward}
            onResumeAll={onResumeAll}
          />
        ) : (
          <EmptyInspector serverUrls={serverUrls} />
        )}
      </main>
      <StatusBar
        status={status}
        total={flows.length}
        held={paused.length}
        transferred={stats.transferred}
        modified={stats.modified}
      />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Interceptor />} />
      </Routes>
    </Router>
  );
}
