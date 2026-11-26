import { useCallback, useEffect, useState } from 'react';

export interface Devices {
  outputs: MediaDeviceInfo[];
  inputs: MediaDeviceInfo[];
  refresh(): Promise<void>;
  loaded: boolean;
}

const VIRTUAL_CABLE = /cable input|vb-audio|voicemeeter (aux )?input|virtual (audio|cable)|blackhole/i;

export function isVirtualCable(label: string) {
  return VIRTUAL_CABLE.test(label) && !/cable output/i.test(label);
}

/** Strip Windows' "Default - " / "Communications - " prefixes for display. */
export function cleanLabel(label: string) {
  return label.replace(/^(Default|Communications) - /, '');
}

let primed = false;

async function enumerate(): Promise<MediaDeviceInfo[]> {
  let list = await navigator.mediaDevices.enumerateDevices();
  // Labels are hidden until media permission has been used once.
  if (!primed && list.some((d) => !d.label)) {
    primed = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      list = await navigator.mediaDevices.enumerateDevices();
    } catch {
      /* no mic / denied: labels may stay empty */
    }
  }
  return list;
}

export function useDevices(): Devices {
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await enumerate();
      setOutputs(list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications'));
      setInputs(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { outputs, inputs, refresh, loaded };
}

/**
 * Find a device by id, falling back to label (ids can change after driver updates).
 */
export function resolveDevice(list: MediaDeviceInfo[], id: string, label: string) {
  return list.find((d) => d.deviceId === id) ?? (label ? list.find((d) => d.label === label) : undefined);
}
