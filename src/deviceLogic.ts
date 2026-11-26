// Pure device-selection rules (no React/DOM), so they can be unit-tested.

export interface DeviceLike {
  deviceId: string;
  label: string;
}

/** Playback side of a virtual cable (what Echopad plays into), e.g. "CABLE Input (VB-Audio Virtual Cable)". */
const VIRTUAL_OUTPUT = /cable input|cable-[a-z] input|vb-audio|voicemeeter (aux |vaio3 )?input|virtual (audio|cable)|blackhole/i;
/** Recording side of a virtual cable (what Discord listens to), e.g. "CABLE Output (VB-Audio Virtual Cable)". */
const VIRTUAL_INPUT = /cable output|cable-[a-z] output|vb-audio|voicemeeter|virtual (audio|cable)|blackhole|stereo mix/i;

export function isVirtualCable(label: string) {
  return VIRTUAL_OUTPUT.test(label) && !/cable output/i.test(label);
}

/** True if this recording device is a virtual cable (or loopback) rather than a real microphone. */
export function isVirtualInput(label: string) {
  return VIRTUAL_INPUT.test(label);
}

/** Strip Windows' "Default - " / "Communications - " prefixes for display. */
export function cleanLabel(label: string) {
  return label.replace(/^(Default|Communications) - /, '');
}

/**
 * Find a device by id, falling back to label (ids can change after driver updates).
 */
export function resolveDevice<T extends DeviceLike>(list: T[], id: string, label: string): T | undefined {
  return list.find((d) => d.deviceId === id) ?? (label ? list.find((d) => d.label === label) : undefined);
}

/** Microphones the user may pick for passthrough: real mics only. */
export function realMics<T extends DeviceLike>(inputs: T[]): T[] {
  return inputs.filter((d) => d.deviceId !== 'communications' && !isVirtualInput(d.label));
}

/**
 * The microphone to mix into the call. Never a virtual cable: installing VB-CABLE often makes
 * "CABLE Output" the Windows default recording device, and capturing it would loop the cable
 * back into itself instead of carrying the user's voice.
 */
export function pickMic<T extends DeviceLike>(
  inputs: T[],
  id: string,
  label: string,
  preferredName = '',
): T | undefined {
  const explicit = !!id && id !== 'default';
  if (explicit) {
    const chosen = resolveDevice(inputs, id, label);
    if (chosen && !isVirtualInput(chosen.label)) return chosen;
  }
  const real = realMics(inputs);
  // Automatic: the mic Windows used before Echopad switched the default to its virtual microphone.
  const preferred = preferredName ? real.find((d) => d.deviceId !== 'default' && d.label === preferredName) : undefined;
  // Prefer a specific device over the "default" alias, since the alias may point at the cable.
  return preferred ?? real.find((d) => d.deviceId !== 'default') ?? real[0];
}
