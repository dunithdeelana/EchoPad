import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Copy,
  Info,
  LayoutGrid,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Star,
  X,
  XCircle,
} from 'lucide-react';
import { api, isElectron } from '../api';
import { engine } from '../audio';
import { useStore, type SortMode, type View } from '../store';
import { type Devices } from '../useDevices';
import { Kbd } from './controls';
import { overallStatus, useAllChecks } from './HealthView';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b6cff" />
          <stop offset="1" stopColor="#e0459b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#lg)" />
      <g fill="#fff">
        <rect x="13" y="24" width="6" height="16" rx="3" opacity=".85" />
        <rect x="23" y="16" width="6" height="32" rx="3" />
        <rect x="33" y="21" width="6" height="22" rx="3" opacity=".95" />
        <rect x="43" y="27" width="6" height="10" rx="3" opacity=".8" />
      </g>
    </svg>
  );
}

export function TitleBar() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    api.isMaximized().then(setMax);
    return api.onMaximized(setMax);
  }, []);
  return (
    <div className="titlebar" onDoubleClick={() => api.toggleMaximize()}>
      <div className="titlebar-brand">
        <Logo size={18} />
        <span>Echopad</span>
      </div>
      {isElectron && (
        <div className="titlebar-controls" onDoubleClick={(e) => e.stopPropagation()}>
          <button aria-label="Minimize" onClick={() => api.minimize()}>
            <Minus size={16} />
          </button>
          <button aria-label={max ? 'Restore' : 'Maximize'} onClick={() => api.toggleMaximize()}>
            {max ? <Copy size={13} style={{ transform: 'scaleX(-1)' }} /> : <Square size={13} />}
          </button>
          <button className="close" aria-label="Close" onClick={() => api.close()}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ devices }: { devices: Devices }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const count = useStore((s) => s.sounds.length);
  const favs = useStore((s) => s.sounds.filter((x) => x.favorite).length);
  const health = useStore((s) => s.health);
  const checks = useAllChecks();
  const overall = overallStatus(health, checks);
  void devices;

  const nav = (v: View, icon: React.ReactNode, label: string, badge?: number) => (
    <button className={`nav-item${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
      {icon}
      <span>{label}</span>
      {badge !== undefined && <span className="nav-badge">{badge}</span>}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="nav-group">
        <div className="nav-heading">Library</div>
        {nav('all', <LayoutGrid size={17} />, 'All sounds', count)}
        {nav('favorites', <Star size={17} />, 'Favorites', favs)}
      </div>
      <div className="nav-group">
        <div className="nav-heading">Setup</div>
        {nav('settings', <SlidersHorizontal size={17} />, 'Audio setup')}
        {nav('health', <ShieldCheck size={17} />, 'Health')}
      </div>
      <div className="sidebar-spacer" />
      <button className={`route-card ${overall.tone}`} onClick={() => setView('health')}>
        <div className="route-title">
          <span className="route-dot" />
          {overall.text}
        </div>
        <div className="route-sub">
          {overall.tone === 'ok'
            ? 'Join a voice channel and press a shortcut.'
            : overall.tone === 'busy'
              ? health?.phaseMessage || 'Echopad is configuring your PC.'
              : 'Click to see what Echopad needs.'}
        </div>
      </button>
    </aside>
  );
}

const SORTS: { value: SortMode; label: string }[] = [
  { value: 'manual', label: 'Custom order' },
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Recently added' },
  { value: 'plays', label: 'Most played' },
];

export function Toolbar({ onAdd }: { onAdd(): void }) {
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const stopAllHotkey = useStore((s) => s.settings.stopAllHotkey);
  const anyPlaying = useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.playingIds().size > 0,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const titles: Record<View, [string, string]> = {
    all: ['All sounds', 'Click a pad or press its shortcut to play it in your call.'],
    favorites: ['Favorites', 'Your starred sounds.'],
    settings: ['Audio setup', 'Choose where sounds go and how your mic is mixed in.'],
    health: ['Health', 'Echopad sets up Windows and Discord audio for you and keeps it working.'],
  };
  const [title, sub] = titles[view];
  const library = view === 'all' || view === 'favorites';

  return (
    <div className="toolbar">
      <div className="toolbar-title">
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {library && (
        <div className="toolbar-actions">
          <div className="search">
            <Search size={15} />
            <input
              ref={searchRef}
              placeholder="Search sounds"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            {query ? (
              <button className="icon-btn subtle xs" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            ) : (
              <kbd className="search-kbd">Ctrl F</kbd>
            )}
          </div>
          <label className="sort">
            <ArrowUpDown size={14} />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} aria-label="Sort">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn secondary"
            disabled={!anyPlaying}
            onClick={() => engine.stopAll()}
            title={stopAllHotkey ? `Stop all (${stopAllHotkey})` : 'Stop all'}
          >
            <Square size={13} fill="currentColor" /> Stop all
          </button>
          <button className="btn primary" onClick={onAdd}>
            <Plus size={16} /> Add sounds
          </button>
        </div>
      )}
    </div>
  );
}

function MiniMeter({ source, label }: { source: 'mic' | 'output'; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      if (!document.hidden) {
        const v = source === 'mic' ? engine.micLevel() : engine.outputLevel();
        smooth = Math.max(v, smooth * 0.88);
        ref.current?.style.setProperty('--level', String(smooth));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [source]);
  return (
    <div className="mini-meter" title={label}>
      <span>{label}</span>
      <div className="meter sm" ref={ref}>
        <div className="meter-fill" />
      </div>
    </div>
  );
}

export function StatusBar() {
  const settings = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const sounds = useStore((s) => s.sounds);
  const playingNames = useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => [...engine.playingIds()].join('|'),
  );
  const [micActive, setMicActive] = useState(engine.status.micActive);
  useEffect(() => engine.subscribe(() => setMicActive(engine.status.micActive)), []);

  const playing = playingNames
    ? playingNames
        .split('|')
        .map((id) => sounds.find((s) => s.id === id)?.name)
        .filter(Boolean)
    : [];

  return (
    <footer className="statusbar">
      <div className="status-left">
        <MiniMeter source="output" label="To call" />
        {micActive && <MiniMeter source="mic" label="Your voice" />}
        {settings.micPassthrough && !micActive && settings.outputDeviceId && (
          <button className="status-item warn link" onClick={() => setView('settings')}>
            <AlertTriangle size={13} /> Your voice isn't reaching the call. Fix it
          </button>
        )}
        {!settings.micPassthrough && settings.outputDeviceId && (
          <button className="status-item warn link" onClick={() => setView('settings')}>
            <AlertTriangle size={13} /> Mic passthrough is off. Friends can't hear you
          </button>
        )}
      </div>
      <div className="status-center">
        {playing.length > 0 && (
          <span className="status-item playing">
            <span className="eq sm">
              <i />
              <i />
              <i />
            </span>
            {playing.length === 1 ? playing[0] : `${playing.length} sounds playing`}
          </span>
        )}
      </div>
      <div className="status-right">
        {settings.stopAllHotkey && (
          <span className="status-item">
            Stop all <Kbd accel={settings.stopAllHotkey} dim />
          </span>
        )}
      </div>
    </footer>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'success' ? (
            <CheckCircle2 size={16} />
          ) : t.kind === 'error' ? (
            <XCircle size={16} />
          ) : (
            <Info size={16} />
          )}
          <span>{t.text}</span>
          <button className="icon-btn subtle xs" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
