import { Audio } from 'expo-av';

type SoundKey = 'send' | 'received' | 'incomingCall';

const SOUND_ASSETS = {
  send: require('../../assets/sounds/message-send.mp3'),
  received: require('../../assets/sounds/message-received.mp3'),
  incomingCall: require('../../assets/sounds/incoming-call.mp3')
} as const;

const soundCache: Partial<Record<SoundKey, Audio.Sound>> = {};
let audioConfigured = false;

const configureAudio = async () => {
  if (audioConfigured) return;
  audioConfigured = true;
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    staysActiveInBackground: false
  });
};

const getSound = async (key: SoundKey) => {
  await configureAudio();
  if (soundCache[key]) return soundCache[key] as Audio.Sound;

  const { sound } = await Audio.Sound.createAsync(SOUND_ASSETS[key], {
    isLooping: key === 'incomingCall',
    shouldPlay: false,
    volume: key === 'incomingCall' ? 0.95 : 0.72
  });
  soundCache[key] = sound;
  return sound;
};

export const preloadSoundEffects = () => {
  void Promise.all([
    getSound('send'),
    getSound('received'),
    getSound('incomingCall')
  ]).catch(() => {});
};

export const playSendSound = () => {
  void getSound('send').then(sound => sound.replayAsync()).catch(() => {});
};

export const playReceivedSound = () => {
  void getSound('received').then(sound => sound.replayAsync()).catch(() => {});
};

export const playIncomingCallSound = () => {
  void getSound('incomingCall').then(async sound => {
    await sound.setIsLoopingAsync(true);
    await sound.replayAsync();
  }).catch(() => {});
};

export const stopIncomingCallSound = () => {
  void soundCache.incomingCall?.stopAsync().catch(() => {});
};
