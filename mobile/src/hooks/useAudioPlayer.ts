import { useCallback } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { useAudioStore } from '../store/audioStore';

let activeSound: Audio.Sound | null = null;
let activeId = '';

const unloadActiveSound = async () => {
  if (!activeSound) return;
  const sound = activeSound;
  activeSound = null;
  activeId = '';
  await sound.stopAsync().catch(() => {});
  await sound.unloadAsync().catch(() => {});
};

const applyStatus = (id: string, status: AVPlaybackStatus) => {
  const store = useAudioStore.getState();
  if (!status.isLoaded) {
    if (activeId === id) store.resetPlayback();
    return;
  }

  store.setPlayback({
    playingId: id,
    isPlaying: status.isPlaying,
    positionMs: status.positionMillis || 0,
    durationMs: status.durationMillis || store.durationMs || 0,
    uri: store.uri
  });

  if (status.didJustFinish) {
    store.setPlayback({
      isPlaying: false,
      positionMs: 0
    });
    activeSound?.setPositionAsync(0).catch(() => {});
  }
};

export const useAudioPlayer = () => {
  const playback = useAudioStore();

  const play = useCallback(async ({ id, uri }: { id: string; uri: string }) => {
    if (!id || !uri) return;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true
    });

    if (activeSound && activeId === id) {
      const status = await activeSound.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await activeSound.pauseAsync();
        useAudioStore.getState().setPlayback({ isPlaying: false });
      } else {
        await activeSound.playAsync();
        useAudioStore.getState().setPlayback({ isPlaying: true });
      }
      return;
    }

    await unloadActiveSound();
    activeId = id;
    useAudioStore.getState().setPlayback({
      playingId: id,
      uri,
      isPlaying: true,
      positionMs: 0,
      durationMs: 0
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { progressUpdateIntervalMillis: 250, shouldPlay: true },
      status => applyStatus(id, status)
    );
    activeSound = sound;
  }, []);

  const pause = useCallback(async () => {
    await activeSound?.pauseAsync().catch(() => {});
    useAudioStore.getState().setPlayback({ isPlaying: false });
  }, []);

  const stop = useCallback(async () => {
    await unloadActiveSound();
    useAudioStore.getState().resetPlayback();
  }, []);

  return {
    ...playback,
    play,
    pause,
    stop
  };
};
