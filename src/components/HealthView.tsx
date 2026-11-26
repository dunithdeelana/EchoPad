import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import { engine } from '../audio';
import { useStore } from '../store';
import type { CheckStatus, FixAction, HealthCheck, HealthReport } from '../types';
import { Logo } from './Chrome';

const FIX_LABEL: Record<FixAction, string> = {
  'install-driver': 'Install now',
  restart: 'Restart PC',
  'fix-privacy': 'Allow',
  'open-privacy': 'Open settings',
  'open-discord': 'Open Discord settings',
  'open-sound-settings': 'Open sound settings',
  retry: 'Try again',
};

/** App-level checks (renderer state) merged with the system report from the main process. */
export function useAllChecks(): HealthCheck[] {
  const health = useStore((s) => s.health);
  const settings = useStore((s) => s.settings);
  const failed = useStore((s) => s.failedHotkeys);
  const [status, setStatus] = useState(engine.status);
  useEffect(() => engine.subscribe(() => setStatus({ ...engine.status })), []);

  const checks: HealthCheck[] = [...(health?.checks ?? [])];
  const driverOk = checks.find((c) => c.id === 'driver')?.status === 'ok';

  if (health?.supported) {
    checks.splice(2, 0, {
      id: 'routing',
      title: 'Sounds routed to the call',
      status: !driverOk ? 'pending' : status.outputError ? 'error' : settings.outputDeviceId ? 'ok' : 'pending',
      detail: !driverOk
        ? 'Waiting for the driver.'
        : status.outputError
          ? status.outputError
          : settings.outputDeviceId
            ? 'Echopad plays sounds into the virtual microphone.'
            : 'Connecting…',
    });
    const micIdx = checks.findIndex((c) => c.id === 'mic');
    if (micIdx >= 0 && driverOk) {
      checks[micIdx] = {
        ...checks[micIdx],
        status: !settings.micPassthrough ? 'warn' : status.micError ? 'error' : status.micActive ? 'ok' : checks[micIdx].status,
        detail: !settings.micPassthrough
          ? 'Microphone passthrough is turned off, so friends hear your sounds but not your voice.'
          : status.micError ?? checks[micIdx].detail,
      };
    }
  }
  if (failed.length) {
    checks.push({
      id: 'hotkeys',
      title: 'Keyboard shortcuts',
      status: 'warn',
      detail: `${failed.length} shortcut${failed.length > 1 ? 's are' : ' is'} taken by another app. Pick a different key for the sounds marked with ⚠.`,
    });
  }
  return checks;
}

export function overallStatus(health: HealthReport | null, checks: HealthCheck[]) {
  if (!health) return { tone: 'busy' as const, text: 'Checking your setup…' };
  if (!health.supported) return { tone: 'ok' as const, text: 'Ready' };
  if (health.phase === 'installing') return { tone: 'busy' as const, text: 'Setting up…' };
  if (checks.some((c) => c.status === 'error')) return { tone: 'error' as const, text: 'Needs attention' };
  if (checks.some((c) => c.status === 'warn')) return { tone: 'warn' as const, text: 'Almost ready' };
  if (checks.some((c) => c.status === 'pending')) return { tone: 'busy' as const, text: 'Setting up…' };
  return { tone: 'ok' as const, text: 'Ready for Discord' };
}

function StatusIcon({ status }: { status: CheckStatus | 'busy' }) {
  switch (status) {
    case 'ok':
      return <CheckCircle2 size={20} className="st-ok" />;
    case 'warn':
      return <AlertTriangle size={20} className="st-warn" />;
    case 'error':
      return <XCircle size={20} className="st-error" />;
    case 'info':
      return <Info size={20} className="st-info" />;
    case 'busy':
      return <Loader2 size={20} className="st-busy spin" />;
    default:
      return <Circle size={20} className="st-pending" />;
  }
}

export function FixButton({ action }: { action: FixAction }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (action === 'restart' && !confirm) {
    return (
      <button className="btn secondary sm" onClick={() => setConfirm(true)}>
        {FIX_LABEL[action]}
      </button>
    );
  }
  return (
    <button
      className={`btn ${action === 'install-driver' || confirm ? 'primary' : 'secondary'} sm`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.systemAction(action);
        } finally {
          setBusy(false);
          setConfirm(false);
        }
      }}
    >
      {busy && <Loader2 size={14} className="spin" />}
      {confirm ? 'Restart in 5 s — save your work' : FIX_LABEL[action]}
    </button>
  );
}

function CheckRow({ check, installing }: { check: HealthCheck; installing: boolean }) {
  const busy = installing && check.id === 'driver';
  return (
    <div className={`check-row ${check.status}`}>
      <StatusIcon status={busy ? 'busy' : check.status} />
      <div className="check-text">
        <div className="check-title">{check.title}</div>
        <div className="check-detail">{check.detail}</div>
      </div>
      {check.fix && !busy && <FixButton action={check.fix} />}
    </div>
  );
}

