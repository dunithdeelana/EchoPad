import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Download,
  FolderOpen,
  Keyboard,
  MoreHorizontal,
  Music2,
  Pencil,
  Play,
  Square,
  Star,
  Trash2,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api';
import { engine } from '../audio';
import { useStore } from '../store';
import type { Sound } from '../types';
import { formatDuration, Kbd } from './controls';

function usePlayingIds() {
  const ref = useRef<{ key: string; set: Set<string> }>({ key: '', set: new Set() });
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => {
      const ids = engine.playingIds();
      const key = [...ids].sort().join('|');
      if (key !== ref.current.key) ref.current = { key, set: ids };
      return ref.current.set;
    },
  );
}

export function SoundGrid({ onAdd }: { onAdd(): void }) {
  const sounds = useStore((s) => s.sounds);
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const sort = useStore((s) => s.sort);
  const playing = usePlayingIds();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = sounds.filter(
      (s) =>
        (view !== 'favorites' || s.favorite) &&
        (!q || s.name.toLowerCase().includes(q) || (s.hotkey ?? '').toLowerCase().includes(q)),
    );
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'recent') list = [...list].sort((a, b) => b.addedAt - a.addedAt);
    if (sort === 'plays') list = [...list].sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0));
    return list;
  }, [sounds, view, query, sort]);

  const hotkeyCounts = useMemo(() => {
    const m = new Map<string, number>();
    sounds.forEach((s) => s.hotkey && m.set(s.hotkey, (m.get(s.hotkey) ?? 0) + 1));
    return m;
  }, [sounds]);

  if (!sounds.length) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <Music2 size={30} />
        </div>
        <h2>Your soundboard is empty</h2>
        <p>Drag and drop audio files anywhere in this window, or add them from your computer.</p>
        <button className="btn primary lg" onClick={onAdd}>
          <Upload size={16} /> Add sounds
        </button>
        <span className="empty-formats">MP3 · WAV · OGG · M4A · FLAC · OPUS · WEBM</span>
      </div>
    );
  }

  if (!visible.length) {
    return (
      <div className="empty small">
        <h2>{view === 'favorites' && !query ? 'No favorites yet' : 'No matching sounds'}</h2>
        <p>
          {view === 'favorites' && !query
            ? 'Star a sound to pin it here.'
            : 'Try a different search term.'}
        </p>
      </div>
    );
  }

  const draggable = sort === 'manual' && !query;

  return (
    <div className="grid">
      {visible.map((s) => (
        <SoundCard
          key={s.id}
          sound={s}
          playing={playing.has(s.id)}
          draggable={draggable}
          duplicateHotkey={!!s.hotkey && (hotkeyCounts.get(s.hotkey) ?? 0) > 1}
        />
      ))}
    </div>
  );
}

