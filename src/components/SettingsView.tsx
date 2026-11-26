import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Headphones, Mic, Radio, RefreshCw, Volume2, Zap } from 'lucide-react';
import { api, isElectron } from '../api';
import { engine } from '../audio';
import { useStore } from '../store';
import type { Settings } from '../types';
import { cleanLabel, isVirtualCable, pickMic, realMics, resolveDevice, type Devices } from '../useDevices';
import { HotkeyInput, Segmented, Slider, Toggle } from './controls';

function DeviceSelect({
  list,
  id,
  label,
  onChange,
  placeholder,
  highlightCable,
}: {
  list: MediaDeviceInfo[];
  id: string;
  label: string;
  onChange(id: string, label: string): void;
  placeholder?: string;
  highlightCable?: boolean;
}) {
  const resolved = resolveDevice(list, id, label);
  const missing = !!id && !resolved && !!label;
  return (
    <select
      className="select"
      value={resolved?.deviceId ?? (missing ? '__missing' : id || '')}
      onChange={(e) => {
        const d = list.find((x) => x.deviceId === e.target.value);
        onChange(e.target.value, d?.label ?? '');
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {missing && <option value="__missing">{cleanLabel(label)} (disconnected)</option>}
      {list.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.deviceId === 'default'
            ? `System default${d.label ? ` (${cleanLabel(d.label)})` : ''}`
            : cleanLabel(d.label) || `Device ${i + 1}`}
          {highlightCable && isVirtualCable(d.label) ? '  ★ virtual cable' : ''}
        </option>
      ))}
    </select>
  );
}

function Meter({ source }: { source: 'mic' | 'output' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const v = source === 'mic' ? engine.micLevel() : engine.outputLevel();
      smooth = Math.max(v, smooth * 0.9);
      ref.current?.style.setProperty('--level', String(smooth));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [source]);
  return (
    <div className="meter" ref={ref}>
      <div className="meter-fill" />
    </div>
  );
}

