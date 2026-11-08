import { create } from 'zustand';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import type { Call, Chat, IceServer } from '../types';
import { useApp } from './useApp';

type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'active';

type CallState = {
  status: CallStatus;
  call: Call | null;
  chat: Chat | null;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  muted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  startedAt: number | null;
  error: string | null;

  bind: () => void;
  start: (chat: Chat, kind: 'audio' | 'video') => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleShare: () => Promise<void>;
};

let peers = new Map<string, RTCPeerConnection>();
let pendingIce = new Map<string, RTCIceCandidateInit[]>();
let iceServers: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
let ringTimer: number | null = null;
let ringInterval: number | null = null;
let audioContext: AudioContext | null = null;

function currentUserId(): string | null {
  return useApp.getState().user?.id ?? null;
}

function stopRing(): void {
  if (ringTimer) window.clearTimeout(ringTimer);
  if (ringInterval) window.clearInterval(ringInterval);
  ringTimer = null;
  ringInterval = null;
}

function playRing(): void {
  try {
    audioContext ??= new AudioContext();
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume();

    const beep = () => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = 660;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.55);
    };

    beep();
    ringInterval = window.setInterval(beep, 1800);
  } catch {
    // Ringing is a nicety; ignore audio failures.
  }
}

async function loadIce(): Promise<void> {
  try {
    const result = await api<{ iceServers: IceServer[] }>('/calls/ice');
    if (result.iceServers.length > 0) iceServers = result.iceServers;
  } catch {
    // Keep the STUN fallback.
  }
}

function closePeer(peerId: string): void {
  const pc = peers.get(peerId);
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
    peers.delete(peerId);
  }
  pendingIce.delete(peerId);

  const state = useCall.getState();
  const { [peerId]: _removed, ...rest } = state.remoteStreams;
  useCall.setState({ remoteStreams: rest });
}

function closeAllPeers(): void {
  for (const peerId of [...peers.keys()]) closePeer(peerId);
}

function cleanup(): void {
  stopRing();
  closeAllPeers();

  const state = useCall.getState();
  state.localStream?.getTracks().forEach((track) => track.stop());
  useCall.setState({
    status: 'idle',
    call: null,
    chat: null,
    localStream: null,
    remoteStreams: {},
    muted: false,
    cameraOn: true,
    sharing: false,
    startedAt: null,
    error: null,
  });
}

async function ensurePeer(peerId: string, initiate: boolean, kind: 'audio' | 'video'): Promise<void> {
  const state = useCall.getState();
  const socket = getSocket();
  if (!socket || !state.call || !state.localStream) return;

  if (peers.has(peerId)) {
    if (initiate) {
      const pc = peers.get(peerId)!;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:signal', {
        callId: state.call.id,
        to: peerId,
        data: { type: 'offer', sdp: pc.localDescription },
      });
    }
    return;
  }

  const pc = new RTCPeerConnection({ iceServers });
  peers.set(peerId, pc);

  for (const track of state.localStream.getTracks()) {
    pc.addTrack(track, state.localStream);
  }

  if (kind === 'video') {
    pc.addTransceiver('video', { direction: 'sendrecv' });
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    socket.emit('call:signal', {
      callId: state.call!.id,
      to: peerId,
      data: { type: 'ice', candidate: event.candidate.toJSON() },
    });
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (!stream) return;
    useCall.setState({ remoteStreams: { ...useCall.getState().remoteStreams, [peerId]: stream } });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      pc.restartIce();
    }
  };

  if (initiate) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call:signal', {
      callId: state.call.id,
      to: peerId,
      data: { type: 'offer', sdp: pc.localDescription },
    });
  }
}

