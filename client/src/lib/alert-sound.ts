let audioContext: AudioContext | null = null;
let gestureUnlockAttached = false;

function attachAudioResumeOnUserGesture(): void {
  if (typeof window === "undefined" || gestureUnlockAttached) return;
  gestureUnlockAttached = true;
  const tryResume = () => {
    if (audioContext?.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }
  };
  window.addEventListener("pointerdown", tryResume, { capture: true, passive: true });
  window.addEventListener("keydown", tryResume, { capture: true, passive: true });
}

attachAudioResumeOnUserGesture();

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }
  return audioContext;
}

export async function playAlertChime(): Promise<void> {
  const context = getAudioContext();
  if (!context || context.state !== "running") return;

  const pulseTimes = [0, 0.16, 0.34];
  const pulseFrequencies = [740, 1240, 540];

  for (let index = 0; index < pulseTimes.length; index += 1) {
    const pulseStart = context.currentTime + 0.01 + pulseTimes[index];
    const gainNode = context.createGain();
    gainNode.connect(context.destination);
    gainNode.gain.setValueAtTime(0.0001, pulseStart);
    gainNode.gain.linearRampToValueAtTime(0.11, pulseStart + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, pulseStart + 0.12);

    const carrier = context.createOscillator();
    carrier.type = index === 1 ? "square" : "sawtooth";
    carrier.frequency.setValueAtTime(pulseFrequencies[index], pulseStart);
    carrier.frequency.linearRampToValueAtTime(pulseFrequencies[index] + (index === 2 ? -90 : 120), pulseStart + 0.09);
    carrier.connect(gainNode);

    const accent = context.createOscillator();
    accent.type = "triangle";
    accent.frequency.setValueAtTime(pulseFrequencies[index] * 1.5, pulseStart);
    accent.connect(gainNode);

    carrier.start(pulseStart);
    carrier.stop(pulseStart + 0.12);
    accent.start(pulseStart + 0.01);
    accent.stop(pulseStart + 0.09);
  }
}
