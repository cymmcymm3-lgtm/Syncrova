import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Camera, ImagePlus, Mic, Send, X } from 'lucide-react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import VoiceRecorder from './VoiceRecorder';
import { useTheme } from '../theme/ThemeContext';
import type { VoiceRecordingResult } from '../utils/mediaHelpers';

type MessageInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onAttach: (assets: ImagePickerAsset[]) => void;
  onVoiceSend?: (recording: VoiceRecordingResult) => void;
  sending?: boolean;
  replyLabel?: string;
  editingLabel?: string;
  onClearReply?: () => void;
  onClearEdit?: () => void;
  containerBackgroundColor?: string;
  inputBackgroundColor?: string;
  buttonBackgroundColor?: string;
  borderColor?: string;
  iconColor?: string;
};

export default function MessageInput({
  value,
  onChangeText,
  onSend,
  onAttach,
  onVoiceSend,
  sending = false,
  replyLabel,
  editingLabel,
  onClearReply,
  onClearEdit,
  containerBackgroundColor,
  inputBackgroundColor,
  buttonBackgroundColor,
  borderColor,
  iconColor
}: MessageInputProps) {
  const { colors } = useTheme();
  const actionIconColor = iconColor || colors.primary;
  const [recordingVoice, setRecordingVoice] = useState(false);
  const scale = useSharedValue(1);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const canSend = Boolean(value.trim()) && !sending;

  const pickLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to attach media.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: false,
      quality: 0.72,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (!result.canceled) onAttach(result.assets);
  };

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to capture media.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.72,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (!result.canceled) onAttach(result.assets);
  };

  return (
    <View className="border-t" style={{ backgroundColor: containerBackgroundColor || colors.background, borderColor: borderColor || colors.border }}>
      <View className="px-3 pb-3 pt-2">
        {editingLabel ? (
          <View className="mb-2 flex-row items-center gap-2 rounded-2xl px-3 py-2" style={{ backgroundColor: colors.surface }}>
            <View className="h-8 w-1 rounded-full bg-amber-500" />
            <View className="min-w-0 flex-1">
              <Text className="text-[11px] font-semibold uppercase text-amber-700" numberOfLines={1}>
                Editing message
              </Text>
              <Text className="mt-0.5 text-xs" numberOfLines={2} style={{ color: colors.mutedText }}>
                {editingLabel}
              </Text>
            </View>
            <Pressable className="h-8 w-8 items-center justify-center rounded-full" onPress={onClearEdit} style={{ backgroundColor: colors.elevated }}>
              <X color={colors.mutedText} size={16} />
            </Pressable>
          </View>
        ) : replyLabel ? (
          <View className="mb-2 flex-row items-center gap-2 rounded-2xl px-3 py-2" style={{ backgroundColor: colors.surface }}>
            <View className="h-8 w-1 rounded-full" style={{ backgroundColor: colors.primary }} />
            <Text className="flex-1 text-xs" numberOfLines={2} style={{ color: colors.mutedText }}>
              {replyLabel}
            </Text>
            <Pressable className="h-8 w-8 items-center justify-center rounded-full" onPress={onClearReply} style={{ backgroundColor: colors.elevated }}>
              <X color={colors.mutedText} size={16} />
            </Pressable>
          </View>
        ) : null}

        {recordingVoice ? (
          <VoiceRecorder
            onCancel={() => setRecordingVoice(false)}
            onSend={recording => {
              setRecordingVoice(false);
              onVoiceSend?.(recording);
            }}
          />
        ) : (
        <View className="flex-row items-end gap-2">
          <Pressable className="h-11 w-11 items-center justify-center rounded-full" onPress={pickLibrary} style={{ backgroundColor: buttonBackgroundColor || colors.surface }}>
            <ImagePlus color={actionIconColor} size={22} />
          </Pressable>
          <Pressable className="h-11 w-11 items-center justify-center rounded-full" onPress={openCamera} style={{ backgroundColor: buttonBackgroundColor || colors.surface }}>
            <Camera color={actionIconColor} size={22} />
          </Pressable>
          <TextInput
            className="max-h-32 min-h-11 flex-1 rounded-3xl px-4 py-3 text-[15px]"
            multiline
            numberOfLines={1}
            onChangeText={onChangeText}
            placeholder="Message"
            placeholderTextColor={colors.mutedText}
            style={{ backgroundColor: inputBackgroundColor || colors.input, color: colors.text }}
            value={value}
          />
          {!value.trim() && onVoiceSend ? (
            <Pressable className="h-11 w-11 items-center justify-center rounded-full" onPress={() => setRecordingVoice(true)} style={{ backgroundColor: buttonBackgroundColor || colors.surface }}>
              <Mic color={actionIconColor} size={21} />
            </Pressable>
          ) : null}
          <Animated.View style={sendStyle}>
            <Pressable
              className="h-11 w-11 items-center justify-center rounded-full"
              disabled={!canSend}
              onPress={onSend}
              onPressIn={() => {
                scale.value = withSpring(0.88, { damping: 14, stiffness: 280 });
              }}
              onPressOut={() => {
                scale.value = withSpring(1, { damping: 14, stiffness: 280 });
              }}
              style={{ backgroundColor: canSend ? colors.primary : colors.border }}
            >
              {sending ? <ActivityIndicator color="white" size="small" /> : <Send color="white" size={19} />}
            </Pressable>
          </Animated.View>
        </View>
        )}
      </View>
    </View>
  );
}
