import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const storedTheme = localStorage.getItem('hssn-theme');
document.documentElement.dataset.theme = storedTheme === 'light' ? 'light' : 'dark';

/**
 * Mobile browsers resize the visual viewport when the keyboard opens, and iOS
 * Safari keeps the layout viewport at full height. Binding the app shell to the
 * visual viewport keeps the composer above the keyboard instead of hiding it.
 */
function syncViewport(): void {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
  document.documentElement.style.setProperty('--kb-open', height < window.innerHeight - 120 ? '1' : '0');
}

syncViewport();
window.addEventListener('resize', syncViewport, { passive: true });
window.addEventListener('orientationchange', () => window.setTimeout(syncViewport, 250));
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
