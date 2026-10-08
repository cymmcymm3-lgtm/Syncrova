// @ts-nocheck
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Clock, History, Maximize2, Mic, MicOff, Minus, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from './AuthContext';
import { resolveMediaUrl } from '../utils/media';
import { playUiSound } from '../utils/sound';

const CallContext = createContext(null);
const CALL_HISTORY_KEY = 'syncrova-call-history';
const CALL_HISTORY_LIMIT = 40;
const CALL_SIGNAL_TIMEOUT_MS = 7000;
const CALL_SOCKET_READY_RETRIES = 3;
const TRACK_KIND_AUDIO = 'audio';
const TRACK_KIND_VIDEO = 'video';

let liveKitClientPromise = null;

const loadLiveKitClient = () => {
  if (!liveKitClientPromise) {
    liveKitClientPromise = import('livekit-client');
  }
  return liveKitClientPromise;
};

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '').trim();
const getDisplayName = (entity, fallback = 'User') => entity?.name || entity?.email || fallback;
const createCallId = () => `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const serializeCallUser = (person) => ({
  _id: getEntityId(person),
  id: getEntityId(person),
  name: person?.name || person?.email || 'User',
  email: person?.email || '',
  avatar: person?.avatar || person?.profilePicture || '',
  profilePicture: person?.profilePicture || person?.avatar || ''
});

const formatCallDuration = (seconds = 0) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const readCallHistory = () => {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(CALL_HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const writeCallHistory = (history) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CALL_HISTORY_KEY, JSON.stringify(history.slice(0, CALL_HISTORY_LIMIT)));
  } catch {
    // Call history is nice to have; storage failures should not affect calls.
  }
};

const delay = (ms) => new Promise(resolve => window.setTimeout(resolve, ms));

const waitForSocketConnection = (socket) => new Promise((resolve, reject) => {
  if (socket.connected) {
    resolve(socket);
    return;
  }

  let settled = false;
  let timer = null;
  const cleanup = () => {
    if (timer) window.clearTimeout(timer);
    socket.off('connect', handleConnect);
    socket.off('connect_error', handleError);
  };
  const finish = (callback) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback();
  };
  const handleConnect = () => finish(() => resolve(socket));
  const handleError = (err) => finish(() => reject(err || new Error('Socket connection failed.')));

  timer = window.setTimeout(() => handleError(new Error('Call signaling timed out.')), CALL_SIGNAL_TIMEOUT_MS);
  socket.once('connect', handleConnect);
  socket.once('connect_error', handleError);
  socket.connect();
});

const announceSocketOnline = (socket, currentUserId) => new Promise(resolve => {
  if (!currentUserId) {
    resolve(false);
    return;
  }

  const handleAck = (err, response) => {
    if (err) {
      resolve(false);
      return;
    }

    const users = Array.isArray(response)
      ? response
      : Array.isArray(response?.users)
        ? response.users
        : [];
    resolve(users.map(String).includes(String(currentUserId)));
  };

  if (typeof socket.timeout === 'function') {
    socket.timeout(CALL_SIGNAL_TIMEOUT_MS).emit('user-online', currentUserId, handleAck);
    return;
  }

  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    resolve(false);
  }, CALL_SIGNAL_TIMEOUT_MS);

  socket.emit('user-online', currentUserId, (response = []) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    const users = Array.isArray(response) ? response : response?.users || [];
    resolve(users.map(String).includes(String(currentUserId)));
  });
});

const playAttachedMedia = (element) => {
  try {
    const result = element?.play?.();
    if (result?.catch) result.catch(() => {});
  } catch {
    // Autoplay may be deferred by the WebView/browser until the next user gesture.
  }
};

const getCallMediaErrorMessage = (err, mode = 'audio') => {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `${mode === 'video' ? 'Camera and microphone' : 'Microphone'} permission is blocked. Allow it in app/browser settings, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return mode === 'video'
      ? 'No camera or microphone was found on this device.'
      : 'No microphone was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `${mode === 'video' ? 'Camera or microphone' : 'Microphone'} is being used by another app. Close it and try again.`;
  }
  return err?.message || 'Could not access microphone or camera.';
};

