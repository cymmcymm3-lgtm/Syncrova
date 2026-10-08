import api from './api';
import type { User } from '../types';
import { getEntityId } from '../utils/ids';

export type CallMode = 'audio' | 'video';
export type CallState = 'idle' | 'incoming' | 'calling' | 'connecting' | 'connected';

export type CallParticipant = Pick<User, '_id' | 'id' | 'name' | 'email' | 'avatar' | 'profilePicture'>;

export type CallSignalPayload = {
  callId?: string;
  from?: string | User;
  to?: string | User;
  type?: CallMode;
  caller?: CallParticipant;
  provider?: string;
  livekit?: boolean;
  roomName?: string;
  accepted?: boolean;
  reason?: string;
};

export type LiveKitCallSession = {
  token: string;
  url: string;
  roomName: string;
};

export const createCallId = () => `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const serializeCallUser = (person?: User | null): CallParticipant => ({
  _id: getEntityId(person) || undefined,
  id: getEntityId(person) || undefined,
  name: person?.name,
  email: person?.email,
  avatar: person?.avatar,
  profilePicture: person?.profilePicture
});

export const requestLiveKitCallSession = async (payload: {
  callId: string;
  mode: CallMode;
  partnerId: string;
  roomName: string;
}): Promise<LiveKitCallSession> => {
  const res = await api.post<LiveKitCallSession>('/calls/livekit-token', payload);
  if (!res.data?.token || !res.data?.url) {
    throw new Error('LiveKit token is missing.');
  }

  return {
    token: res.data.token,
    url: res.data.url,
    roomName: res.data.roomName || payload.roomName
  };
};

export const getCallErrorMessage = (error: unknown, fallback: string) => {
  const responseMessage = (error as { response?: { data?: { msg?: string; message?: string } } })?.response?.data;
  const directMessage = (error as { message?: string })?.message;
  return responseMessage?.msg || responseMessage?.message || directMessage || fallback;
};
