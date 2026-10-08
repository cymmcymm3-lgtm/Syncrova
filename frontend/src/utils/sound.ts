import messageReceivedUrl from './message recieved.mp3';
import incomingCallUrl from './incommingcallsoundeffext.mp3';

type PendingPlayback = { name: string; volume: number } | null;

const soundCache = new Map<string, HTMLAudioElement>();
const soundLastPlayedAt = new Map<string, number>();
let pendingPlayback: PendingPlayback = null;
let removePlaybackUnlock: (() => void) | null = null;
const MIN_SOUND_GAP_MS = 70;

const soundSources: Record<string, string> = {
  message: messageReceivedUrl,
  ringtone: incomingCallUrl,
  call: incomingCallUrl,
  'incoming call': incomingCallUrl,
  incomingcall: incomingCallUrl,
  'message received': messageReceivedUrl,
  'message recieved': messageReceivedUrl
};

// Keep the app calm: only calls, received messages, and a very soft send
// confirmation are allowed. Unknown legacy names intentionally do nothing.
const generatedSoundNames = new Set(['send', 'message send']);
let generatedAudioContext: AudioContext | null = null;

const getAudioContextCtor = (): typeof AudioContext | null => (
  window.AudioContext || ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null)
);

const playGeneratedSound = (name: string, volume = 0.35): boolean => {
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) return false;

  generatedAudioContext = generatedAudioContext || new AudioContextCtor();
  const context = generatedAudioContext;
  const normalizedName = String(name || '').trim().toLowerCase();
  const startAt = context.currentTime + 0.02;
  const notes = normalizedName.includes('send')
    ? [
        { offset: 0, frequency: 560, duration: 0.045 },
        { offset: 0.055, frequency: 710, duration: 0.06 }
      ]
    : [];

  notes.forEach(note => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, startAt + note.offset);
    gain.gain.setValueAtTime(0.0001, startAt + note.offset);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.14), startAt + note.offset + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.offset + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt + note.offset);
    oscillator.stop(startAt + note.offset + note.duration + 0.04);
  });

  return true;
};

const getSoundUrl = (name: string): string | null => {
  const normalized = String(name || '').trim().toLowerCase();
  return soundSources[normalized] || soundSources[normalized.replace(/-/g, ' ')] || null;
};

const installPlaybackUnlock = (): void => {
  if (typeof window === 'undefined' || removePlaybackUnlock) return;

  const replayPendingSound = (): void => {
    const queued = pendingPlayback;
    pendingPlayback = null;
    if (removePlaybackUnlock) removePlaybackUnlock();
    if (queued) playUiSound(queued.name, queued.volume);
  };

  window.addEventListener('pointerdown', replayPendingSound, true);
  window.addEventListener('keydown', replayPendingSound, true);
  window.addEventListener('touchstart', replayPendingSound, true);

  removePlaybackUnlock = () => {
    window.removeEventListener('pointerdown', replayPendingSound, true);
    window.removeEventListener('keydown', replayPendingSound, true);
    window.removeEventListener('touchstart', replayPendingSound, true);
    removePlaybackUnlock = null;
  };
};

export const playUiSound = (name: string, volume = 0.35): void => {
  if (typeof window === 'undefined' || !name) return;

  try {
    const normalizedName = String(name).trim().toLowerCase();
    const now = Date.now();
    const lastPlayedAt = soundLastPlayedAt.get(normalizedName) || 0;
    if (now - lastPlayedAt < MIN_SOUND_GAP_MS) return;
    soundLastPlayedAt.set(normalizedName, now);

    const url = getSoundUrl(name);
    if (!url) {
      if (generatedSoundNames.has(normalizedName)) {
        const AudioContextCtor = getAudioContextCtor();
        if (!AudioContextCtor) return;
        generatedAudioContext = generatedAudioContext || new AudioContextCtor();
        const resume = generatedAudioContext.state === 'suspended'
          ? generatedAudioContext.resume()
          : Promise.resolve();
        resume
          .then(() => playGeneratedSound(normalizedName, volume))
          .catch(() => {
            pendingPlayback = { name, volume };
            installPlaybackUnlock();
          });
      }
      return;
    }

    const key = `${name}:${volume}`;
    const audio = soundCache.get(key) || new Audio(url);
    audio.volume = volume;
    audio.currentTime = 0;
    soundCache.set(key, audio);
    audio.play().catch(() => {
      pendingPlayback = { name, volume };
      installPlaybackUnlock();
    });
  } catch {
    // Missing sound files should never break the app.
  }
};

export const installGlobalClickSound = (): (() => void) => {
  // Kept as a compatibility export for the layout. Global button/tab sounds
  // are deliberately disabled so navigation and games stay quiet.
  return () => {};
};