const getCallSetupErrorMessage = (err, fallback = 'Could not start the call.') => {
  const status = err?.response?.status;
  const serverMessage = err?.response?.data?.msg;
  if (status === 503) {
    return serverMessage || 'Calls are not configured on the server yet. Add the LiveKit environment variables and redeploy.';
  }
  if (serverMessage) return serverMessage;
  return err?.message || fallback;
};

const getCallStatusLabel = (entry = {}) => {
  if (entry.status === 'completed') return entry.durationSeconds > 0 ? formatCallDuration(entry.durationSeconds) : 'Completed';
  if (entry.status === 'missed') return entry.direction === 'incoming' ? 'Missed' : 'No answer';
  if (entry.status === 'declined') return entry.direction === 'incoming' ? 'Declined' : 'Declined by user';
  if (entry.status === 'busy') return 'Busy';
  if (entry.status === 'failed') return 'Failed';
  if (entry.status === 'canceled') return 'Canceled';
  return 'Ended';
};

function CallAvatar({ person, className = 'h-24 w-24', textSize = 34 }) {
  const avatar = person?.avatar || person?.profilePicture;
  const avatarSrc = avatar ? resolveMediaUrl(avatar) : '';
  const initials = String(person?.name || person?.email || 'U').trim().charAt(0).toUpperCase() || 'U';

  return (
    <span className={`${className} inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 font-black text-white ring-2 ring-white/20`}>
      {avatarSrc ? (
        <img src={avatarSrc} alt={person?.name || 'Caller'} className="h-full w-full object-cover" />
      ) : (
        <span style={{ fontSize: textSize }}>{initials}</span>
      )}
    </span>
  );
}

