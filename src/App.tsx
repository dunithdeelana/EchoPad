import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from './api';
import { engine } from './audio';
import { useStore } from './store';
import type { ImportResult } from './types';
import { isVirtualCable, resolveDevice, useDevices } from './useDevices';
import { Logo, Sidebar, StatusBar, TitleBar, Toasts, Toolbar } from './components/Chrome';
import { SoundGrid } from './components/SoundGrid';
import { EditDialog } from './components/EditDialog';
import { SettingsView } from './components/SettingsView';
import { GuideView, SetupSteps } from './components/GuideView';
import { Modal } from './components/controls';

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const sounds = useStore((s) => s.sounds);
  const settings = useStore((s) => s.settings);
  const editingId = useStore((s) => s.editingId);
  const recording = useStore((s) => s.recordingHotkey);
  const { init, addImported, toast, updateSettings, setFailedHotkeys } = useStore.getState();
  const devices = useDevices();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    init();
  }, [init]);

  // ------------------------------------------------------------------ device resolution
  const resolved = useMemo(() => {
    const out = resolveDevice(devices.outputs, settings.outputDeviceId, settings.outputDeviceLabel);
    const mon = resolveDevice(devices.outputs, settings.monitorDeviceId, settings.monitorDeviceLabel);
    const mic = resolveDevice(devices.inputs, settings.micDeviceId, settings.micDeviceLabel);
    return { out, mon, mic };
  }, [devices.outputs, devices.inputs, settings]);

  // Keep stored ids fresh when a device was re-matched by label.
  useEffect(() => {
    if (!ready || !devices.loaded) return;
    const patch: Record<string, string> = {};
    const { out, mon, mic } = resolved;
    if (out && out.deviceId !== settings.outputDeviceId) patch.outputDeviceId = out.deviceId;
    if (mon && mon.deviceId !== settings.monitorDeviceId) patch.monitorDeviceId = mon.deviceId;
    if (mic && mic.deviceId !== settings.micDeviceId) patch.micDeviceId = mic.deviceId;
    if (Object.keys(patch).length) updateSettings(patch);
  }, [resolved, ready, devices.loaded, settings, updateSettings]);

  // First run: auto-pick a virtual cable if one is installed.
  useEffect(() => {
    if (!ready || !devices.loaded || settings.onboarded || settings.outputDeviceId) return;
    const cable = devices.outputs.find((d) => isVirtualCable(d.label));
    if (cable) updateSettings({ outputDeviceId: cable.deviceId, outputDeviceLabel: cable.label });
  }, [ready, devices.loaded, devices.outputs, settings.onboarded, settings.outputDeviceId, updateSettings]);

  // ------------------------------------------------------------------ audio routing
  useEffect(() => {
    if (!ready || !devices.loaded) return;
    const outId = resolved.out?.deviceId ?? '';
    const cableSet = !!outId;
    const monId = resolved.mon?.deviceId ?? settings.monitorDeviceId ?? '';
    engine.configure({
      // Without a cable, sounds simply play on the monitor device.
      outputSinkId: cableSet ? outId : settings.monitorEnabled ? monId : '',
      outputVolume: cableSet ? settings.outputVolume : settings.monitorVolume,
      monitorActive: cableSet && settings.monitorEnabled && monId !== outId,
      monitorSinkId: monId,
      monitorVolume: settings.monitorVolume,
    });
    engine.setMic(
      settings.micPassthrough && cableSet,
      resolved.mic?.deviceId ?? settings.micDeviceId,
      settings.micVolume,
    );
  }, [ready, devices.loaded, resolved, settings]);

  // Pre-decode sounds so the first trigger is instant.
  useEffect(() => {
    if (!ready) return;
    sounds.forEach((s) =>
      engine
        .load(s)
        .then((buf) => {
          if (s.duration === undefined) useStore.getState().updateSound(s.id, { duration: buf.duration });
        })
        .catch(() => {}),
    );
    // only on startup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ------------------------------------------------------------------ global hotkeys
  const hotkeySignature = useMemo(
    () => JSON.stringify([settings.stopAllHotkey, sounds.map((s) => [s.id, s.hotkey])]),
    [sounds, settings.stopAllHotkey],
  );
  useEffect(() => {
    if (!ready || recording) return;
    const map: Record<string, string> = {};
    if (settings.stopAllHotkey) map[settings.stopAllHotkey] = 'stop-all';
    for (const s of sounds) if (s.hotkey && !map[s.hotkey]) map[s.hotkey] = `sound:${s.id}`;
    api.setHotkeys(map).then(setFailedHotkeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hotkeySignature, recording]);

  useEffect(() => {
    const offHotkey = api.onHotkey((action) => {
      if (action === 'stop-all') engine.stopAll();
      else if (action.startsWith('sound:')) useStore.getState().playSound(action.slice(6));
    });
    const offStop = api.onStopAll(() => engine.stopAll());
    return () => {
      offHotkey();
      offStop();
    };
  }, []);

  // ------------------------------------------------------------------ importing
  const handleImport = useCallback(
    (res: ImportResult) => {
      if (res.imported.length) {
        addImported(res.imported);
        toast(
          'success',
          res.imported.length === 1 ? `Added “${res.imported[0].name}”.` : `Added ${res.imported.length} sounds.`,
        );
        const v = useStore.getState().view;
        if (v !== 'all' && v !== 'favorites') useStore.getState().setView('all');
      }
      if (res.skipped.length) {
        toast('error', `Skipped ${res.skipped.length} unsupported or too-large file${res.skipped.length > 1 ? 's' : ''}.`);
      }
    },
    [addImported, toast],
  );

  const pick = useCallback(() => api.pickSounds().then(handleImport), [handleImport]);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) api.importFiles(e.dataTransfer.files).then(handleImport);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [handleImport]);

  if (!ready) return <div className="app loading" />;

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <Sidebar devices={devices} />
        <main className="main">
          <Toolbar onAdd={pick} />
          <div className="content">
            {(view === 'all' || view === 'favorites') && <SoundGrid onAdd={pick} />}
            {view === 'settings' && <SettingsView devices={devices} />}
            {view === 'guide' && <GuideView devices={devices} />}
          </div>
        </main>
      </div>
      <StatusBar />

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-box">
            <Upload size={34} />
            <h2>Drop to add sounds</h2>
            <p>MP3, WAV, OGG, M4A, FLAC, OPUS or WEBM</p>
          </div>
        </div>
      )}
      {editingId && <EditDialog key={editingId} id={editingId} />}
      {!settings.onboarded && (
        <Modal
          width={620}
          title={
            <span className="welcome-title">
              <Logo size={26} /> Welcome to Echopad
            </span>
          }
          onClose={() => updateSettings({ onboarded: true })}
          footer={
            <>
              <span className="footer-note">You can reopen this anytime from Discord guide.</span>
              <div className="spacer" />
              <button className="btn primary" onClick={() => updateSettings({ onboarded: true })}>
                Get started
              </button>
            </>
          }
        >
          <p className="lead">
            Play sounds straight into Discord with global shortcuts. Here's the one-time setup:
          </p>
          <SetupSteps devices={devices} compact />
        </Modal>
      )}
      <Toasts />
    </div>
  );
}
