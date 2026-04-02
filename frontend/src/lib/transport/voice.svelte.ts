import { transportState } from "./transport.svelte";
import type { LibP2PVoice } from "./libp2p/voice";
import type { DtlnProcessor } from "../audio/dtln-processor";

let _voice: LibP2PVoice | null = null;
let _dtln: DtlnProcessor | null = null;
let _initialized = false;

export function initVoice(voice: LibP2PVoice, dtln: DtlnProcessor): void {
  if (_initialized) return;
  _initialized = true;
  _voice = voice;
  _dtln = dtln;

  _voice.on("trackAdded", (peerId, track) => {
    const existing = transportState.participants.get(peerId) ?? {
      peerId,
      audioTrack: null,
      videoTrack: null,
      screenTrack: null,
      screenAudioTrack: null,
    };
    transportState.participants = new Map(transportState.participants).set(
      peerId,
      {
        ...existing,
        audioTrack: track,
      }
    );
  });

  _voice.on("trackRemoved", (peerId) => {
    const p = transportState.participants.get(peerId);
    if (!p) return;
    transportState.participants = new Map(transportState.participants).set(
      peerId,
      {
        ...p,
        audioTrack: null,
      }
    );
  });

  _voice.on("peerLeft", (peerId) => {
    const p = transportState.participants.get(peerId);
    if (!p) return;
    transportState.participants = new Map(transportState.participants).set(
      peerId,
      {
        ...p,
        audioTrack: null,
      }
    );
  });

  _voice.on("error", (err) => {
    transportState.error = err.message;
  });
}

function getVoice(): LibP2PVoice {
  if (!_voice)
    throw new Error("Voice not initialized. Call initVoice() first.");
  return _voice;
}

function getDtln(): DtlnProcessor {
  if (!_dtln) throw new Error("DTLN not initialized. Call initVoice() first.");
  return _dtln;
}

export async function setVoiceInputDevice(deviceId: string): Promise<void> {
  await getVoice().setInputDevice(deviceId);
  transportState.localMicStream = getVoice().getMicStream();
}

export function getVoiceInputDevices(): Promise<MediaDeviceInfo[]> {
  return getVoice().getInputDevices();
}

export function getVoiceActiveInputDevice(): string | null {
  return getVoice().getActiveInputDevice();
}

export function setVoiceInputGain(gain: number): void {
  getVoice().setInputGain(gain);
}
export function getVoiceInputGain(): number {
  return getVoice().getInputGain();
}

export async function setVoiceOutputDevice(deviceId: string): Promise<void> {
  await getVoice().setOutputDevice(deviceId);
}

export function getVoiceOutputDevices(): Promise<MediaDeviceInfo[]> {
  return getVoice().getOutputDevices();
}

export function getVoiceActiveOutputDevice(): string | null {
  return getVoice().getActiveOutputDevice();
}

export function setVoiceOutputVolume(volume: number): void {
  const next = Math.max(0, volume);
  if (!transportState.deafened) getVoice().setOutputVolume(next);
}

export function getVoiceOutputVolume(): number {
  return getVoice().getOutputVolume();
}

export function setVoiceDtlnNoiseGate(threshold: number): void {
  getDtln().setNoiseGate(threshold);
}

export function setVoiceDtlnEnabled(enabled: boolean): void {
  getVoice().setDtlnEnabled(enabled);
}

export function getVoiceDtlnEnabled(): boolean {
  return getVoice().isDtlnEnabled();
}
