import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { FileText, Pin } from 'lucide-react-native';
import Avatar from './Avatar';
import ImageGridBubble from './ImageGridBubble';
import VoiceMessageBubble from './VoiceMessageBubble';
import { useTheme } from '../theme/ThemeContext';
import type { GroupMessage, Message, User } from '../types';
import { formatMessageTime } from '../utils/date';
import { getEntityId } from '../utils/ids';
import { getMessageAttachments, resolveMediaUrl } from '../utils/media';
import { isAudioAttachment, isMediaAttachment } from '../utils/mediaHelpers';

type ThreadMessage = Message | GroupMessage;

type ChatBubbleProps = {
  message: ThreadMessage;
  currentUserId: string;
  onReply: (message: ThreadMessage) => void;
  onAction?: (message: ThreadMessage) => void;
  onReactionPress?: (message: ThreadMessage) => void;
  groupMode?: boolean;
  highlighted?: boolean;
  ownBubbleColor?: string;
  otherBubbleColor?: string;
  onOpenMedia?: (message: ThreadMessage, index: number) => void;
  deliveryLabel?: string;
  fallbackSender?: User | null;
};

export default function ChatBubble({
  message,
  currentUserId,
  onReply,
  onAction,
  onReactionPress,
  groupMode = false,
  highlighted = false,
  ownBubbleColor,
  otherBubbleColor,
  onOpenMedia,
  deliveryLabel,
  fallbackSender
}: ChatBubbleProps) {
  const { colors } = useTheme();
  const sender = (message as GroupMessage).userId !== undefined ? (message as GroupMessage).userId : (message as Message).from;
  const isMe = getEntityId(sender) === currentUserId;
  const senderUser = typeof sender === 'object' ? sender : fallbackSender;
  const resolvedOwnBubbleColor = ownBubbleColor || colors.sentBubble;
  const resolvedOtherBubbleColor = otherBubbleColor || colors.receivedBubble;
  const translateX = useSharedValue(0);
  const attachments = getMessageAttachments(message as Message);
  const mediaAttachments = attachments.filter(isMediaAttachment);
  const audioAttachments = attachments.filter(isAudioAttachment);
  const fileAttachments = attachments.filter(attachment => !isMediaAttachment(attachment) && !isAudioAttachment(attachment));
  const replyMessage = typeof message.replyTo === 'object' ? message.replyTo : null;
  const senderName = typeof sender === 'object'
    ? sender?.name || sender?.email || 'Member'
    : fallbackSender?.name || fallbackSender?.email || 'Member';
  const clientStatus = (message as Message).clientStatus || (message as GroupMessage).clientStatus;
  const failed = clientStatus === 'failed';
  const pending = clientStatus === 'queued' || clientStatus === 'sending' || clientStatus === 'uploading';

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate(event => {
      const nextValue = isMe ? Math.min(0, Math.max(-72, event.translationX)) : Math.max(0, Math.min(72, event.translationX));
      translateX.value = nextValue;
    })
    .onEnd(() => {
      if ((!isMe && translateX.value > 48) || (isMe && translateX.value < -48)) runOnJS(onReply)(message);
      translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }]
  }));

  const openMenu = () => (onAction ? onAction(message) : onReply(message));

  if (message.system) {
    return (
      <Animated.View entering={FadeInDown.duration(120)} className="items-center px-8 py-2">
        <Text
          className="rounded-full px-3 py-1 text-center text-xs"
          numberOfLines={2}
          style={{ backgroundColor: colors.surface, color: colors.mutedText }}
        >
          {message.text}
        </Text>
      </Animated.View>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={FadeInDown.duration(120)}
        className="px-3 py-1"
        style={animatedStyle}
      >
        <View className={`flex-row items-end ${isMe ? 'justify-end' : 'justify-start'}`}>
          {!isMe ? (
            <View className="mr-2 w-8 items-center">
              <Avatar
                name={senderUser?.name || senderUser?.email || senderName}
                size={28}
                uri={senderUser?.avatar || senderUser?.profilePicture}
                user={senderUser || undefined}
              />
            </View>
          ) : null}

          <View className={isMe ? 'items-end' : 'items-start'} style={{ maxWidth: isMe ? '82%' : '76%' }}>
            {groupMode && !isMe ? (
              <Text className="mb-0.5 ml-2 text-[11px] font-semibold" numberOfLines={1} style={{ color: colors.mutedText }}>
                {senderName}
              </Text>
            ) : null}
            <Pressable
              className={`rounded-[22px] px-3.5 py-2.5 ${!isMe ? 'shadow-sm shadow-slate-200' : ''} ${highlighted ? 'border-2 border-amber-300' : ''}`}
              onLongPress={openMenu}
              style={[
                { backgroundColor: isMe ? resolvedOwnBubbleColor : resolvedOtherBubbleColor },
                pending ? { opacity: 0.78 } : null,
                failed ? { borderColor: colors.danger, borderWidth: 1 } : null
              ]}
            >
              {message.pinned ? (
                <View className={`mb-1 flex-row items-center gap-1 ${isMe ? 'self-end' : 'self-start'}`}>
                  <Pin color={isMe ? '#FFFFFF' : colors.mutedText} size={11} />
                  <Text className="text-[10px] font-semibold" style={{ color: isMe ? 'rgba(255,255,255,0.8)' : colors.mutedText }}>Pinned</Text>
                </View>
              ) : null}

          {replyMessage ? (
            <View
              className={`mb-2 rounded-2xl border-l-2 px-3 py-2 ${isMe ? 'border-white/70 bg-white/15' : 'border-blue-500'}`}
              style={!isMe ? { backgroundColor: colors.surface } : undefined}
            >
              <Text className="text-xs font-semibold" numberOfLines={1} style={{ color: isMe ? 'rgba(255,255,255,0.8)' : colors.primary }}>
                Reply
              </Text>
              <Text className="mt-0.5 text-xs" numberOfLines={2} style={{ color: isMe ? 'rgba(255,255,255,0.8)' : colors.mutedText }}>
                {replyMessage.text || 'Media message'}
              </Text>
            </View>
          ) : null}

          {mediaAttachments.length ? (
            <ImageGridBubble
              attachments={mediaAttachments}
              onOpen={index => onOpenMedia?.(message, index)}
            />
          ) : null}

          {audioAttachments.map((attachment, index) => (
            <VoiceMessageBubble
              attachment={attachment}
              id={`${getEntityId(message)}-audio-${index}`}
              isMe={isMe}
              key={`${attachment.fileUrl}-${index}`}
            />
          ))}

          {fileAttachments.map((attachment, index) => {
            const type = attachment.fileType || message.fileType;
            return (
              <Pressable
                key={`${attachment.fileUrl}-${index}`}
                className={`mb-2 flex-row items-center gap-2 rounded-2xl px-3 py-2 ${isMe ? 'bg-white/15' : ''}`}
                onPress={() => Linking.openURL(resolveMediaUrl(attachment.fileUrl)).catch(() => {})}
                style={!isMe ? { backgroundColor: colors.surface } : undefined}
              >
                <FileText color={isMe ? '#FFFFFF' : colors.primary} size={17} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold" numberOfLines={1} style={{ color: isMe ? '#FFFFFF' : colors.text }}>
                    {attachment.fileName || (type === 'video' ? 'Video' : 'Attachment')}
                  </Text>
                  <Text className="text-[11px]" numberOfLines={1} style={{ color: isMe ? 'rgba(255,255,255,0.7)' : colors.mutedText }}>
                    Tap to open
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {(message as Message).unsent ? (
            <Text className="text-sm italic" numberOfLines={3} style={{ color: isMe ? 'rgba(255,255,255,0.75)' : colors.mutedText }}>
              Message unsent
            </Text>
          ) : message.text ? (
            <Text className="text-[15px] leading-5" style={{ color: isMe ? '#FFFFFF' : colors.text }}>
              {message.text}
            </Text>
          ) : null}

          <Text className="mt-1 text-[10px]" numberOfLines={1} style={{ color: isMe ? 'rgba(255,255,255,0.7)' : colors.mutedText }}>
            {formatMessageTime(message.createdAt)}{deliveryLabel ? ` · ${deliveryLabel}` : ''}{message.editedAt ? ' · Edited' : ''}
          </Text>
            </Pressable>

            {message.reactions?.length ? (
              <Pressable
                className={`-mt-2 rounded-full px-2 py-0.5 shadow-sm shadow-slate-200 ${isMe ? 'mr-2' : 'ml-2'}`}
                onPress={() => onReactionPress?.(message)}
                style={{ backgroundColor: colors.elevated }}
              >
                <Text className="text-xs" numberOfLines={1}>
                  {message.reactions.map(reaction => reaction.emoji).join(' ')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
