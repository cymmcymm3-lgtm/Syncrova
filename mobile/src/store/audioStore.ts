import { create } from 'zustand';

type AudioState = {
  playingId: string;
  uri: string;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  setPlayback: (payload: Partial<Omit<AudioState, 'setPlayback' | 'resetPlayback'>>) => void;
  resetPlayback: () => void;
};

export const useAudioStore = create<AudioState>(set => ({
  playingId: '',
  uri: '',
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  setPlayback: payload => set(payload),
  resetPlayback: () => set({
    playingId: '',
    uri: '',
    isPlaying: false,
    positionMs: 0,
    durationMs: 0
  })
}));
