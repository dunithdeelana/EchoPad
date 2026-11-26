import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { cleanLabel, isVirtualCable, resolveDevice, type Devices } from '../useDevices';

export const VB_CABLE_URL = 'https://vb-audio.com/Cable/';

export function setupChecks(devices: Devices, settings: ReturnType<typeof useStore.getState>['settings']) {
  const cable = devices.outputs.find((d) => isVirtualCable(d.label));
  const output = resolveDevice(devices.outputs, settings.outputDeviceId, settings.outputDeviceLabel);
  return {
    cableInstalled: !!cable,
    cableLabel: cable ? cleanLabel(cable.label) : null,
    outputSet: !!output && isVirtualCable(output.label),
    micOn: settings.micPassthrough,
  };
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`step${done ? ' done' : ''}`}>
      <div className="step-marker">
        {done === undefined ? <span>{n}</span> : done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
      </div>
      <div className="step-body">
        <h4>
          <span className="step-n">Step {n}</span> {title}
        </h4>
        {children}
      </div>
    </div>
  );
}

export function SetupSteps({ devices, compact }: { devices: Devices; compact?: boolean }) {
  const settings = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const update = useStore((s) => s.updateSettings);
  const checks = setupChecks(devices, settings);
  const cable = devices.outputs.find((d) => isVirtualCable(d.label));

  return (
    <div className={`steps${compact ? ' compact' : ''}`}>
      <Step n={1} done={checks.cableInstalled} title="Install a virtual audio cable">
        <p>
          Echopad sends sounds into a free virtual microphone called <b>VB-CABLE</b>. Download it, run{' '}
          <code>VBCABLE_Setup_x64.exe</code> as administrator, then restart your PC.
        </p>
        {checks.cableInstalled ? (
          <div className="callout ok">
            <CheckCircle2 size={16} /> Detected: {checks.cableLabel}
          </div>
        ) : (
          <button className="btn secondary" onClick={() => api.openExternal(VB_CABLE_URL)}>
            Download VB-CABLE <ExternalLink size={14} />
          </button>
        )}
      </Step>

      <Step n={2} done={checks.outputSet} title="Send Echopad's output to the cable">
        <p>
          Choose <b>CABLE Input</b> as the voice chat output in Audio setup. Keep <b>Microphone passthrough</b> on and
          pick your <b>real microphone</b> there. Echopad mixes your voice into the cable, so Discord hears you and the
          sounds together.
        </p>
        {!checks.outputSet && cable && (
          <button
            className="btn primary"
            onClick={() => update({ outputDeviceId: cable.deviceId, outputDeviceLabel: cable.label })}
          >
            Use {cleanLabel(cable.label)}
          </button>
        )}
        {!compact && !cable && (
          <button className="btn secondary" onClick={() => setView('settings')}>
            Open Audio setup
          </button>
        )}
      </Step>

      <Step n={3} title="Point Discord at the cable">
        <ol className="sub-steps">
          <li>
            Discord → <b>User Settings</b> (⚙) → <b>Voice &amp; Video</b>.
          </li>
          <li>
            Set <b>Input Device</b> to <b>CABLE Output (VB-Audio Virtual Cable)</b>.
          </li>
          <li>
            Turn <b>Noise Suppression</b> to <b>None</b> and switch off <b>Echo Cancellation</b> — otherwise Discord may
            filter your sounds out.
          </li>
          <li>
            Use <b>Voice Activity</b> input mode (Push-to-Talk only sends sounds while you hold the key).
          </li>
        </ol>
      </Step>

      <Step n={4} title="Bind keys and play">
        <p>
          Give each sound a shortcut (right-click → Edit). Shortcuts are global, so they work while Discord or a game
          is in focus. Close the window and Echopad keeps running in the tray.
        </p>
      </Step>
    </div>
  );
}

export function GuideView({ devices }: { devices: Devices }) {
  return (
    <div className="guide">
      <p className="lead">
        Discord can only hear a microphone. Echopad plays your sounds into a virtual microphone (VB-CABLE) and mixes your
        real mic into it, so your friends hear both. One-time setup takes about two minutes.
      </p>
      <SetupSteps devices={devices} />
      <div className="tips">
        <h4>Troubleshooting</h4>
        <ul>
          <li>
            <b>Friends hear nothing:</b> check that Discord's input meter moves when you press <i>Test</i> in Audio setup.
          </li>
          <li>
            <b>Sounds cut in and out:</b> set Discord's Input Sensitivity manually and lower the threshold.
          </li>
          <li>
            <b>A shortcut doesn't work:</b> another app may have claimed it. A warning icon appears on that sound's
            card. Pick a different combination.
          </li>
          <li>
            <b>Friends can't hear your voice:</b> in Audio setup, make sure Microphone passthrough is on and your real
            microphone (headset, USB mic…) is selected. Talk and the Input level bar should move. If Windows shows a
            mic permission error, turn on “Let desktop apps access your microphone” in Windows Privacy settings.
          </li>
        </ul>
      </div>
    </div>
  );
}
