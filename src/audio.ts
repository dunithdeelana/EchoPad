import { api } from './api';
import type { RetriggerMode, Sound } from './types';

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };

interface Voice {
  key: number;
  soundId: string;
  startedAt: number; // performance.now()
  duration: number; // seconds
  nodes: { src: AudioBufferSourceNode; gain: GainNode; ctx: AudioContext }[];
  stopping: boolean;
}

export interface EngineConfig {
  /** Device the call app listens to. '' = system default. */
  outputSinkId: string;
  outputVolume: number;
  /** Whether to also play locally. */
  monitorActive: boolean;
  monitorSinkId: string;
  monitorVolume: number;
}

export interface EngineStatus {
  outputError: string | null;
  monitorError: string | null;
  micError: string | null;
  micActive: boolean;
}

const normaliseSink = (id: string) => (!id || id === 'default' ? '' : id);

class AudioEngine {
  private outCtx: SinkContext;
  private outBus: GainNode;
  private soundBus: GainNode;
  private outAnalyser: AnalyserNode;

  private monCtx: SinkContext | null = null;
  private monBus: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private voices: Voice[] = [];
  private voiceKey = 0;

  private mic: {
    deviceId: string;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    analyser: AnalyserNode;
  } | null = null;
  private micRequest = 0;

  private config: EngineConfig = {
    outputSinkId: '',
    outputVolume: 1,
    monitorActive: false,
    monitorSinkId: '',
    monitorVolume: 0.8,
  };

  status: EngineStatus = { outputError: null, monitorError: null, micError: null, micActive: false };

  private listeners = new Set<() => void>();
  private meterData = new Float32Array(1024);

  constructor() {
    this.outCtx = new AudioContext({ latencyHint: 'interactive' }) as SinkContext;
    this.outBus = this.outCtx.createGain();
    this.soundBus = this.outCtx.createGain();
    this.outAnalyser = this.outCtx.createAnalyser();
    this.outAnalyser.fftSize = 1024;
    this.soundBus.connect(this.outBus);
    this.outBus.connect(this.outCtx.destination);
    this.outBus.connect(this.outAnalyser);
  }

  // ---------------------------------------------------------------- events
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  // ---------------------------------------------------------------- routing
  async configure(next: EngineConfig) {
    const prev = this.config;
    this.config = { ...next };

    this.soundBus.gain.setTargetAtTime(next.outputVolume, this.outCtx.currentTime, 0.02);

    if (normaliseSink(prev.outputSinkId) !== normaliseSink(next.outputSinkId) || this.status.outputError) {
      this.status.outputError = await this.applySink(this.outCtx, next.outputSinkId);
    }

    if (next.monitorActive) {
      if (!this.monCtx) {
        this.monCtx = new AudioContext({ latencyHint: 'interactive' }) as SinkContext;
        this.monBus = this.monCtx.createGain();
        this.monBus.connect(this.monCtx.destination);
        this.status.monitorError = await this.applySink(this.monCtx, next.monitorSinkId);
      } else if (
        normaliseSink(prev.monitorSinkId) !== normaliseSink(next.monitorSinkId) ||
        this.status.monitorError
      ) {
        this.status.monitorError = await this.applySink(this.monCtx, next.monitorSinkId);
      }
      this.monBus!.gain.setTargetAtTime(next.monitorVolume, this.monCtx.currentTime, 0.02);
    } else {
      this.status.monitorError = null;
      if (this.monBus && this.monCtx) this.monBus.gain.setTargetAtTime(0, this.monCtx.currentTime, 0.02);
    }
    this.emit();
  }

  private async applySink(ctx: SinkContext, sinkId: string): Promise<string | null> {
    if (typeof ctx.setSinkId !== 'function') return 'Output device selection is not supported.';
    try {
      await ctx.setSinkId(normaliseSink(sinkId));
      return null;
    } catch (err) {
      try {
        await ctx.setSinkId('');
      } catch {
        /* ignore */
      }
      return sinkId ? 'Selected device is unavailable — using system default.' : String(err);
    }
  }

  // ---------------------------------------------------------------- loading
  async load(sound: Pick<Sound, 'id' | 'file'>): Promise<AudioBuffer> {
    const cached = this.buffers.get(sound.id);
    if (cached) return cached;
    let p = this.loading.get(sound.id);
    if (!p) {
      p = api
        .readSound(sound.file)
        .then((data) => this.outCtx.decodeAudioData(data))
        .then((buf) => {
          this.buffers.set(sound.id, buf);
          this.loading.delete(sound.id);
          return buf;
        })
        .catch((err) => {
          this.loading.delete(sound.id);
          throw err;
        });
      this.loading.set(sound.id, p);
    }
    return p;
  }

  forget(soundId: string) {
    this.stop(soundId);
    this.buffers.delete(soundId);
  }

