import { useEffect, useRef, useState } from 'react';
import { useCall } from '../store/useCall';
import { useApp } from '../store/useApp';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { formatDuration } from '../lib/format';

function StreamVideo({
  stream,
  muted = false,
  className,
}: {
  stream: MediaStream;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

function StreamAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return <audio ref={ref} autoPlay />;
}

export function CallOverlay() {
  const status = useCall((state) => state.status);
  const call = useCall((state) => state.call);
  const chat = useCall((state) => state.chat);
  const localStream = useCall((state) => state.localStream);
  const remoteStreams = useCall((state) => state.remoteStreams);
  const muted = useCall((state) => state.muted);
  const cameraOn = useCall((state) => state.cameraOn);
  const sharing = useCall((state) => state.sharing);
  const startedAt = useCall((state) => state.startedAt);
  const accept = useCall((state) => state.accept);
  const decline = useCall((state) => state.decline);
  const hangup = useCall((state) => state.hangup);
  const toggleMute = useCall((state) => state.toggleMute);
  const toggleCamera = useCall((state) => state.toggleCamera);
  const toggleShare = useCall((state) => state.toggleShare);
  const user = useApp((state) => state.user);

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (status === 'idle' || !call || !chat) return null;

  const isVideo = call.kind === 'video';
  const peers = Object.entries(remoteStreams);
  const caller = chat.members.find((member) => member.user.id === call.initiatorId)?.user;
  const other = chat.members.find((member) => member.user.id !== user?.id)?.user;

  if (status === 'incoming') {
    return (
      <div className="call-screen">
        <div className="incoming-card">
          <Avatar name={chat.title} src={chat.avatarUrl} size="lg" />
          <h3>{chat.title}</h3>
          <p>{isVideo ? 'تماس تصویری ورودی…' : 'تماس صوتی ورودی…'}</p>
          <div className="call-controls">
            <button className="hangup" onClick={() => void decline()} aria-label="رد تماس">
              <Icon name="phone-off" />
            </button>
            <button className="accept" onClick={() => void accept()} aria-label="پاسخ">
              <Icon name={isVideo ? 'video' : 'phone'} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="call-screen">
      <div className="call-top">
        <Avatar name={chat.title} src={chat.avatarUrl} size="sm" />
        <div className="who">
          <div className="name">{chat.title}</div>
          <div className="sub">
            {status === 'outgoing'
              ? 'در حال زنگ زدن…'
              : `${isVideo ? 'تماس تصویری' : 'تماس صوتی'} • ${formatDuration(elapsed)}`}
          </div>
        </div>
        <span className="chip" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.2)' }}>
          {peers.length + 1} نفر
        </span>
      </div>

      {isVideo ? (
        <div className="video-grid">
          {peers.map(([peerId, stream]) => {
            const member = chat.members.find((item) => item.user.id === peerId)?.user;
            return (
              <div className="video-tile" key={peerId}>
                <StreamVideo stream={stream} />
                <span className="label">{member?.displayName ?? 'مهمان'}</span>
              </div>
            );
          })}

          {peers.length === 0 ? (
            <div className="video-tile audio-only">
              <Avatar name={other?.displayName ?? chat.title} src={other?.avatarUrl} size="lg" />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="video-grid">
          {peers.map(([peerId, stream]) => {
            const member = chat.members.find((item) => item.user.id === peerId)?.user;
            return (
              <div className="video-tile audio-only" key={peerId}>
                <StreamAudio stream={stream} />
                <Avatar name={member?.displayName ?? 'مهمان'} size="lg" />
                <span className="label">{member?.displayName ?? 'مهمان'}</span>
              </div>
            );
          })}

          {peers.length === 0 ? (
            <div className="video-tile audio-only">
              <Avatar name={caller?.displayName ?? chat.title} src={caller?.avatarUrl} size="lg" />
              <span className="label">
                {status === 'outgoing' ? 'در انتظار پاسخ…' : 'در حال اتصال…'}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {isVideo && localStream ? (
        <div
          style={{
            position: 'fixed',
            bottom: 104,
            insetInlineStart: 22,
            width: 150,
            height: 200,
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,.16)',
            boxShadow: '0 20px 40px rgba(0,0,0,.45)',
            background: '#0b1020',
          }}
        >
          <StreamVideo stream={localStream} muted />
        </div>
      ) : null}

      <div className="call-controls">
        <button
          className={muted ? 'off' : ''}
          onClick={toggleMute}
          aria-label={muted ? 'روشن کردن میکروفون' : 'بی‌صدا'}
        >
          <Icon name={muted ? 'mic-off' : 'mic'} />
        </button>

        {isVideo ? (
          <button
            className={cameraOn ? '' : 'off'}
            onClick={toggleCamera}
            aria-label={cameraOn ? 'خاموش کردن دوربین' : 'روشن کردن دوربین'}
          >
            <Icon name={cameraOn ? 'video' : 'video-off'} />
          </button>
        ) : null}

        {isVideo ? (
          <button
            className={sharing ? 'off' : ''}
            onClick={() => void toggleShare()}
            aria-label="اشتراک صفحه"
          >
            <Icon name="screen" />
          </button>
        ) : null}

        <button className="hangup" onClick={() => void hangup()} aria-label="پایان تماس">
          <Icon name="phone-off" />
        </button>
      </div>
    </div>
  );
}
