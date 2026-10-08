import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, Text, ToastAndroid, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';
import { Lock, Send, Square, Trash2, X } from 'lucide-react-native';
import type { VoiceRecordingResult } from '../utils/mediaHelpers';
import { formatDuration } from '../utils/mediaHelpers';

type VoiceRecorderProps = {
  onCancel: () => void;
  onSend: (recording: VoiceRecordingResult) => void;
};

const MAX_DURATION_MS = 300000;

export default function VoiceRecorder({ onCancel, onSend }: VoiceRecorderProps) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const pulse = useSharedValue(1);
  const sentRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1.24, { duration: 520 }), withTiming(1, { duration: 520 })),
      -1,
      true
    );
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }]
  }));

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Microphone needed', 'Allow microphone access to send voice messages.');
          onCancel();
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true
        });

        const nextRecording = new Audio.Recording();
        nextRecording.setProgressUpdateInterval(250);
        nextRecording.setOnRecordingStatusUpdate(status => {
          if (!status.isRecording) return;
          setDurationMs(status.durationMillis || 0);
          if ((status.durationMillis || 0) >= MAX_DURATION_MS && !sentRef.current) {
            sentRef.current = true;
            stopAndSend(nextRecording).catch(() => {});
          }
        });
        await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await nextRecording.startAsync();
        recordingRef.current = nextRecording;
        if (mounted) setRecording(nextRecording);
      } catch {
        Alert.alert('Recording failed', 'Could not start voice recording.');
        onCancel();
      }
    };

    start();

    return () => {
      mounted = false;
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
    // Intentionally starts once when the recorder view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discard = async () => {
    if (busy) return;
    setBusy(true);
    const activeRecording = recording || recordingRef.current;
    recordingRef.current = null;
    setRecording(null);
    try {
      await activeRecording?.stopAndUnloadAsync().catch(() => {});
      const uri = activeRecording?.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      if (Platform.OS === 'android') ToastAndroid.show('Recording discarded', ToastAndroid.SHORT);
    } finally {
      setBusy(false);
      onCancel();
    }
  };

  const stopAndSend = async (targetRecording = recording || recordingRef.current) => {
    if (busy || !targetRecording) return;
    setBusy(true);
    try {
      await targetRecording.stopAndUnloadAsync();
      recordingRef.current = null;
      const uri = targetRecording.getURI();
      const status = await targetRecording.getStatusAsync();
      if (!uri) throw new Error('Missing recording file');

      onSend({
        uri,
        durationMs: status.durationMillis || durationMs,
        fileName: `voice-${Date.now()}.m4a`,
        mimeType: 'audio/mp4',
        fileType: 'audio'
      });
    } catch {
      Alert.alert('Recording failed', 'Could not finish this voice message.');
      onCancel();
    } finally {
      setRecording(null);
      setBusy(false);
    }
  };

  const warningClass = durationMs > MAX_DURATION_MS - 20000
    ? 'text-red-500'
    : durationMs > MAX_DURATION_MS - 60000
      ? 'text-amber-400'
      : 'text-slate-950';

  return (
    <View className="flex-row items-center gap-3 rounded-3xl bg-slate-100 px-3 py-2">
      <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-white" disabled={busy} onPress={discard}>
        <X color="#DC2626" size={20} />
      </Pressable>
      <Animated.View className="h-4 w-4 rounded-full bg-red-500" style={pulseStyle} />
      <View className="min-w-0 flex-1">
        <Text className={`text-base font-bold ${warningClass}`}>
          {formatDuration(durationMs)}
        </Text>
        <Text className="text-xs text-slate-500" numberOfLines={1}>
          {locked ? 'Locked recording' : 'Recording voice message'}
        </Text>
      </View>
      <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-white" disabled={busy} onPress={() => setLocked(value => !value)}>
        <Lock color={locked ? '#0A7CFF' : '#64748B'} size={18} />
      </Pressable>
      <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-slate-200" disabled={busy} onPress={discard}>
        <Trash2 color="#64748B" size={18} />
      </Pressable>
      <Pressable className="h-11 w-11 items-center justify-center rounded-full bg-blue-600" disabled={busy} onPress={() => stopAndSend()}>
        {busy ? <Square color="#FFFFFF" fill="#FFFFFF" size={16} /> : <Send color="#FFFFFF" size={18} />}
      </Pressable>
    </View>
  );
}
