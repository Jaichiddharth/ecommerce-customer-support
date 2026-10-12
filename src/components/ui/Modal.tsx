'use client';

import React, { useEffect, ReactNode } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full' | string;
  className?: string;
  overlayClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  header?: ReactNode;
}

const MAX_WIDTH_MAP: Record<string, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  full: 'max-w-full',
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  children,
  maxWidth = 'md',
  className = '',
  overlayClassName = '',
  headerClassName = '',
  bodyClassName = '',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  header,
}) => {
  // Handle ESC key press
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  const resolvedMaxWidth =
    MAX_WIDTH_MAP[maxWidth] || (maxWidth.startsWith('max-w-') ? maxWidth : `max-w-[${maxWidth}]`);

  const hasHeader = header !== undefined ? Boolean(header) : Boolean(title || icon || showCloseButton);

  return (
    <div
      className={`fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 ${overlayClassName}`}
      onClick={(e) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-white rounded-2xl shadow-2xl ${resolvedMaxWidth} w-full p-5 space-y-4 border border-slate-200 animate-in fade-in zoom-in-95 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {header !== undefined ? (
          header
        ) : hasHeader ? (
          <div className={`flex items-center justify-between border-b border-slate-100 pb-3 ${headerClassName}`}>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              {icon}
              {title}
            </h3>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : null}

        {bodyClassName ? (
          <div className={bodyClassName}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

export default Modal;