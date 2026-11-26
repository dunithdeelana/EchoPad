import { useState } from 'react';
import { Check, Play, Square, Trash2 } from 'lucide-react';
import { engine } from '../audio';
import { isRiskyBareKey } from '../hotkeys';
import { PALETTE, useStore } from '../store';
import { formatDuration, HotkeyInput, Modal, Slider } from './controls';

export function EditDialog({ id }: { id: string }) {
  const sound = useStore((s) => s.sounds.find((x) => x.id === id));
  const sounds = useStore((s) => s.sounds);
  const stopAllHotkey = useStore((s) => s.settings.stopAllHotkey);
  const failedHotkeys = useStore((s) => s.failedHotkeys);
  const updateSound = useStore((s) => s.updateSound);
  const removeSound = useStore((s) => s.removeSound);
  const playSound = useStore((s) => s.playSound);
  const setEditing = useStore((s) => s.setEditing);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(sound?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  if (!sound) return null;
  const close = () => {
    if (name.trim() && name.trim() !== sound.name) updateSound(id, { name: name.trim() });
    setEditing(null);
  };

  let conflict: string | null = null;
  if (sound.hotkey) {
    const other = sounds.find((s) => s.id !== id && s.hotkey === sound.hotkey);
    if (other) conflict = `Also assigned to “${other.name}”.`;
    else if (sound.hotkey === stopAllHotkey) conflict = 'This is your “Stop all sounds” shortcut.';
    else if (failedHotkeys.includes(sound.hotkey))
      conflict = 'Another app has already claimed this shortcut. Try a different one.';
    else if (isRiskyBareKey(sound.hotkey))
      conflict = 'Without a modifier this key will be blocked in every app while Echopad runs.';
  }

  const preview = () => {
    if (engine.isPlaying(id)) {
      engine.stop(id);
      setPreviewing(false);
      return;
    }
    playSound(id);
    setPreviewing(true);
    const unsub = engine.subscribe(() => {
      if (!engine.isPlaying(id)) {
        setPreviewing(false);
        unsub();
      }
    });
  };

  return (
    <Modal
      title="Edit sound"
      onClose={close}
      footer={
        <>
          <button
            className={`btn ghost danger${confirmDelete ? ' confirm' : ''}`}
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              removeSound(id);
              toast('info', `Deleted “${sound.name}”.`);
              setEditing(null);
            }}
          >
            <Trash2 size={15} /> {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
          <div className="spacer" />
          <button className="btn primary" onClick={close}>
            <Check size={15} /> Done
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="sound-name">Name</label>
        <input
          id="sound-name"
          className="input"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && close()}
        />
      </div>

      <div className="field">
        <label>Global shortcut</label>
        <HotkeyInput value={sound.hotkey} onChange={(v) => updateSound(id, { hotkey: v })} conflict={conflict} />
        <div className="field-hint">Works everywhere — even while Discord or a game is focused.</div>
      </div>

      <div className="field">
        <label>Volume</label>
        <div className="row">
          <Slider value={sound.volume} max={1.5} onChange={(v) => updateSound(id, { volume: v })} label="Volume" />
          <button className="btn secondary icon-only" aria-label="Preview" onClick={preview}>
            {previewing ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
        </div>
      </div>

      <div className="field">
        <label>Color</label>
        <div className="swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch${sound.color === c ? ' active' : ''}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              onClick={() => updateSound(id, { color: c })}
            />
          ))}
        </div>
      </div>

      <div className="meta-row">
        <span>Length {formatDuration(sound.duration)}</span>
        <span>Played {sound.plays ?? 0}×</span>
        <span>Added {new Date(sound.addedAt).toLocaleDateString()}</span>
      </div>
    </Modal>
  );
}
