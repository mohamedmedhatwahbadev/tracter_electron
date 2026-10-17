import { useEffect, useState } from 'react';
import type { ServerStatus } from '../../shared/tracer';
import { formatBytes } from '../lib/format';
import heldIcon from '../assets/icons/held.svg';
import proxyIcon from '../assets/icons/proxy-active.svg';
import memoryIcon from '../assets/icons/memory.svg';
import './StatusBar.css';

interface StatusBarProps {
  status: ServerStatus | null;
  total: number;
  held: number;
  transferred: number;
  modified: number;
}

function useMemoryUsage() {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    const tracer = window.electron?.tracer;
    if (!tracer) return undefined;
    const read = () => {
      tracer.memoryUsage().then(setBytes).catch(() => {});
    };
    read();
    const timer = setInterval(read, 3000);
    return () => clearInterval(timer);
  }, []);
  return bytes;
}

export default function StatusBar({
  status,
  total,
  held,
  transferred,
  modified,
}: StatusBarProps) {
  const memory = useMemoryUsage();
  const listening = status?.listening ?? false;

  let state = { label: 'STARTING', className: 'text-subtle' };
  if (status?.error) state = { label: 'ERROR', className: 'text-error' };
  else if (listening) state = { label: 'READY', className: 'text-success' };

  return (
    <footer className="status-bar">
      <div className="status-bar__group">
        <span className="status-bar__item">
          <span className="dot text-success" />
          <span className="status-bar__value">{total}</span>
          <span className="text-subtle">total captured requests</span>
        </span>
        <span className="status-bar__divider" />
        <span className="status-bar__item text-warning">
          <img src={heldIcon} alt="" />
          <span className="strong">{held}</span>
          <span>held at breakpoint</span>
        </span>
        <span className="status-bar__divider" />
        <span className="status-bar__item">
          <span className="status-bar__value">{formatBytes(transferred)}</span>
          <span className="text-subtle">transferred</span>
        </span>
        <span className="status-bar__divider" />
        <span className="status-bar__item">
          <span className="status-bar__value">{modified}</span>
          <span className="text-subtle">modified</span>
        </span>
      </div>
      <div className="status-bar__group">
        <span className="status-bar__meta" title={status?.error ?? undefined}>
          <img src={proxyIcon} alt="" />
          {listening
            ? `Server Active (${status?.port})`
            : `Server Offline (${status?.port ?? '—'})`}
        </span>
        {memory !== null && (
          <span className="status-bar__meta">
            <img src={memoryIcon} alt="" />
            Mem: {formatBytes(memory)}
          </span>
        )}
        <span className={`strong ${state.className}`}>{state.label}</span>
      </div>
    </footer>
  );
}