export function CallProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const currentUserId = getEntityId(user);
  const [mounted, setMounted] = useState(false);
  const [callState, setCallState] = useState('idle');
  const [callMode, setCallMode] = useState('audio');
  const [callPartner, setCallPartner] = useState(null);
  const [activeCallId, setActiveCallId] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const [callError, setCallError] = useState('');
  const [localStreamReady, setLocalStreamReady] = useState(false);
  const [remoteStreamReady, setRemoteStreamReady] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [callClock, setCallClock] = useState(Date.now());
  const [minimized, setMinimized] = useState(false);
  const [callHistory, setCallHistory] = useState(() => readCallHistory());
  const [connectionStatus, setConnectionStatus] = useState('idle');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const liveKitRoomRef = useRef(null);
  const liveKitTracksRef = useRef({ localVideo: null, remoteVideo: null, remoteAudio: null });
  const activeCallRef = useRef({ state: 'idle', callId: '', partnerId: '', mode: 'audio' });
  const callDirectionRef = useRef('');
  const callSessionStartedAtRef = useRef(0);
  const callStartedAtRef = useRef(null);
  const callAnsweredRef = useRef(false);

  const callIsActive = callState !== 'idle';
  const callPartnerName = getDisplayName(callPartner, 'Caller');
  const callDurationText = callStartedAt ? formatCallDuration(Math.floor((callClock - callStartedAt) / 1000)) : '';

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    callStartedAtRef.current = callStartedAt;
  }, [callStartedAt]);

  useEffect(() => {
    activeCallRef.current = {
      state: callState,
      callId: activeCallId,
      partnerId: getEntityId(callPartner),
      mode: callMode
    };
  }, [activeCallId, callMode, callPartner, callState]);

  useEffect(() => {
    if (!callStartedAt) return undefined;
    const timer = window.setInterval(() => setCallClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [callStartedAt]);

  useEffect(() => {
    if (callState !== 'incoming') return undefined;
    playUiSound('ringtone', 0.6);
    const timer = window.setInterval(() => playUiSound('ringtone', 0.6), 1800);
    return () => window.clearInterval(timer);
  }, [callState]);

  const saveHistoryEntry = useCallback((entry) => {
    if (!entry?.callId) return;
    setCallHistory(prev => {
      const withoutDuplicate = prev.filter(item => item.callId !== entry.callId);
      const next = [entry, ...withoutDuplicate].slice(0, CALL_HISTORY_LIMIT);
      writeCallHistory(next);
      return next;
    });
  }, []);

  const finishHistoryForActiveCall = useCallback((status = 'completed', reason = '') => {
    const active = activeCallRef.current;
    if (!active.callId || !callDirectionRef.current) return;
    const endedAt = Date.now();
    const connectedAt = callStartedAtRef.current;
    const durationSeconds = connectedAt ? Math.max(0, Math.floor((endedAt - connectedAt) / 1000)) : 0;
    const finalStatus = status === 'completed' && !callAnsweredRef.current
      ? (callDirectionRef.current === 'incoming' ? 'missed' : 'canceled')
      : status;

    saveHistoryEntry({
      id: `${active.callId}-${endedAt}`,
      callId: active.callId,
      partner: callPartner || { _id: active.partnerId, id: active.partnerId, name: callPartnerName },
      partnerId: active.partnerId,
      mode: active.mode,
      direction: callDirectionRef.current,
      status: finalStatus,
      reason,
      startedAt: new Date(callSessionStartedAtRef.current || endedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSeconds
    });
  }, [callPartner, callPartnerName, saveHistoryEntry]);

  const ensureCallSocketReady = useCallback(async () => {
    const activeSocket = getSocket();
    await waitForSocketConnection(activeSocket);

    for (let attempt = 0; attempt < CALL_SOCKET_READY_RETRIES; attempt += 1) {
      const registered = await announceSocketOnline(activeSocket, currentUserId);
      if (registered) return activeSocket;
      await delay(180 * (attempt + 1));
    }

    throw new Error('Call signaling is still reconnecting. Please try again.');
  }, [currentUserId]);

  const emitCallSignal = useCallback(async (eventName, payload = {}) => {
    const activeSocket = await ensureCallSocketReady();
    activeSocket.emit(eventName, payload);
    return true;
  }, [ensureCallSocketReady]);

  const clearLiveKitTracks = useCallback(() => {
    Object.values(liveKitTracksRef.current || {}).forEach(track => {
      try {
        track?.detach?.();
      } catch {
        // Tracks may already be detached by the SDK.
      }
    });
    liveKitTracksRef.current = { localVideo: null, remoteVideo: null, remoteAudio: null };
  }, []);

  const attachLiveKitMedia = useCallback(() => {
    const { localVideo, remoteVideo, remoteAudio } = liveKitTracksRef.current || {};
    if (localVideoRef.current && localVideo) {
      localVideo.attach(localVideoRef.current);
      localVideoRef.current.muted = true;
      localVideoRef.current.playsInline = true;
      playAttachedMedia(localVideoRef.current);
    }
    if (remoteVideoRef.current && remoteVideo) {
      remoteVideo.attach(remoteVideoRef.current);
      remoteVideoRef.current.playsInline = true;
      playAttachedMedia(remoteVideoRef.current);
    }
    if (remoteAudioRef.current && remoteAudio) {
      remoteAudio.attach(remoteAudioRef.current);
      remoteAudioRef.current.autoplay = true;
      playAttachedMedia(remoteAudioRef.current);
    }
  }, []);

  const cleanupCallMedia = useCallback(() => {
    const liveKitRoom = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    clearLiveKitTracks();
    if (liveKitRoom) {
      liveKitRoom.removeAllListeners?.();
      liveKitRoom.disconnect();
    }
    [localVideoRef, remoteVideoRef, remoteAudioRef].forEach(ref => {
      if (ref.current) ref.current.srcObject = null;
    });
    setLocalStreamReady(false);
    setRemoteStreamReady(false);
    setConnectionStatus('idle');
  }, [clearLiveKitTracks]);

  const resetCall = useCallback((nextError = '') => {
    cleanupCallMedia();
    activeCallRef.current = { state: 'idle', callId: '', partnerId: '', mode: 'audio' };
    callDirectionRef.current = '';
    callSessionStartedAtRef.current = 0;
    callStartedAtRef.current = null;
    callAnsweredRef.current = false;
    setCallState('idle');
    setCallMode('audio');
    setCallPartner(null);
    setActiveCallId('');
    setIncomingCall(null);
    setCallError(nextError);
    setLocalStreamReady(false);
    setRemoteStreamReady(false);
    setMicMuted(false);
    setCameraOff(false);
    setCallStartedAt(null);
    setMinimized(false);
  }, [cleanupCallMedia]);

  const markCallConnected = useCallback(() => {
    callAnsweredRef.current = true;
    activeCallRef.current = { ...activeCallRef.current, state: 'connected' };
    setCallState('connected');
    setCallStartedAt(prev => prev || Date.now());
    setCallError('');
  }, []);

  const setLiveKitRemoteTrack = useCallback((track) => {
    if (!track) return;
    if (track.kind === TRACK_KIND_VIDEO) {
      liveKitTracksRef.current.remoteVideo?.detach?.();
      liveKitTracksRef.current.remoteVideo = track;
      setRemoteStreamReady(true);
      attachLiveKitMedia();
      return;
    }

    if (track.kind === TRACK_KIND_AUDIO) {
      liveKitTracksRef.current.remoteAudio?.detach?.();
      liveKitTracksRef.current.remoteAudio = track;
      if (activeCallRef.current.mode !== 'video') setRemoteStreamReady(true);
      attachLiveKitMedia();
    }
  }, [attachLiveKitMedia]);

  const connectLiveKitCall = useCallback(async ({ mode, partnerId, callId, roomName }) => {
    cleanupCallMedia();
    setConnectionStatus('connecting');

    const res = await api.post('/calls/livekit-token', {
      callId,
      roomName,
      mode,
      partnerId
    });
    const livekitUrl = res.data?.url;
    const token = res.data?.token;
    const nextRoomName = res.data?.roomName || roomName || `syncrova-call-${callId}`;
    if (!livekitUrl || !token) throw new Error('LiveKit token is missing.');

    const { ConnectionState, Room, RoomEvent, Track } = await loadLiveKitClient();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    liveKitRoomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, track => {
      setLiveKitRemoteTrack(track);
    });

    room.on(RoomEvent.TrackUnsubscribed, track => {
      try {
        track?.detach?.();
      } catch {
        // Ignore SDK detach races.
      }
      if (liveKitTracksRef.current.remoteVideo === track) {
        liveKitTracksRef.current.remoteVideo = null;
        if (activeCallRef.current.mode === 'video') setRemoteStreamReady(false);
      }
      if (liveKitTracksRef.current.remoteAudio === track) {
        liveKitTracksRef.current.remoteAudio = null;
        if (activeCallRef.current.mode !== 'video') setRemoteStreamReady(false);
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, () => {
      setRemoteStreamReady(false);
      if (activeCallRef.current.state === 'connected') setCallError('The other participant left the call.');
    });

    room.on(RoomEvent.ConnectionStateChanged, state => {
      setConnectionStatus(String(state || '').toLowerCase());
      if (state === ConnectionState.Connected) setCallError('');
      if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
        setCallError('Reconnecting call...');
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      if (liveKitRoomRef.current !== room) return;
      if (activeCallRef.current.state !== 'idle') setCallError('Call connection closed.');
    });

    try {
      await room.connect(livekitUrl, token, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);
      setLocalStreamReady(true);
      setMicMuted(false);

      if (mode === 'video') {
        const publication = await room.localParticipant.setCameraEnabled(true);
        liveKitTracksRef.current.localVideo = publication?.track
          || room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
          || null;
        setCameraOff(false);
        attachLiveKitMedia();
      } else {
        setCameraOff(true);
      }

      room.remoteParticipants.forEach(participant => {
        participant.trackPublications.forEach(publication => {
          if (publication.track) setLiveKitRemoteTrack(publication.track);
        });
      });
    } catch (err) {
      throw new Error(getCallMediaErrorMessage(err, mode));
    }

    return { roomName: nextRoomName };
  }, [attachLiveKitMedia, cleanupCallMedia, markCallConnected, setLiveKitRemoteTrack]);

  const startCall = useCallback(async (person, mode = 'audio') => {
    const partnerId = getEntityId(person);
    if (!isAuthenticated || !currentUserId || !partnerId) return false;
    if (partnerId === currentUserId) {
      toast.error('You cannot call yourself.');
      return false;
    }
    if (activeCallRef.current.state !== 'idle') {
      toast.error('Finish your current call first.');
      return false;
    }
    const nextCallId = createCallId();
    const partner = serializeCallUser(person);
    const caller = serializeCallUser(user);

    activeCallRef.current = { state: 'calling', callId: nextCallId, partnerId, mode };
    callDirectionRef.current = 'outgoing';
    callSessionStartedAtRef.current = Date.now();
    callAnsweredRef.current = false;
    setCallState('calling');
    setCallMode(mode);
    setCallPartner(partner);
    setActiveCallId(nextCallId);
    setIncomingCall(null);
    setCallError('');
    setMinimized(false);

    try {
      await ensureCallSocketReady();
      const roomName = `syncrova-call-${nextCallId}`;
      const livekit = await connectLiveKitCall({ mode, partnerId, callId: nextCallId, roomName });
      await emitCallSignal('call:start', {
        callId: nextCallId,
        from: currentUserId,
        to: partnerId,
        type: mode,
        caller,
        provider: 'livekit',
        livekit: true,
        roomName: livekit.roomName
      });
      setCallState('connecting');
      return true;
    } catch (err) {
      const message = getCallSetupErrorMessage(err, 'Could not start the call.');
      finishHistoryForActiveCall('failed', message);
      resetCall(message);
      toast.error(message);
      return false;
    }
  }, [connectLiveKitCall, currentUserId, emitCallSignal, ensureCallSocketReady, finishHistoryForActiveCall, isAuthenticated, resetCall, user]);

  const acceptCall = useCallback(async () => {
    const pendingCall = incomingCall;
    const callerId = getEntityId(pendingCall?.from);
    const nextCallId = pendingCall?.callId;
    const mode = pendingCall?.type || 'audio';
    if (!pendingCall || !callerId || !nextCallId) return;

    activeCallRef.current = { state: 'connecting', callId: nextCallId, partnerId: callerId, mode };
    callAnsweredRef.current = false;
    setCallState('connecting');
    setCallMode(mode);
    setCallPartner(pendingCall.caller || { _id: callerId, id: callerId, name: 'Caller' });
    setActiveCallId(nextCallId);
    setCallError('');
    setMinimized(false);

    try {
      await ensureCallSocketReady();
      const livekit = await connectLiveKitCall({
        mode,
        partnerId: callerId,
        callId: nextCallId,
        roomName: pendingCall.roomName || `syncrova-call-${nextCallId}`
      });
      await emitCallSignal('call:answer', {
        callId: nextCallId,
        from: currentUserId,
        to: callerId,
        type: mode,
        accepted: true,
        provider: 'livekit',
        livekit: true,
        roomName: livekit.roomName
      });
      setIncomingCall(null);
      markCallConnected();
    } catch (err) {
      const message = getCallSetupErrorMessage(err, 'Could not join the call.');
      void emitCallSignal('call:reject', {
        callId: nextCallId,
        from: currentUserId,
        to: callerId,
        type: mode,
        reason: 'media-error'
      }).catch(() => {});
      finishHistoryForActiveCall('failed', message);
      resetCall(message);
      toast.error(message);
    }
  }, [connectLiveKitCall, currentUserId, emitCallSignal, ensureCallSocketReady, finishHistoryForActiveCall, incomingCall, markCallConnected, resetCall]);

  const endCall = useCallback((reason = 'ended', notify = true) => {
    const active = activeCallRef.current;
    if (notify && active.callId && active.partnerId && currentUserId) {
      void emitCallSignal('call:end', {
        callId: active.callId,
        from: currentUserId,
        to: active.partnerId,
        type: active.mode,
        reason
      }).catch(() => {});
    }
    finishHistoryForActiveCall(reason === 'timeout' ? 'missed' : 'completed', reason);
    resetCall();
  }, [currentUserId, emitCallSignal, finishHistoryForActiveCall, resetCall]);

  const rejectCall = useCallback((reason = 'declined') => {
    const pending = incomingCall || activeCallRef.current;
    const partnerId = getEntityId(pending.from || pending.partnerId);
    const nextCallId = pending.callId;
    const mode = pending.type || pending.mode || callMode;
    if (nextCallId && partnerId && currentUserId) {
      void emitCallSignal('call:reject', {
        callId: nextCallId,
        from: currentUserId,
        to: partnerId,
        type: mode,
        reason
      }).catch(() => {});
    }
    finishHistoryForActiveCall(reason === 'declined' ? 'declined' : 'canceled', reason);
    resetCall();
  }, [callMode, currentUserId, emitCallSignal, finishHistoryForActiveCall, incomingCall, resetCall]);

  const toggleCallMic = useCallback(async () => {
    const room = liveKitRoomRef.current;
    if (!room) return;
    const nextMuted = !micMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
      setMicMuted(nextMuted);
      setLocalStreamReady(true);
    } catch {
      toast.error('Could not update microphone.');
    }
  }, [micMuted]);

  const toggleCallCamera = useCallback(async () => {
    const room = liveKitRoomRef.current;
    if (!room) return;
    const nextCameraOff = !cameraOff;
    try {
      const publication = await room.localParticipant.setCameraEnabled(!nextCameraOff);
      if (nextCameraOff) {
        liveKitTracksRef.current.localVideo?.detach?.();
        liveKitTracksRef.current.localVideo = null;
      } else {
        const { Track } = await loadLiveKitClient();
        liveKitTracksRef.current.localVideo = publication?.track
          || room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
          || null;
        attachLiveKitMedia();
      }
      setCameraOff(nextCameraOff);
    } catch {
      toast.error('Could not update camera.');
    }
  }, [attachLiveKitMedia, cameraOff]);

  const handleIncomingCallStart = useCallback((payload = {}) => {
    const fromId = getEntityId(payload.from);
    const toId = getEntityId(payload.to);
    if (!fromId || fromId === currentUserId || (toId && toId !== currentUserId)) return;

    if (activeCallRef.current.state !== 'idle') {
      void emitCallSignal('call:busy', {
        callId: payload.callId,
        from: currentUserId,
        to: fromId,
        type: payload.type || 'audio',
        reason: 'busy'
      }).catch(() => {});
      return;
    }

    const nextCallId = payload.callId || createCallId();
    const mode = payload.type || 'audio';
    const caller = payload.caller || { _id: fromId, id: fromId, name: payload.callerName || 'Incoming call' };

    activeCallRef.current = { state: 'incoming', callId: nextCallId, partnerId: fromId, mode };
    callDirectionRef.current = 'incoming';
    callSessionStartedAtRef.current = Date.now();
    callAnsweredRef.current = false;
    setCallState('incoming');
    setCallMode(mode);
    setCallPartner(caller);
    setActiveCallId(nextCallId);
    setIncomingCall({
      ...payload,
      callId: nextCallId,
      from: fromId,
      type: mode,
      caller,
      provider: 'livekit',
      livekit: true,
      roomName: payload.roomName || `syncrova-call-${nextCallId}`
    });
    setCallError('');
    setMinimized(false);
  }, [currentUserId, emitCallSignal]);

  const handleCallAnswer = useCallback((payload = {}) => {
    const active = activeCallRef.current;
    if (payload.callId !== active.callId) return;
    markCallConnected();
  }, [markCallConnected]);

  const handleRemoteCallEnd = useCallback((payload = {}) => {
    if (payload.callId && payload.callId !== activeCallRef.current.callId) return;
    finishHistoryForActiveCall('completed', payload.reason || 'remote-ended');
    resetCall();
    if (payload.reason !== 'replaced') toast.success('Call ended');
  }, [finishHistoryForActiveCall, resetCall]);

  const handleRemoteCallRejected = useCallback((payload = {}) => {
    if (payload.callId && payload.callId !== activeCallRef.current.callId) return;
    const status = payload.reason === 'busy' ? 'busy' : 'declined';
    finishHistoryForActiveCall(status, payload.reason || status);
    resetCall(payload.reason === 'busy' ? 'User is on another call.' : '');
    toast.error(payload.reason === 'busy' ? 'User is on another call.' : 'Call declined');
  }, [finishHistoryForActiveCall, resetCall]);

  const handleCallUnavailable = useCallback((payload = {}) => {
    if (payload.callId && payload.callId !== activeCallRef.current.callId) return;
    finishHistoryForActiveCall('failed', payload.reason || 'offline');
    resetCall('User is offline right now.');
    toast.error('User is offline right now.');
  }, [finishHistoryForActiveCall, resetCall]);

  useEffect(() => {
    if (!activeCallId || !['calling', 'connecting'].includes(callState)) return undefined;
    const expectedCallId = activeCallId;
    const timer = window.setTimeout(() => {
      const active = activeCallRef.current;
      if (active.callId !== expectedCallId || !['calling', 'connecting'].includes(active.state)) return;
      endCall('timeout');
      toast.error('Call timed out. Please try again.');
    }, 35000);

    return () => window.clearTimeout(timer);
  }, [activeCallId, callState, endCall]);

  useEffect(() => {
    if (!isAuthenticated || !currentUserId) {
      cleanupCallMedia();
      resetCall();
      return undefined;
    }

    const socket = getSocket();
    socket.on('call:start', handleIncomingCallStart);
    socket.on('call:answer', handleCallAnswer);
    socket.on('call:end', handleRemoteCallEnd);
    socket.on('call:reject', handleRemoteCallRejected);
    socket.on('call:busy', handleRemoteCallRejected);
    socket.on('call:unavailable', handleCallUnavailable);
    if (!socket.connected) socket.connect();

    return () => {
      socket.off('call:start', handleIncomingCallStart);
      socket.off('call:answer', handleCallAnswer);
      socket.off('call:end', handleRemoteCallEnd);
      socket.off('call:reject', handleRemoteCallRejected);
      socket.off('call:busy', handleRemoteCallRejected);
      socket.off('call:unavailable', handleCallUnavailable);
    };
  }, [
    cleanupCallMedia,
    currentUserId,
    handleCallAnswer,
    handleCallUnavailable,
    handleIncomingCallStart,
    handleRemoteCallEnd,
    handleRemoteCallRejected,
    isAuthenticated,
    resetCall
  ]);

  useEffect(() => () => cleanupCallMedia(), [cleanupCallMedia]);

  const callStatusText = callState === 'incoming'
    ? `${callMode === 'video' ? 'Video' : 'Audio'} call`
    : callState === 'calling'
      ? 'Ringing...'
      : callState === 'connecting'
        ? 'Connecting...'
        : callState === 'connected'
          ? callDurationText || 'Connected'
          : callError || '';

  const callQualityPills = [
    'LiveKit route',
    localStreamReady ? (callMode === 'video' ? 'Camera/mic ready' : 'Mic ready') : 'Waiting for permission',
    remoteStreamReady ? 'Remote media live' : callState === 'incoming' ? 'Incoming request' : 'Waiting for remote',
    connectionStatus && connectionStatus !== 'idle' ? connectionStatus : ''
  ].filter(Boolean);

  const canCallUser = useCallback((personOrId) => {
    const id = getEntityId(personOrId);
    return Boolean(id && id !== currentUserId && !callIsActive);
  }, [callIsActive, currentUserId]);

  const value = useMemo(() => ({
    callHistory,
    callIsActive,
    callMode,
    callPartner,
    callState,
    canCallUser,
    endCall,
    formatCallDuration,
    getCallStatusLabel,
    startCall
  }), [callHistory, callIsActive, callMode, callPartner, callState, canCallUser, endCall, startCall]);

  const overlay = callIsActive ? (
    minimized ? (
      <div className="fixed bottom-4 right-4 z-[130] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#08080a] text-white shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 p-3">
          <CallAvatar person={callPartner} className="h-12 w-12" textSize={18} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black">{callPartnerName}</p>
            <p className="truncate text-xs font-semibold text-white/60">{callStatusText}</p>
          </div>
          <button type="button" onClick={() => setMinimized(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/15" aria-label="Open call">
            <Maximize2 size={16} />
          </button>
          <button type="button" onClick={() => (callState === 'incoming' ? rejectCall() : endCall())} className="grid h-9 w-9 place-items-center rounded-full bg-rose-600 text-white hover:bg-rose-500" aria-label="End call">
            <PhoneOff size={16} />
          </button>
        </div>
      </div>
    ) : (
      <div className="call-overlay fixed inset-0 z-[125] flex items-center justify-center bg-black/84 p-3 backdrop-blur-sm sm:p-4">
        <div className="call-shell w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#08080a] text-white shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-sky-300">
                {callMode === 'video' ? 'Video call' : 'Audio call'}
              </p>
              <h3 className="truncate text-xl font-black">{callPartnerName}</h3>
              <p className="mt-0.5 text-sm font-semibold text-slate-300">{callStatusText}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {callQualityPills.map(item => (
                  <span key={item} className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-white/75 ring-1 ring-white/10">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setMinimized(true)} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-slate-200 transition hover:bg-white/15" aria-label="Minimize call">
                <Minus size={18} />
              </button>
              <button type="button" onClick={() => (callState === 'incoming' ? rejectCall() : endCall())} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-slate-200 transition hover:bg-white/15" aria-label="Close call">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="call-body p-5">
            {callMode === 'video' ? (
              <div className="call-video-stage relative aspect-video overflow-hidden rounded-3xl bg-[#111114] ring-1 ring-white/10">
                <audio ref={remoteAudioRef} autoPlay className="hidden" />
                <video ref={remoteVideoRef} autoPlay playsInline className={`h-full w-full object-cover ${remoteStreamReady ? 'opacity-100' : 'opacity-0'}`} />
                {!remoteStreamReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#111114] to-[#050505] text-center">
                    <CallAvatar person={callPartner} className="h-24 w-24" textSize={40} />
                    <p className="mt-4 text-lg font-black">{callPartnerName}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-400">{callStatusText}</p>
                  </div>
                )}
                {localStreamReady && (
                  <div className="call-self-preview absolute bottom-4 right-4 h-28 w-20 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-xl sm:h-36 sm:w-28">
                    <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                    {cameraOff && (
                      <div className="absolute inset-0 grid place-items-center bg-[#111114]/95">
                        <VideoOff size={22} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="call-audio-stage flex min-h-[18rem] flex-col items-center justify-center rounded-3xl bg-gradient-to-br from-[#111114] to-[#050505] p-8 text-center ring-1 ring-white/10">
                <CallAvatar person={callPartner} className="h-28 w-28" textSize={46} />
                <h3 className="mt-5 max-w-full truncate text-2xl font-black">{callPartnerName}</h3>
                <p className="mt-2 text-sm font-semibold text-slate-300">{callStatusText}</p>
                <audio ref={remoteAudioRef} autoPlay />
              </div>
            )}

            {callError && (
              <p className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 ring-1 ring-rose-400/20">
                {callError}
              </p>
            )}

            <div className="mt-5 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-white/55">
                <History size={14} />
                Recent call notes
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {callHistory.slice(0, 3).map(entry => (
                  <div key={entry.id} className="rounded-xl bg-black/24 px-3 py-2 text-xs">
                    <p className="truncate font-black text-white/85">{entry.direction === 'incoming' ? 'Incoming' : 'Outgoing'} {entry.mode}</p>
                    <p className="mt-0.5 flex items-center gap-1 font-semibold text-white/55">
                      <Clock size={12} />
                      {getCallStatusLabel(entry)}
                    </p>
                  </div>
                ))}
                {!callHistory.length && <p className="text-sm font-semibold text-white/55">Call history starts after your first call.</p>}
              </div>
            </div>

            <div className="call-actions mt-5 flex flex-wrap items-center justify-center gap-3">
              {callState === 'incoming' ? (
                <>
                  <button type="button" onClick={() => rejectCall()} className="flex h-12 min-w-32 items-center justify-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-black text-white transition hover:bg-rose-500">
                    <PhoneOff size={18} />
                    Decline
                  </button>
                  <button type="button" onClick={acceptCall} className="flex h-12 min-w-32 items-center justify-center gap-2 rounded-full bg-[#1877f2] px-5 text-sm font-black text-white transition hover:bg-blue-500">
                    {callMode === 'video' ? <Video size={18} /> : <Phone size={18} />}
                    Accept
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={toggleCallMic} className={`grid h-12 w-12 place-items-center rounded-full transition ${micMuted ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white hover:bg-white/15'}`} aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}>
                    {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                  {callMode === 'video' && (
                    <button type="button" onClick={toggleCallCamera} className={`grid h-12 w-12 place-items-center rounded-full transition ${cameraOff ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white hover:bg-white/15'}`} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
                      {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                    </button>
                  )}
                  <button type="button" onClick={() => endCall()} className="flex h-12 min-w-36 items-center justify-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-black text-white transition hover:bg-rose-500">
                    <PhoneOff size={18} />
                    End call
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  ) : null;

  return (
    <CallContext.Provider value={value}>
      {children}
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </CallContext.Provider>
  );
}

export const useCall = () => useContext(CallContext) || {
  callHistory: [],
  callIsActive: false,
  callMode: 'audio',
  callPartner: null,
  callState: 'idle',
  canCallUser: () => false,
  endCall: () => {},
  formatCallDuration,
  getCallStatusLabel,
  startCall: () => false
};
