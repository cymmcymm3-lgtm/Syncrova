import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioSession, isTrackReference, LiveKitRoom, useLocalParticipant, useTracks, VideoTrack } from '@livekit/react-native';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react-native';
import { Track } from 'livekit-client';
import Avatar from './Avatar';
import type { CallMode, CallParticipant, CallState, LiveKitCallSession } from '../services/calls';

type NativeCallOverlayProps = {
  cameraOff: boolean;
  callMode: CallMode;
  callState: CallState;
  callStatusText: string;
  error?: string;
  micMuted: boolean;
  onAccept: () => void;
  onCameraMutedChange: (muted: boolean) => void;
  onConnected: () => void;
  onEnd: () => void;
  onError: (message: string) => void;
  onMicMutedChange: (muted: boolean) => void;
  onReject: () => void;
  partner?: CallParticipant | null;
  session?: LiveKitCallSession | null;
};

type CallRoomProps = Omit<NativeCallOverlayProps, 'onAccept' | 'onReject' | 'session'>;

const getDisplayName = (person?: CallParticipant | null) => person?.name || person?.email || 'Syncrova user';

const CallControl = ({
  active,
  danger,
  icon,
  label,
  onPress
}: {
  active?: boolean;
  danger?: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityLabel={label}
    className={`h-14 min-w-14 items-center justify-center rounded-full px-4 ${
      danger ? 'bg-red-600' : active ? 'bg-amber-400' : 'bg-white/12'
    }`}
    onPress={onPress}
  >
    {icon}
  </Pressable>
);

const CallRoom = ({
  cameraOff,
  callMode,
  callState,
  callStatusText,
  error,
  micMuted,
  onCameraMutedChange,
  onEnd,
  onError,
  onMicMutedChange,
  partner
}: CallRoomProps) => {
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remoteCamera = cameraTracks.find(trackRef => (
    isTrackReference(trackRef) && !(trackRef.participant as { isLocal?: boolean }).isLocal
  ));
  const localCamera = cameraTracks.find(trackRef => (
    isTrackReference(trackRef) && (trackRef.participant as { isLocal?: boolean }).isLocal
  ));

  useEffect(() => {
    onMicMutedChange(!isMicrophoneEnabled);
  }, [isMicrophoneEnabled, onMicMutedChange]);

  useEffect(() => {
    onCameraMutedChange(!isCameraEnabled);
  }, [isCameraEnabled, onCameraMutedChange]);

  const toggleMic = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(micMuted);
      onMicMutedChange(!micMuted);
    } catch {
      onError('Could not update the microphone.');
    }
  };

  const toggleCamera = async () => {
    try {
      await localParticipant.setCameraEnabled(cameraOff);
      onCameraMutedChange(!cameraOff);
    } catch {
      onError('Could not update the camera.');
    }
  };

  return (
    <>
      {callMode === 'video' ? (
        <View className="relative mt-5 h-[390px] overflow-hidden rounded-[28px] bg-[#111114]">
          {remoteCamera ? (
            <VideoTrack objectFit="cover" style={styles.videoFill} trackRef={remoteCamera} />
          ) : (
            <View className="flex-1 items-center justify-center bg-[#111114] px-6">
              <Avatar name={getDisplayName(partner)} size={106} uri={partner?.avatar || partner?.profilePicture} />
              <Text className="mt-5 text-center text-xl font-black text-white" numberOfLines={1}>
                {getDisplayName(partner)}
              </Text>
              <Text className="mt-2 text-center text-sm font-semibold text-white/60">{callStatusText}</Text>
            </View>
          )}
          <View className="absolute bottom-4 right-4 h-36 w-24 overflow-hidden rounded-3xl border border-white/25 bg-black">
            {localCamera && !cameraOff ? (
              <VideoTrack mirror objectFit="cover" style={styles.videoFill} trackRef={localCamera} zOrder={1} />
            ) : (
              <View className="flex-1 items-center justify-center bg-[#17171a]">
                <VideoOff color="#FFFFFF" size={24} />
              </View>
            )}
          </View>
        </View>
      ) : (
        <View className="mt-5 min-h-[330px] items-center justify-center rounded-[28px] bg-[#111114] px-7">
          <Avatar name={getDisplayName(partner)} size={120} uri={partner?.avatar || partner?.profilePicture} />
          <Text className="mt-5 text-center text-2xl font-black text-white" numberOfLines={1}>
            {getDisplayName(partner)}
          </Text>
          <Text className="mt-2 text-center text-sm font-semibold text-white/60">{callStatusText}</Text>
        </View>
      )}

      {error ? (
        <Text className="mt-4 rounded-2xl bg-red-500/15 px-4 py-3 text-center text-sm font-semibold text-red-100">
          {error}
        </Text>
      ) : null}

      <View className="mt-5 flex-row items-center justify-center gap-3">
        <CallControl
          active={micMuted}
          icon={micMuted ? <MicOff color="#0F172A" size={22} /> : <Mic color="#FFFFFF" size={22} />}
          label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          onPress={toggleMic}
        />
        {callMode === 'video' ? (
          <CallControl
            active={cameraOff}
            icon={cameraOff ? <VideoOff color="#0F172A" size={22} /> : <Video color="#FFFFFF" size={22} />}
            label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            onPress={toggleCamera}
          />
        ) : null}
        <CallControl danger icon={<PhoneOff color="#FFFFFF" size={23} />} label="End call" onPress={onEnd} />
      </View>

      {callState === 'calling' || callState === 'connecting' ? (
        <View className="mt-4 flex-row items-center justify-center gap-2">
          <ActivityIndicator color="#FFFFFF" />
          <Text className="text-xs font-semibold text-white/55">LiveKit route connecting</Text>
        </View>
      ) : null}
    </>
  );
};

