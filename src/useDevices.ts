import { useCallback, useEffect, useState } from 'react';

export interface Devices {
  outputs: MediaDeviceInfo[];
  inputs: MediaDeviceInfo[];
  refresh(): Promise<void>;
  loaded: boolean;
}

export { cleanLabel, isVirtualCable, isVirtualInput, pickMic, realMics, resolveDevice } from './deviceLogic';

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