const SoundCard = memo(function SoundCard({
  sound,
  playing,
  draggable,
  duplicateHotkey,
}: {
  sound: Sound;
  playing: boolean;
  draggable: boolean;
  duplicateHotkey: boolean;
}) {
  const playSound = useStore((s) => s.playSound);
  const updateSound = useStore((s) => s.updateSound);
  const setEditing = useStore((s) => s.setEditing);
  const moveSound = useStore((s) => s.moveSound);
  const failed = useStore((s) => !!sound.hotkey && s.failedHotkeys.includes(sound.hotkey));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Drive the progress bar without re-rendering React every frame.
  useEffect(() => {
    if (!playing) {
      cardRef.current?.style.setProperty('--progress', '0');
      return;
    }
    let raf = 0;
    const tick = () => {
      const p = engine.progress(sound.id);
      cardRef.current?.style.setProperty('--progress', String(p ?? 0));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing, sound.id]);

  const hotkeyWarning = duplicateHotkey
    ? 'This shortcut is used by another sound'
    : failed
      ? 'Shortcut is taken by another app'
      : null;

  return (
    <>
      <div
        ref={cardRef}
        className={`card${playing ? ' playing' : ''}${dragOver ? ' drag-over' : ''}`}
        style={{ ['--accent' as string]: sound.color }}
        role="button"
        tabIndex={0}
        aria-label={`Play ${sound.name}`}
        onClick={() => playSound(sound.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            playSound(sound.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-echopad-sound', sound.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-echopad-sound')) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('application/x-echopad-sound');
          setDragOver(false);
          if (id) {
            e.preventDefault();
            e.stopPropagation();
            moveSound(id, sound.id);
          }
        }}
      >
        <div className="card-progress" />
        <div className="card-top">
          <span className="card-badge">
            {playing ? (
              <span className="eq">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <Play size={14} fill="currentColor" />
            )}
          </span>
          <div className="card-actions">
            <button
              className={`icon-btn subtle star${sound.favorite ? ' on' : ''}`}
              aria-label={sound.favorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={(e) => {
                e.stopPropagation();
                updateSound(sound.id, { favorite: !sound.favorite });
              }}
            >
              <Star size={15} fill={sound.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              className="icon-btn subtle"
              aria-label="More actions"
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenu({ x: r.right - 4, y: r.bottom + 4 });
              }}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>
        <div className="card-name" title={sound.name}>
          {sound.name}
        </div>
        <div className="card-bottom">
          <span className="card-duration">{formatDuration(sound.duration)}</span>
          {sound.hotkey ? (
            <span className={`card-hotkey${hotkeyWarning ? ' warn' : ''}`} title={hotkeyWarning ?? 'Global shortcut'}>
              {hotkeyWarning && <AlertTriangle size={12} />}
              <Kbd accel={sound.hotkey} />
            </span>
          ) : (
            <button
              className="card-sethotkey"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(sound.id);
              }}
            >
              <Keyboard size={12} /> Set key
            </button>
          )}
        </div>
      </div>
      {menu && <CardMenu sound={sound} playing={playing} pos={menu} onClose={() => setMenu(null)} />}
    </>
  );
});

function CardMenu({
  sound,
  playing,
  pos,
  onClose,
}: {
  sound: Sound;
  playing: boolean;
  pos: { x: number; y: number };
  onClose(): void;
}) {
  const playSound = useStore((s) => s.playSound);
  const setEditing = useStore((s) => s.setEditing);
  const updateSound = useStore((s) => s.updateSound);
  const removeSound = useStore((s) => s.removeSound);
  const toast = useStore((s) => s.toast);
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ left: pos.x, top: pos.y, opacity: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, pos.x - (pos.x + w > window.innerWidth - 8 ? w : 0)), window.innerWidth - w - 8);
    const top = pos.y + h > window.innerHeight - 8 ? Math.max(8, pos.y - h - 8) : pos.y;
    setStyle({ left, top, opacity: 1 });
  }, [pos]);

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const item = (icon: React.ReactNode, label: string, fn: () => void, danger = false) => (
    <button
      className={`menu-item${danger ? ' danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        fn();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="menu" ref={ref} style={style} onClick={(e) => e.stopPropagation()}>
      {playing
        ? item(<Square size={15} />, 'Stop', () => {
            engine.stop(sound.id);
            onClose();
          })
        : item(<Play size={15} />, 'Play', () => {
            playSound(sound.id);
            onClose();
          })}
      {item(<Pencil size={15} />, 'Edit sound…', () => {
        setEditing(sound.id);
        onClose();
      })}
      {item(<Star size={15} />, sound.favorite ? 'Remove from favorites' : 'Add to favorites', () => {
        updateSound(sound.id, { favorite: !sound.favorite });
        onClose();
      })}
      <div className="menu-sep" />
      {item(<FolderOpen size={15} />, 'Show in folder', () => {
        api.revealSound(sound.file);
        onClose();
      })}
      {item(<Download size={15} />, 'Export…', () => {
        api.exportSound(sound.file, sound.name).then((ok) => ok && toast('success', 'Sound exported.'));
        onClose();
      })}
      <div className="menu-sep" />
      {confirmDelete
        ? item(<Trash2 size={15} />, 'Click again to delete', () => {
            removeSound(sound.id);
            toast('info', `Deleted “${sound.name}”.`);
            onClose();
          }, true)
        : item(<Trash2 size={15} />, 'Delete', () => setConfirmDelete(true), true)}
    </div>
  );
}