export function SettingsView({ devices }: { devices: Devices }) {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const sounds = useStore((s) => s.sounds);
  const failed = useStore((s) => s.failedHotkeys);
  const [status, setStatus] = useState(engine.status);
  const [loginItem, setLoginItem] = useState(false);
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);

  useEffect(() => engine.subscribe(() => setStatus({ ...engine.status })), []);
  useEffect(() => {
    api.getLoginItem().then(setLoginItem);
    api.appInfo().then(setInfo);
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update({ [k]: v } as Partial<Settings>);
  const output = resolveDevice(devices.outputs, settings.outputDeviceId, settings.outputDeviceLabel);
  const cableSelected = !!output && isVirtualCable(output.label);
  const activeMic = pickMic(devices.inputs, settings.micDeviceId, settings.micDeviceLabel);
  const micName = activeMic
    ? activeMic.deviceId === 'default'
      ? cleanLabel(activeMic.label) || 'System default microphone'
      : cleanLabel(activeMic.label)
    : null;
  const stopConflict = settings.stopAllHotkey
    ? sounds.find((s) => s.hotkey === settings.stopAllHotkey)
      ? 'Also assigned to a sound.'
      : failed.includes(settings.stopAllHotkey)
        ? 'Another app has claimed this shortcut.'
        : null
    : null;

  return (
    <div className="settings">
      <section className="panel">
        <header className="panel-header">
          <div className="panel-icon violet">
            <Radio size={18} />
          </div>
          <div>
            <h3>Voice chat output</h3>
            <p>The device Discord uses as its microphone. Pick your virtual cable here (e.g. “CABLE Input”).</p>
          </div>
          <button className="btn ghost sm" onClick={() => devices.refresh()} title="Rescan audio devices">
            <RefreshCw size={14} /> Rescan
          </button>
        </header>
        <div className="setting">
          <div className="setting-label">Output device</div>
          <div className="setting-control">
            <DeviceSelect
              list={devices.outputs.filter((d) => d.deviceId !== 'default')}
              id={settings.outputDeviceId}
              label={settings.outputDeviceLabel}
              placeholder="Not set — sounds play on your speakers only"
              highlightCable
              onChange={(id, label) => update({ outputDeviceId: id, outputDeviceLabel: label })}
            />
            <button className="btn secondary" onClick={() => engine.testTone('output')}>
              <Volume2 size={15} /> Test
            </button>
          </div>
        </div>
        {status.outputError ? (
          <div className="callout warn">
            <AlertTriangle size={16} /> {status.outputError}
          </div>
        ) : settings.outputDeviceId && !cableSelected ? (
          <div className="callout warn">
            <AlertTriangle size={16} />
            This doesn't look like a virtual cable. Friends will only hear sounds if Discord's input is the other end of
            this device.
          </div>
        ) : cableSelected ? (
          <div className="callout ok">
            <CheckCircle2 size={16} /> Routed to {cleanLabel(output!.label)}. In Discord, set Input Device to{' '}
            <b>CABLE Output</b>.
          </div>
        ) : null}
        <div className="setting">
          <div className="setting-label">Sound volume in call</div>
          <div className="setting-control">
            <Slider value={settings.outputVolume} max={1.5} onChange={(v) => set('outputVolume', v)} />
          </div>
        </div>
        <div className="setting">
          <div className="setting-label">What Discord hears</div>
          <div className="setting-control">
            <Meter source="output" />
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <div className="panel-icon green">
            <Mic size={18} />
          </div>
          <div>
            <h3>Microphone passthrough</h3>
            <p>Mixes your real microphone into the cable so your friends hear your voice and the sounds together.</p>
          </div>
          <Toggle checked={settings.micPassthrough} onChange={(v) => set('micPassthrough', v)} label="Mic passthrough" />
        </header>
        <div className={`setting${settings.micPassthrough ? '' : ' disabled'}`}>
          <div className="setting-label">Microphone</div>
          <div className="setting-control">
            <DeviceSelect
              list={realMics(devices.inputs)}
              id={activeMic?.deviceId ?? settings.micDeviceId}
              label={settings.micDeviceLabel}
              onChange={(id, label) => update({ micDeviceId: id, micDeviceLabel: label })}
            />
          </div>
        </div>
        <div className={`setting${settings.micPassthrough ? '' : ' disabled'}`}>
          <div className="setting-label">Mic volume</div>
          <div className="setting-control">
            <Slider value={settings.micVolume} max={2} onChange={(v) => set('micVolume', v)} />
          </div>
        </div>
        <div className={`setting${settings.micPassthrough ? '' : ' disabled'}`}>
          <div className="setting-label">Input level</div>
          <div className="setting-control">
            <Meter source="mic" />
          </div>
        </div>
        {settings.micPassthrough && settings.outputDeviceId && status.micActive && micName && (
          <div className="callout ok">
            <CheckCircle2 size={16} />
            <span>
              Your voice goes to the call from <b>{micName}</b>. Talk and the input level bar above should move.
            </span>
          </div>
        )}
        {settings.micPassthrough && devices.loaded && !activeMic && (
          <div className="callout warn">
            <AlertTriangle size={16} /> No real microphone found. Plug in your headset or mic, then click Rescan.
          </div>
        )}
        {!settings.micPassthrough && settings.outputDeviceId && (
          <div className="callout warn">
            <AlertTriangle size={16} /> Passthrough is off, so your friends will hear the sounds but not your voice.
          </div>
        )}
        {settings.micPassthrough && !settings.outputDeviceId && (
          <div className="callout info">
            Passthrough starts once a virtual cable is selected above, so you don't hear yourself on your speakers.
          </div>
        )}
        {status.micError && (
          <div className="callout warn">
            <AlertTriangle size={16} /> {status.micError}
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-header">
          <div className="panel-icon blue">
            <Headphones size={18} />
          </div>
          <div>
            <h3>Monitor</h3>
            <p>Also play sounds on your own headphones so you hear what your friends hear.</p>
          </div>
          <Toggle checked={settings.monitorEnabled} onChange={(v) => set('monitorEnabled', v)} label="Monitor" />
        </header>
        <div className={`setting${settings.monitorEnabled ? '' : ' disabled'}`}>
          <div className="setting-label">Headphones / speakers</div>
          <div className="setting-control">
            <DeviceSelect
              list={devices.outputs.filter((d) => !isVirtualCable(d.label))}
              id={settings.monitorDeviceId}
              label={settings.monitorDeviceLabel}
              onChange={(id, label) => update({ monitorDeviceId: id, monitorDeviceLabel: label })}
            />
            <button
              className="btn secondary"
              disabled={!settings.monitorEnabled || !settings.outputDeviceId}
              onClick={() => engine.testTone('monitor')}
            >
              <Volume2 size={15} /> Test
            </button>
          </div>
        </div>
        <div className={`setting${settings.monitorEnabled ? '' : ' disabled'}`}>
          <div className="setting-label">Monitor volume</div>
          <div className="setting-control">
            <Slider value={settings.monitorVolume} max={1.5} onChange={(v) => set('monitorVolume', v)} />
          </div>
        </div>
        {status.monitorError && (
          <div className="callout warn">
            <AlertTriangle size={16} /> {status.monitorError}
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-header">
          <div className="panel-icon amber">
            <Zap size={18} />
          </div>
          <div>
            <h3>Playback</h3>
            <p>How sounds behave when triggered.</p>
          </div>
        </header>
        <div className="setting">
          <div className="setting-label">
            Pressing a sound that's already playing
          </div>
          <div className="setting-control">
            <Segmented
              value={settings.retrigger}
              onChange={(v) => set('retrigger', v)}
              options={[
                { value: 'restart', label: 'Restart' },
                { value: 'stop', label: 'Stop' },
                { value: 'overlap', label: 'Play again' },
              ]}
            />
          </div>
        </div>
        <div className="setting">
          <div className="setting-label">
            Play several sounds at once
            <span className="setting-sub">When off, a new sound cuts off the previous one.</span>
          </div>
          <div className="setting-control">
            <Toggle checked={settings.allowSimultaneous} onChange={(v) => set('allowSimultaneous', v)} />
          </div>
        </div>
        <div className="setting">
          <div className="setting-label">Stop all sounds</div>
          <div className="setting-control">
            <HotkeyInput
              value={settings.stopAllHotkey}
              onChange={(v) => set('stopAllHotkey', v)}
              conflict={stopConflict}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <div className="panel-icon slate">
            <FolderOpen size={18} />
          </div>
          <div>
            <h3>Application</h3>
            <p>{info ? `Echopad ${info.version}` : 'Echopad'}</p>
          </div>
        </header>
        <div className="setting">
          <div className="setting-label">
            Launch when Windows starts
            <span className="setting-sub">Starts minimized to the system tray.</span>
          </div>
          <div className="setting-control">
            <Toggle
              checked={loginItem}
              disabled={!isElectron}
              onChange={(v) => api.setLoginItem(v).then(setLoginItem)}
            />
          </div>
        </div>
        <div className="setting">
          <div className="setting-label">
            Keep running in the tray when closed
            <span className="setting-sub">Shortcuts keep working while the window is closed.</span>
          </div>
          <div className="setting-control">
            <Toggle checked={settings.closeToTray} onChange={(v) => set('closeToTray', v)} />
          </div>
        </div>
        <div className="setting">
          <div className="setting-label">
            Library folder
            <span className="setting-sub mono">{info?.dataDir}</span>
          </div>
          <div className="setting-control">
            <button className="btn secondary" onClick={() => api.openDataDir()}>
              <FolderOpen size={15} /> Open
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