export function HealthView() {
  const health = useStore((s) => s.health);
  const checks = useAllChecks();
  const overall = overallStatus(health, checks);
  const [checking, setChecking] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    try {
      await api.systemCheck();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="health">
      <section className={`health-hero ${overall.tone}`}>
        <div className="health-hero-icon">
          {overall.tone === 'ok' ? <ShieldCheck size={26} /> : <StatusIcon status={overall.tone === 'busy' ? 'busy' : overall.tone} />}
        </div>
        <div className="health-hero-text">
          <h2>{overall.text}</h2>
          <p>
            {health?.supported === false
              ? 'Automatic setup runs on Windows.'
              : health?.phase === 'installing'
                ? health.phaseMessage
                : 'Echopad checks your setup every 30 seconds and fixes problems on its own.'}
          </p>
        </div>
        <button className="btn secondary" onClick={runCheck} disabled={checking || health?.phase === 'installing'}>
          <RefreshCw size={15} className={checking ? 'spin' : ''} /> Check now
        </button>
      </section>

      {checks.length > 0 && (
        <section className="panel checks">
          {checks.map((c) => (
            <CheckRow key={c.id} check={c} installing={health?.phase === 'installing'} />
          ))}
        </section>
      )}

      {!!health?.log.length && (
        <section className="panel">
          <header className="panel-header">
            <div className="panel-icon green">
              <Wrench size={18} />
            </div>
            <div>
              <h3>Fixed automatically</h3>
              <p>What Echopad changed to keep things working.</p>
            </div>
          </header>
          <ul className="fix-log">
            {health.log.map((l, i) => (
              <li key={i} className={l.kind}>
                <span className="fix-time">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {l.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="tips">
        <h4>Good to know</h4>
        <ul>
          <li>
            Leave Discord's <b>Input Device</b> on <b>Default</b>. Echopad handles the rest.
          </li>
          <li>
            If sounds get cut off in the call, set Discord's <b>Noise Suppression</b> to <b>None</b>. It treats music
            and effects as noise.
          </li>
          <li>When you quit Echopad, your real microphone goes back to being the Windows default.</li>
          <li>
            The virtual microphone driver is VB-CABLE, donationware by VB-Audio (vb-cable.com). Echopad installs it with
            VB-Audio's own signed installer.
          </li>
        </ul>
      </div>
    </div>
  );
}

/** First-run screen: runs automatically, shows progress, disappears when ready. */
export function SetupOverlay({ onDone }: { onDone(): void }) {
  const health = useStore((s) => s.health);
  const checks = useAllChecks();
  const overall = overallStatus(health, checks);
  const installing = health?.phase === 'installing';
  const steps = [
    { id: 'driver', title: 'Install the virtual microphone' },
    { id: 'default-mic', title: 'Configure Windows audio' },
    { id: 'mic', title: 'Connect your microphone' },
    { id: 'routing', title: 'Route sounds into voice chat' },
  ];
  const stepChecks = steps.map((st) => checks.find((x) => x.id === st.id));
  const ready = !installing && stepChecks.every((c) => c?.status === 'ok');
  const needsRestart = checks.find((c) => c.id === 'driver')?.fix === 'restart';
  const failed = stepChecks.some((c) => c?.status === 'error');
  void overall;

  return (
    <div className="modal-backdrop">
      <div className="modal setup" role="dialog" aria-modal="true">
        <div className="setup-head">
          <Logo size={44} />
          <div>
            <h2>
              {ready
                ? 'You’re all set'
                : needsRestart
                  ? 'Restart to finish setup'
                  : failed
                    ? 'Setup needs your help'
                    : 'Setting up Echopad'}
            </h2>
            <p>
              {ready
                ? 'Join any Discord voice channel. Friends will hear your voice and your sounds.'
                : needsRestart
                  ? 'Windows needs one restart to activate the virtual microphone. Echopad finishes on its own afterwards.'
                  : failed
                    ? 'One step didn’t work. The reason is shown below.'
                    : 'This happens automatically and only once.'}
            </p>
          </div>
        </div>
        <div className="setup-steps">
          {steps.map((s) => {
            const c = checks.find((x) => x.id === s.id);
            const busy = (installing && s.id === 'driver') || !c || c.status === 'pending';
            const status = installing && s.id === 'driver' ? 'busy' : c?.status === 'pending' || !c ? 'busy' : c.status;
            return (
              <div key={s.id} className={`setup-step ${busy ? 'busy' : c?.status}`}>
                <StatusIcon status={status} />
                <div className="check-text">
                  <div className="check-title">{s.title}</div>
                  <div className="check-detail">
                    {installing && s.id === 'driver' ? health?.phaseMessage : c && c.status !== 'ok' ? c.detail : ''}
                  </div>
                </div>
                {c?.fix && !installing && <FixButton action={c.fix} />}
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <span className="footer-note">Echopad keeps checking and fixes problems automatically.</span>
          <div className="spacer" />
          <button className="btn primary" onClick={onDone} disabled={installing}>
            {ready ? 'Start using Echopad' : 'Continue in background'}
          </button>
        </div>
      </div>
    </div>
  );
}
