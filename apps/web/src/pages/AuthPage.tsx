import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { Icon } from '../components/Icon';

type Mode = 'login' | 'register';

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const login = useApp((state) => state.login);
  const register = useApp((state) => state.register);

  const [loginId, setLoginId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const isRegister = mode === 'register';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!/^\d{8}$/.test(loginId.trim())) {
      setError('شناسه ورود باید دقیقاً ۸ رقم عددی باشد.');
      return;
    }
    if (password.length < 6) {
      setError('گذرواژه باید حداقل ۶ نویسه باشد.');
      return;
    }
    if (isRegister && displayName.trim().length < 2) {
      setError('نام نمایشی را کامل وارد کنید.');
      return;
    }
    if (isRegister && password !== confirm) {
      setError('تکرار گذرواژه مطابقت ندارد.');
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        const result = await register({
          loginId: loginId.trim(),
          displayName: displayName.trim(),
          password,
        });

        if (result === 'pending') {
          setPendingId(loginId.trim());
          return;
        }
        navigate('/app', { replace: true });
        return;
      }

      await login(loginId.trim(), password);
      navigate('/app', { replace: true });
    } catch (caught) {
      setError((caught as Error).message || 'درخواست انجام نشد');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="brand-lockup">
          <img src="/icons/icon-192.png" alt="حسن‌گرام" />
          <div>
            <h1>حسن‌گرام</h1>
            <span>HssNGram</span>
          </div>
        </div>

        <div className="auth-hero">
          <h2>پیام‌رسان خصوصی خانواده و دوستان</h2>
          <p>
            گفتگوی گروهی، ارسال فایل، پیام صوتی و تماس صوتی و تصویری — همه روی سرورهای ابر آروان و
            فقط برای جمع خودمان.
          </p>
        </div>

        <div className="auth-features">
          <span className="chip">
            <Icon name="send" /> پیام و فایل
          </span>
          <span className="chip">
            <Icon name="phone" /> تماس صوتی
          </span>
          <span className="chip">
            <Icon name="video" /> تماس تصویری
          </span>
          <span className="chip">
            <Icon name="shield" /> ورود با شناسه ۸ رقمی
          </span>
        </div>
      </aside>

      <section className="auth-panel">
        <div className="auth-card">
          {pendingId ? (
            <div className="pending-box">
              <div className="big">⏳</div>
              <h3>ثبت‌نام شما ثبت شد</h3>
              <p>
                شناسه <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{pendingId}</strong> در
                انتظار تأیید مدیر است. به‌محض تأیید می‌توانید با همین شناسه و گذرواژه وارد شوید.
              </p>
              <Link className="btn btn-primary" to="/login" style={{ marginTop: 14 }}>
                بازگشت به صفحه ورود
              </Link>
            </div>
          ) : (
            <>
              <h3>{isRegister ? 'ساخت حساب جدید' : 'ورود به حسن‌گرام'}</h3>
              <p className="sub">
                {isRegister
                  ? 'یک شناسه ۸ رقمی و گذرواژه برای خودتان انتخاب کنید؛ بعد از تأیید مدیر فعال می‌شود.'
                  : 'شناسه ۸ رقمی و گذرواژه‌ای که هنگام ثبت‌نام انتخاب کرده‌اید را وارد کنید.'}
              </p>

              <form className="auth-form" onSubmit={submit}>
                <div className="field">
                  <label htmlFor="loginId">شناسه ورود (۸ رقم)</label>
                  <input
                    id="loginId"
                    className="input"
                    inputMode="numeric"
                    autoComplete="username"
                    maxLength={8}
                    dir="ltr"
                    placeholder="10000000"
                    value={loginId}
                    onChange={(event) =>
                      setLoginId(event.target.value.replace(/\D/g, '').slice(0, 8))
                    }
                  />
                </div>

                {isRegister ? (
                  <div className="field">
                    <label htmlFor="displayName">نام نمایشی</label>
                    <input
                      id="displayName"
                      className="input"
                      autoComplete="name"
                      placeholder="مثلاً حسن"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </div>
                ) : null}

                <div className="field">
                  <label htmlFor="password">گذرواژه</label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    placeholder="••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>

                {isRegister ? (
                  <div className="field">
                    <label htmlFor="confirm">تکرار گذرواژه</label>
                    <input
                      id="confirm"
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      placeholder="••••••"
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                    />
                  </div>
                ) : null}

                {error ? <div className="form-error">{error}</div> : null}

                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? 'لطفاً صبر کنید…' : isRegister ? 'ثبت‌نام' : 'ورود'}
                  {!loading ? <Icon name={isRegister ? 'plus' : 'back'} /> : null}
                </button>
              </form>

              <div className="auth-switch">
                {isRegister ? (
                  <>
                    قبلاً حساب دارید؟ <Link to="/login">وارد شوید</Link>
                  </>
                ) : (
                  <>
                    حساب ندارید؟ <Link to="/register">ثبت‌نام کنید</Link>
                  </>
                )}
                <div style={{ marginTop: 10 }}>
                  <Link to="/support">بدون حساب با مدیر چت کنید</Link>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