export default function NativeCallOverlay(props: NativeCallOverlayProps) {
  const {
    callMode,
    callState,
    callStatusText,
    error,
    onAccept,
    onEnd,
    onError,
    onReject,
    partner,
    session
  } = props;
  const connectedToRoom = Boolean(session?.url && session?.token && callState !== 'incoming');

  useEffect(() => {
    if (!connectedToRoom) return undefined;
    let mounted = true;
    AudioSession.startAudioSession().catch(() => {
      if (mounted) onError('Could not start the audio session.');
    });
    return () => {
      mounted = false;
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, [connectedToRoom, onError]);

  const qualityPills = useMemo(() => [
    'LiveKit route',
    callMode === 'video' ? 'Camera/mic' : 'Mic',
    connectedToRoom ? 'Native media' : callState === 'incoming' ? 'Incoming request' : 'Preparing'
  ], [callMode, callState, connectedToRoom]);

  return (
    <Modal animationType="fade" transparent visible={callState !== 'idle'} onRequestClose={callState === 'incoming' ? onReject : onEnd}>
      <View className="flex-1 justify-center bg-black/90 px-4 py-8">
        <View className="rounded-[30px] bg-[#08080a] p-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-black uppercase text-white/45">
                {callState === 'incoming' ? 'Incoming' : callMode === 'video' ? 'Video call' : 'Audio call'}
              </Text>
              <Text className="mt-1 text-xl font-black text-white" numberOfLines={1}>
                {getDisplayName(partner)}
              </Text>
              <Text className="mt-1 text-sm font-semibold text-white/60">{callStatusText}</Text>
            </View>
            <Pressable
              accessibilityLabel={callState === 'incoming' ? 'Decline call' : 'Close call'}
              className="h-10 w-10 items-center justify-center rounded-full bg-white/10"
              onPress={callState === 'incoming' ? onReject : onEnd}
            >
              <X color="#FFFFFF" size={20} />
            </Pressable>
          </View>

          <View className="mt-4 flex-row flex-wrap gap-2">
            {qualityPills.map(item => (
              <Text className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-white/65" key={item}>
                {item}
              </Text>
            ))}
          </View>

          {callState === 'incoming' || !connectedToRoom ? (
            <View className="mt-5 min-h-[330px] items-center justify-center rounded-[28px] bg-[#111114] px-7">
              <Avatar name={getDisplayName(partner)} size={120} uri={partner?.avatar || partner?.profilePicture} />
              <Text className="mt-5 text-center text-2xl font-black text-white" numberOfLines={1}>
                {getDisplayName(partner)}
              </Text>
              <Text className="mt-2 text-center text-sm font-semibold text-white/60">{error || callStatusText}</Text>
              {callState !== 'incoming' ? <ActivityIndicator className="mt-5" color="#FFFFFF" /> : null}
            </View>
          ) : (
            <LiveKitRoom
              audio
              connect
              connectOptions={{ autoSubscribe: true }}
              onConnected={props.onConnected}
              onError={roomError => onError(roomError.message || 'Call connection failed.')}
              options={{ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true }}
              serverUrl={session?.url}
              token={session?.token}
              video={callMode === 'video'}
            >
              <CallRoom {...props} />
            </LiveKitRoom>
          )}

          {callState === 'incoming' ? (
            <View className="mt-5 flex-row items-center justify-center gap-4">
              <Pressable
                accessibilityLabel="Decline call"
                className="h-14 min-w-32 flex-row items-center justify-center gap-2 rounded-full bg-red-600 px-5"
                onPress={onReject}
              >
                <PhoneOff color="#FFFFFF" size={20} />
                <Text className="font-black text-white">Decline</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Accept call"
                className="h-14 min-w-32 flex-row items-center justify-center gap-2 rounded-full bg-blue-600 px-5"
                onPress={onAccept}
              >
                {callMode === 'video' ? <Video color="#FFFFFF" size={20} /> : <Phone color="#FFFFFF" size={20} />}
                <Text className="font-black text-white">Accept</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  videoFill: {
    height: '100%',
    width: '100%'
  }
});
