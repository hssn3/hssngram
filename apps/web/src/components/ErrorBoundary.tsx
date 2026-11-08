import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('[hssngram] render error', error);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="empty" style={{ minHeight: '100dvh' }}>
        <img src="/icons/icon-192.png" alt="حسن‌گرام" />
        <h3>مشکلی پیش آمد</h3>
        <p>صفحه را یک‌بار بازخوانی کنید. اگر ادامه داشت، به مدیر سرور اطلاع بدهید.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          بازخوانی صفحه
        </button>
      </div>
    );
  }
}
