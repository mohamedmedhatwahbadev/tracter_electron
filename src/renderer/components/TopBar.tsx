import { FormEvent, useEffect, useRef, useState } from 'react';
import { DEFAULT_TRACER_PORT, ServerStatus } from '../../shared/tracer';
import logoIcon from '../assets/icons/logo.svg';
import pausedFlowIcon from '../assets/icons/paused-flow.svg';
import searchIcon from '../assets/icons/search.svg';
import './TopBar.css';

interface TopBarProps {
  status: ServerStatus | null;
  pausedCount: number;
  filter: string;
  onFilterChange: (filter: string) => void;
  onInterceptionChange: (enabled: boolean) => void;
  onShowPaused: () => void;
  onListen: (port: number) => void;
  onClear: () => void;
  onExport: () => void;
}

function ServerMenu({
  status,
  onListen,
  onClose,
}: {
  status: ServerStatus | null;
  onListen: (port: number) => void;
  onClose: () => void;
}) {
  const [port, setPort] = useState(String(status?.port ?? DEFAULT_TRACER_PORT));
  const [copied, setCopied] = useState<string | null>(null);
  const addresses = status?.addresses.length
    ? status.addresses
    : ['127.0.0.1'];

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => setCopied(url));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(port);
    if (Number.isInteger(value) && value > 0 && value < 65536) {
      onListen(value);
      onClose();
    }
  };

  return (
    <div className="server-menu" role="dialog" aria-label="Server settings">
      <p className="server-menu__title">Connect the Tracer package to</p>
      <ul className="server-menu__urls">
        {addresses.map((address) => {
          const url = `ws://${address}:${status?.port ?? port}`;
          return (
            <li key={address}>
              <button
                type="button"
                className="server-menu__url"
                onClick={() => copy(url)}
              >
                <span>{url}</span>
                <span className="text-subtle">
                  {copied === url ? 'copied' : 'copy'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {status?.error && (
        <p className="server-menu__error text-error">{status.error}</p>
      )}
      <form className="server-menu__port" onSubmit={submit}>
        <label htmlFor="server-port" className="text-subtle">
          Port
        </label>
        <input
          id="server-port"
          className="field"
          inputMode="numeric"
          value={port}
          onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" className="tool-button">
          Restart
        </button>
      </form>
    </div>
  );
}

export default function TopBar({
  status,
  pausedCount,
  filter,
  onFilterChange,
  onInterceptionChange,
  onShowPaused,
  onListen,
  onClear,
  onExport,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const listening = status?.listening ?? false;
  const interception = status?.interception ?? false;
  const connections = status?.clients.length ?? 0;
  const address = `${status?.addresses[0] ?? '127.0.0.1'}:${
    status?.port ?? DEFAULT_TRACER_PORT
  }`;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <header className="top-bar">
      <div className="top-bar__group">
        <div className="brand">
          <div className="brand__logo">
            <img src={logoIcon} alt="" />
          </div>
          <h1 className="brand__title">HTTP INTERCEPTOR</h1>
          <span className="brand__badge">TRACE</span>
        </div>
        <div className="top-bar__divider" />
        <div className="server-status" ref={menuRef}>
          <button
            type="button"
            className="server-status__pill"
            aria-expanded={menuOpen}
            title={status?.error ?? 'Connection details'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span
              className={`dot ${listening ? 'dot--pulse text-success' : 'text-error'}`}
            />
            <span className="top-bar__label text-muted">
              {listening ? 'LISTENING:' : 'OFFLINE:'}
            </span>
            <span className={`strong ${listening ? 'text-success' : 'text-error'}`}>
              {address}
            </span>
          </button>
          {menuOpen && (
            <ServerMenu
              status={status}
              onListen={onListen}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
        <div className="connections">
          <span className="top-bar__label text-subtle">Active:</span>
          <span className="connections__count">
            {connections} {connections === 1 ? 'Conn' : 'Conns'}
          </span>
        </div>
      </div>

      <div className="top-bar__group top-bar__center">
        <div className="mode-toggle" role="radiogroup" aria-label="Traffic mode">
          <button
            type="button"
            role="radio"
            aria-checked={!interception}
            disabled={!listening}
            className={`mode-toggle__option ${interception ? '' : 'mode-toggle__option--pass'}`}
            onClick={() => onInterceptionChange(false)}
          >
            <span className="dot" />
            Pass-Through
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={interception}
            disabled={!listening}
            className={`mode-toggle__option ${interception ? 'mode-toggle__option--intercept' : ''}`}
            onClick={() => onInterceptionChange(true)}
          >
            <span className="dot" />
            {interception ? 'INTERCEPTION: ON' : 'Intercept'}
          </button>
        </div>
        {pausedCount > 0 && (
          <button type="button" className="paused-chip" onClick={onShowPaused}>
            <img src={pausedFlowIcon} alt="" />
            {pausedCount} Paused {pausedCount === 1 ? 'Flow' : 'Flows'}
          </button>
        )}
      </div>

      <div className="top-bar__group top-bar__right">
        <label className="search">
          <img className="search__icon" src={searchIcon} alt="" />
          <input
            className="search__input"
            type="search"
            placeholder="Filter URL, Method, Header..."
            aria-label="Filter requests"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </label>
        <button type="button" className="tool-button" onClick={onClear}>
          Clear
        </button>
        <button type="button" className="tool-button" onClick={onExport}>
          Export
        </button>
      </div>
    </header>
  );
}
