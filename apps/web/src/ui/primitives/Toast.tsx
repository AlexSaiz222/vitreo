import type { ReactNode } from 'react';

import { Button, IconButton } from './Button.tsx';
import { AttentionIcon, CloseIcon } from './icons.tsx';
import './Toast.css';

export interface ToastProps {
  children: ReactNode;
  /** `attention` for what needs you (warm, never red); `info` for the rest. */
  tone?: 'info' | 'attention';
  /** Important notices are announced at once and stay until closed. */
  important?: boolean;
  /** A single action, e.g. "Deshacer" (docs/03) or "Regar". */
  action?: { label: string; icon?: ReactNode; onAction: () => void };
  onDismiss?: () => void;
}

/** Small notices stacked at the top, never modal (docs/03). */
export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <div className="ui-toast-stack" role="region" aria-label="Avisos" aria-live="polite">
      {children}
    </div>
  );
}

export function Toast({ children, tone = 'info', important, action, onDismiss }: ToastProps) {
  return (
    <div className="ui-toast" data-tone={tone} role={important ? 'alert' : undefined}>
      {tone === 'attention' && <AttentionIcon />}
      <p className="ui-toast-text">{children}</p>
      {action && (
        <Button icon={action.icon} onClick={action.onAction}>
          {action.label}
        </Button>
      )}
      {onDismiss && <IconButton label="Cerrar aviso" icon={<CloseIcon />} onClick={onDismiss} />}
    </div>
  );
}
