import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, X } from 'lucide-react';
import { api } from '../api';
import { eventToAccelerator, formatAccelerator } from '../hotkeys';
import { useStore } from '../store';

export function Kbd({ accel, dim }: { accel: string | null | undefined; dim?: boolean }) {
  const parts = formatAccelerator(accel);
  if (!parts.length) return null;
  return (
    <span className={`kbd-group${dim ? ' dim' : ''}`}>
      {parts.map((p, i) => (
        <kbd key={i}>{p}</kbd>
      ))}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="slider-value">{format(value)}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Click to record a global hotkey. Esc cancels, Backspace clears. */
export function HotkeyInput({
  value,
  onChange,
  conflict,
}: {
  value: string | null;
  onChange(v: string | null): void;
  conflict?: string | null;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const setRecordingHotkey = useStore((s) => s.setRecordingHotkey);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!recording) return;
    const onChange = (v: string | null) => onChangeRef.current(v);
    setRecordingHotkey(true);
    api.suspendHotkeys(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'keyup') {
        if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) setPreview('');
        return;
      }
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      if ((e.code === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        onChange(null);
        setRecording(false);
        return;
      }
      const accel = eventToAccelerator(e);
      if (accel) {
        onChange(accel);
        setRecording(false);
      } else {
        const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win']
          .filter(Boolean)
          .join(' + ');
        setPreview(mods);
      }
    };
    const onBlur = () => setRecording(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
      setPreview('');
      setRecordingHotkey(false);
      api.suspendHotkeys(false);
    };
  }, [recording, setRecordingHotkey]);

  return (
    <div className="hotkey-input-wrap">
      <button
        type="button"
        className={`hotkey-input${recording ? ' recording' : ''}${conflict ? ' conflict' : ''}`}
        onClick={() => setRecording((r) => !r)}
      >
        <Keyboard size={15} />
        {recording ? (
          <span className="hotkey-placeholder">{preview ? `${preview} + …` : 'Press a key combination…'}</span>
        ) : value ? (
          <Kbd accel={value} />
        ) : (
          <span className="hotkey-placeholder">Click to set a shortcut</span>
        )}
      </button>
      {value && !recording && (
        <button type="button" className="icon-btn subtle" aria-label="Clear shortcut" onClick={() => onChange(null)}>
          <X size={15} />
        </button>
      )}
      {conflict && <div className="field-hint warn">{conflict}</div>}
      {recording && <div className="field-hint">Esc to cancel · Backspace to clear</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: ReactNode;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const recording = useStore((s) => s.recordingHotkey);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !recording) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, recording]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn subtle" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function formatDuration(sec?: number) {
  if (sec === undefined || !isFinite(sec)) return '–:––';
  const s = Math.max(0, sec);
  if (s < 10) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}