export const useCall = create<CallState>((set, get) => ({
  status: 'idle',
  call: null,
  chat: null,
  localStream: null,
  remoteStreams: {},
  muted: false,
  cameraOn: true,
  sharing: false,
  startedAt: null,
  error: null,

  bind: () => {
    const socket = getSocket();
    if (!socket) return;

    socket.off('call:incoming');
    socket.off('call:state');
    socket.off('call:signal');

    socket.on('call:incoming', (payload: { call: Call; chat: Chat; from: string }) => {
      if (get().status !== 'idle') return;
      set({ status: 'incoming', call: payload.call, chat: payload.chat, error: null });
      playRing();
      ringTimer = window.setTimeout(() => {
        void get().decline();
      }, 45_000);
    });

    socket.on(
      'call:state',
      (payload: {
        call: Call;
        state: 'joined' | 'left' | 'ended' | 'declined';
        userId: string;
        participants?: string[];
      }) => {
        const state = get();
        if (!state.call || state.call.id !== payload.call.id) return;

        if (payload.state === 'ended' || payload.state === 'declined') {
          cleanup();
          return;
        }

        if (payload.state === 'joined') {
          if (state.status === 'outgoing') {
            stopRing();
            set({ status: 'active', startedAt: Date.now() });
          }
          if (payload.userId !== currentUserId()) {
            const me = currentUserId();
            const polite = Boolean(me && me < payload.userId);
            void ensurePeer(payload.userId, polite, state.call.kind);
          }
          return;
        }

        if (payload.state === 'left') {
          closePeer(payload.userId);
          if (Object.keys(get().remoteStreams).length === 0 && get().status === 'active') {
            cleanup();
          }
        }
      },
    );

    socket.on(
      'call:signal',
      async (payload: { from: string; callId: string; data: any }) => {
        const state = get();
        if (!state.call || state.call.chatId === undefined) return;

        const pc = peers.get(payload.from);
        const data = payload.data as
          | { type: 'offer'; sdp: RTCSessionDescriptionInit }
          | { type: 'answer'; sdp: RTCSessionDescriptionInit }
          | { type: 'ice'; candidate: RTCIceCandidateInit };

        try {
          if (data.type === 'offer') {
            await ensurePeer(payload.from, false, state.call.kind);
            const connection = peers.get(payload.from);
            if (!connection) return;
            await connection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            for (const candidate of pendingIce.get(payload.from) ?? []) {
              await connection.addIceCandidate(candidate).catch(() => undefined);
            }
            pendingIce.delete(payload.from);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            socket.emit('call:signal', {
              callId: state.call.id,
              to: payload.from,
              data: { type: 'answer', sdp: connection.localDescription },
            });
            return;
          }

          if (!pc) return;

          if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            for (const candidate of pendingIce.get(payload.from) ?? []) {
              await pc.addIceCandidate(candidate).catch(() => undefined);
            }
            pendingIce.delete(payload.from);
            return;
          }

          if (data.type === 'ice') {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(data.candidate).catch(() => undefined);
            } else {
              const queue = pendingIce.get(payload.from) ?? [];
              queue.push(data.candidate);
              pendingIce.set(payload.from, queue);
            }
          }
        } catch (error) {
          console.error('[call] signaling failed', error);
        }
      },
    );
  },

  start: async (chat, kind) => {
    if (get().status !== 'idle') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });

      await loadIce();
      const result = await api<{ call: Call }>('/calls', {
        method: 'POST',
        body: { chatId: chat.id, kind },
      });

      set({
        status: 'outgoing',
        call: result.call,
        chat,
        localStream: stream,
        cameraOn: kind === 'video',
        startedAt: null,
        error: null,
      });

      ringTimer = window.setTimeout(() => {
        void get().hangup();
      }, 45_000);
    } catch (error) {
      set({ error: (error as Error).message, status: 'idle' });
      useApp
        .getState()
        .notify((error as Error).message || 'دسترسی به میکروفون یا دوربین ممکن نشد', 'error');
    }
  },

  accept: async () => {
    const state = get();
    if (!state.call || !state.chat) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: state.call.kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });

      await loadIce();
      stopRing();

      const result = await api<{ call: Call; participants: string[] }>(
        `/calls/${state.call.id}/join`,
        { method: 'POST' },
      );

      set({
        status: 'active',
        localStream: stream,
        cameraOn: state.call.kind === 'video',
        startedAt: Date.now(),
      });

      const me = currentUserId();
      for (const participant of result.participants) {
        if (participant === me) continue;
        const polite = Boolean(me && me < participant);
        await ensurePeer(participant, polite, result.call.kind);
      }
    } catch (error) {
      set({ error: (error as Error).message });
      useApp
        .getState()
        .notify((error as Error).message || 'اتصال به تماس ممکن نشد', 'error');
      await get().decline();
    }
  },

  decline: async () => {
    const call = get().call;
    stopRing();
    if (call && get().status === 'incoming') {
      await api(`/calls/${call.id}/decline`, { method: 'POST' }).catch(() => undefined);
    }
    cleanup();
  },

  hangup: async () => {
    const call = get().call;
    const status = get().status;
    stopRing();

    if (call) {
      const path = status === 'outgoing' && !get().startedAt ? 'end' : 'leave';
      await api(`/calls/${call.id}/${path}`, { method: 'POST' }).catch(() => undefined);
    }

    cleanup();
  },

  toggleMute: () => {
    const stream = get().localStream;
    if (!stream) return;
    const next = !get().muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    set({ muted: next });
  },

  toggleCamera: () => {
    const stream = get().localStream;
    if (!stream) return;
    const next = !get().cameraOn;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    set({ cameraOn: next });
  },

  toggleShare: async () => {
    const state = get();
    if (!state.localStream || !state.call) return;

    if (state.sharing) {
      const cameraTrack = state.localStream.getVideoTracks()[0];
      if (cameraTrack) {
        for (const pc of peers.values()) {
          const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
          await sender?.replaceTrack(cameraTrack).catch(() => undefined);
        }
      }
      set({ sharing: false });
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) return;

      for (const pc of peers.values()) {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
        await sender?.replaceTrack(screenTrack).catch(() => undefined);
      }

      screenTrack.onended = () => {
        void get().toggleShare();
      };

      set({ sharing: true });
    } catch {
      useApp.getState().notify('اشتراک صفحه انجام نشد', 'error');
    }
  },
}));
