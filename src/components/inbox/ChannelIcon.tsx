import React from 'react';
import { Globe, Mail, MessageSquare } from 'lucide-react';

const WHATSAPP_PATH =
  'M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.185 8.185 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24-1.42 0-2.82-.37-4.06-1.08l-.29-.17-3.12.82.83-3.04-.19-.3a8.17 8.17 0 0 1-1.26-4.47c0-4.54 3.7-8.24 8.24-8.24zm4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.07-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08 0 1.23.9 2.42 1.02 2.59.13.17 1.76 2.69 4.27 3.77.6.26 1.06.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.21-.18-.46-.3z';

const InstagramGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const MessengerGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78a.8.8 0 0 0 1.12.71l1.99-.88a.8.8 0 0 1 .53-.04c.91.25 1.88.39 2.9.39 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm6 7.46-2.94 4.66a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.94-4.66a1.5 1.5 0 0 1 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63z" />
  </svg>
);

const SIZE_CLASSES = {
  xs: { box: 'w-3.5 h-3.5 rounded-[4px]', glyph: 'w-2.5 h-2.5' },
  sm: { box: 'w-5 h-5 rounded-md', glyph: 'w-3 h-3' },
  md: { box: 'w-7 h-7 rounded-lg', glyph: 'w-4 h-4' },
} as const;

/** Square brand badge for a channel type (WhatsApp green, Instagram gradient, Messenger blue, ...) */
export const ChannelIcon: React.FC<{ type: string; size?: keyof typeof SIZE_CLASSES; className?: string }> = ({
  type,
  size = 'md',
  className = '',
}) => {
  const { box, glyph } = SIZE_CLASSES[size];

  switch (type) {
    case 'whatsapp':
      return (
        <span className={`${box} bg-[#25d366] text-white flex items-center justify-center shrink-0 ${className}`}>
          <svg viewBox="0 0 24 24" className={`${glyph} fill-current`}>
            <path d={WHATSAPP_PATH} />
          </svg>
        </span>
      );
    case 'instagram':
      return (
        <span
          className={`${box} bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white flex items-center justify-center shrink-0 ${className}`}
        >
          <InstagramGlyph className={glyph} />
        </span>
      );
    case 'messenger':
      return (
        <span className={`${box} bg-gradient-to-br from-[#00b2ff] to-[#006aff] text-white flex items-center justify-center shrink-0 ${className}`}>
          <MessengerGlyph className={glyph} />
        </span>
      );
    case 'email':
      return (
        <span className={`${box} bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 ${className}`}>
          <Mail className={glyph} />
        </span>
      );
    case 'webchat':
      return (
        <span className={`${box} bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 ${className}`}>
          <Globe className={glyph} />
        </span>
      );
    default:
      return (
        <span className={`${box} bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 ${className}`}>
          <MessageSquare className={glyph} />
        </span>
      );
  }
};
