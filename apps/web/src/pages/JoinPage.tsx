import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../store/useApp';
import { Icon } from '../components/Icon';

export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const user = useApp((state) => state.user);
  const [state, setState] = useState<'loading' | 'joined' | 'error' | 'auth'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) {
      setState('auth');
      return;
    }

    void (async () => {
      try {
        const result = await api<{ chat: { id: string } }>(`/invites/${token}/join`, {
          method: 'POST',
        });
        await useApp.getState().loadChats();
        await useApp.getState().selectChat(result.chat.id);
        setState('joined');
        navigate('/app', { replace: true });
      } catch (error) {
        setState('error');
        setMessage((error as Error).message);
      }
    })();
  }, [token, user, navigate]);

  return (
    <div className="empty" style={{ minHeight: '100dvh' }}>
      <img src="/icons/icon-192.png" alt="حسن‌گرام" />
      <h3>دعوت به گفتگو</h3>

      {state === 'loading' ? <p>در حال بررسی لینک…</p> : null}
      {state === 'auth' ? (
        <>
          <p>برای پیوستن، اول وارد شوید.</p>
          <button className="btn btn-primary" onClick={() => navigate(`/login?next=/join/${token}`)}>
            <Icon name="lock" /> ورود و پیوستن
          </button>
        </>
      ) : null}
      {state === 'error' ? (
        <>
          <p>{message || 'این لینک معتبر نیست یا منقضی شده است.'}</p>
          <button className="btn" onClick={() => navigate('/app')}>
            بازگشت
          </button>
        </>
      ) : null}
    </div>
  );
}
