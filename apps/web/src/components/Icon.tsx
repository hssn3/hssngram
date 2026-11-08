import type { SVGProps } from 'react';

export type IconName =
  | 'send'
  | 'attach'
  | 'mic'
  | 'mic-off'
  | 'video'
  | 'video-off'
  | 'phone'
  | 'phone-off'
  | 'users'
  | 'settings'
  | 'search'
  | 'plus'
  | 'check'
  | 'checks'
  | 'more'
  | 'close'
  | 'back'
  | 'image'
  | 'file'
  | 'download'
  | 'shield'
  | 'logout'
  | 'edit'
  | 'trash'
  | 'reply'
  | 'smile'
  | 'screen'
  | 'lock'
  | 'play'
  | 'stop';

const paths: Record<IconName, React.ReactNode> = {
  send: <path d="M20.5 3.5 3.8 10.2a.6.6 0 0 0 0 1.1l6.6 2.4 2.4 6.6a.6.6 0 0 0 1.1 0Z" />,
  attach: (
    <path d="M20 11.6 12.4 19a5.4 5.4 0 0 1-7.7-7.6l7.8-7.6a3.6 3.6 0 0 1 5 5.1L9.8 16.4a1.8 1.8 0 0 1-2.6-2.5l7-6.9" />
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>
  ),
  'mic-off': (
    <>
      <path d="M15 9V6a3 3 0 0 0-5.6-1.5" />
      <path d="M9 9v2a3 3 0 0 0 4.6 2.6" />
      <path d="M5 11a7 7 0 0 0 10.8 6" />
      <path d="M19 11a7 7 0 0 1-.6 2.8" />
      <path d="M12 18v3" />
      <path d="m3 3 18 18" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="3" />
      <path d="m15.5 10.5 6-3.2v9.4l-6-3.2" />
    </>
  ),
  'video-off': (
    <>
      <path d="M15.5 10.5V9a2 2 0 0 0-2-2H7" />
      <path d="M2.5 8v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1" />
      <path d="m21.5 7.3-6 3.2v2.6l6 3.2Z" />
      <path d="m3 3 18 18" />
    </>
  ),
  phone: (
    <path d="M6.7 3.5 9 8l-2 2a12.5 12.5 0 0 0 5.2 5.2l2-2 4.5 2.3a2 2 0 0 1 1 2.3l-.6 2A2 2 0 0 1 17 21 15.5 15.5 0 0 1 3 7a2 2 0 0 1 1.5-2l2-.5a2 2 0 0 1 .2 0Z" />
  ),
  'phone-off': (
    <>
      <path d="M6.7 3.5 9 8l-2 2a12.5 12.5 0 0 0 5.2 5.2l2-2 4.5 2.3a2 2 0 0 1 1 2.3l-.6 2A2 2 0 0 1 17 21 15.5 15.5 0 0 1 3 7a2 2 0 0 1 1.5-2l2-.5" />
      <path d="m3 3 18 18" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20v-1.6A4.4 4.4 0 0 1 7.2 14h3.6a4.4 4.4 0 0 1 4.4 4.4V20" />
      <path d="M16.5 4.6a3.4 3.4 0 0 1 0 6.8" />
      <path d="M18 14.2a4.4 4.4 0 0 1 3.2 4.2V20" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2.9a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.6 8a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.4-3.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  checks: (
    <>
      <path d="m2.5 12.5 4.5 4.5 8-9" />
      <path d="m11 17 1.5 1.5L22 8" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M9 5l7 7-7 7" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 4.6-4.6a2 2 0 0 1 2.8 0L20 21" />
    </>
  ),
  file: (
    <>
      <path d="M14 3v5a2 2 0 0 0 2 2h5" />
      <path d="M19 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l6 6.5V19a2 2 0 0 1-2 2Z" />
    </>
  ),
  download: <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />,
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </>
  ),
  edit: (
    <>
      <path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4Z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </>
  ),
  reply: <path d="M9 7 4 12l5 5M4 12h9a7 7 0 0 1 7 7" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
    </>
  ),
  screen: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2.5" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5Z" fill="currentColor" className="filled" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />,
};

type Props = SVGProps<SVGSVGElement> & { name: IconName };

export function Icon({ name, ...props }: Props) {
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