  // ---------------------------------------------------------------- playback
  async play(sound: Sound, opts: { retrigger: RetriggerMode; allowSimultaneous: boolean }) {
    const alreadyPlaying = this.voices.some((v) => v.soundId === sound.id && !v.stopping);
    if (alreadyPlaying) {
      if (opts.retrigger === 'stop') {
        this.stop(sound.id);
        return;
      }
      if (opts.retrigger === 'restart') this.stop(sound.id, 0.015);
    }
    if (!opts.allowSimultaneous) {
      this.voices.filter((v) => v.soundId !== sound.id).forEach((v) => this.stopVoice(v, 0.015));
    }

    const buffer = await this.load(sound);
    if (this.outCtx.state !== 'running') await this.outCtx.resume().catch(() => {});

    const voice: Voice = {
      key: ++this.voiceKey,
      soundId: sound.id,
      startedAt: performance.now(),
      duration: buffer.duration,
      nodes: [],
      stopping: false,
    };

    const start = (ctx: AudioContext, bus: AudioNode) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = sound.volume;
      src.connect(gain).connect(bus);
      src.start();
      voice.nodes.push({ src, gain, ctx });
      return src;
    };

    const primary = start(this.outCtx, this.soundBus);
    if (this.config.monitorActive && this.monCtx && this.monBus) {
      if (this.monCtx.state !== 'running') this.monCtx.resume().catch(() => {});
      start(this.monCtx, this.monBus);
    }

    primary.onended = () => {
      this.voices = this.voices.filter((v) => v.key !== voice.key);
      voice.nodes.forEach((n) => {
        try {
          n.src.disconnect();
          n.gain.disconnect();
        } catch {
          /* ignore */
        }
      });
      this.emit();
    };

    this.voices.push(voice);
    this.emit();
  }

  private stopVoice(v: Voice, fade = 0.04) {
    if (v.stopping) return;
    v.stopping = true;
    v.nodes.forEach(({ src, gain, ctx }) => {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + fade);
      try {
        src.stop(t + fade + 0.005);
      } catch {
        /* already stopped */
      }
    });
    this.emit();
  }

  stop(soundId: string, fade?: number) {
    this.voices.filter((v) => v.soundId === soundId).forEach((v) => this.stopVoice(v, fade));
  }

  stopAll() {
    this.voices.forEach((v) => this.stopVoice(v));
  }

  setSoundVolume(soundId: string, volume: number) {
    this.voices
      .filter((v) => v.soundId === soundId && !v.stopping)
      .forEach((v) => v.nodes.forEach((n) => n.gain.gain.setTargetAtTime(volume, n.ctx.currentTime, 0.02)));
  }

  isPlaying(soundId: string) {
    return this.voices.some((v) => v.soundId === soundId && !v.stopping);
  }

  playingIds(): Set<string> {
    return new Set(this.voices.filter((v) => !v.stopping).map((v) => v.soundId));
  }

  /** 0..1 progress of the most recent voice of this sound, or null. */
  progress(soundId: string): number | null {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.soundId === soundId && !v.stopping) {
        return Math.min(1, (performance.now() - v.startedAt) / 1000 / v.duration);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- microphone
  async setMic(enabled: boolean, deviceId: string, volume: number) {
    const req = ++this.micRequest;
    if (!enabled) {
      this.teardownMic();
      this.status.micError = null;
      this.status.micActive = false;
      this.emit();
      return;
    }
    if (this.mic && this.mic.deviceId === deviceId) {
      this.mic.gain.gain.setTargetAtTime(volume, this.outCtx.currentTime, 0.02);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (req !== this.micRequest) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.teardownMic();
      const source = this.outCtx.createMediaStreamSource(stream);
      const gain = this.outCtx.createGain();
      gain.gain.value = volume;
      const analyser = this.outCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(gain);
      gain.connect(this.outBus);
      gain.connect(analyser);
      this.mic = { deviceId, stream, source, gain, analyser };
      this.status.micError = null;
      this.status.micActive = true;
    } catch (err) {
      if (req !== this.micRequest) return;
      this.teardownMic();
      this.status.micActive = false;
      this.status.micError =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was denied.'
          : 'Could not open the microphone.';
    }
    this.emit();
  }

  private teardownMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach((t) => t.stop());
    try {
      this.mic.source.disconnect();
      this.mic.gain.disconnect();
    } catch {
      /* ignore */
    }
    this.mic = null;
  }

  // ---------------------------------------------------------------- meters
  private rms(analyser: AnalyserNode) {
    analyser.getFloatTimeDomainData(this.meterData);
    let sum = 0;
    for (let i = 0; i < this.meterData.length; i++) sum += this.meterData[i] * this.meterData[i];
    const rms = Math.sqrt(sum / this.meterData.length);
    // map -60dB..0dB to 0..1
    const db = 20 * Math.log10(rms || 1e-8);
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }
  outputLevel() {
    return this.rms(this.outAnalyser);
  }
  micLevel() {
    return this.mic ? this.rms(this.mic.analyser) : 0;
  }

  // ---------------------------------------------------------------- test
  async testTone(target: 'output' | 'monitor') {
    const ctx = target === 'output' ? this.outCtx : this.monCtx;
    const bus = target === 'output' ? this.soundBus : this.monBus;
    if (!ctx || !bus) return;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const t = ctx.currentTime + 0.02;
    [659.25, 987.77].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const s = t + i * 0.16;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.35, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.45);
      osc.connect(g).connect(bus);
      osc.start(s);
      osc.stop(s + 0.5);
    });
  }
}

export const engine = new AudioEngine();
