import React from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export default function ToastContainer({ toasts, removeToast }) {
  if (!toasts || toasts.length === 0) return null;

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={16} color="var(--status-active, #10b981)" />;
      case 'error':
        return <AlertCircle size={16} color="#ef4444" />;
      case 'warning':
        return <AlertTriangle size={16} color="var(--status-cooldown, #f59e0b)" />;
      case 'info':
      default:
        return <Info size={16} color="var(--accent-color, #3b82f6)" />;
    }
  };

  const getBorderColor = (type) => {
    switch (type) {
      case 'success':
        return 'var(--border-active, rgba(16, 185, 129, 0.4))';
      case 'error':
        return 'rgba(239, 68, 68, 0.4)';
      case 'warning':
        return 'var(--border-cooldown, rgba(245, 158, 11, 0.4))';
      case 'info':
      default:
        return 'var(--border-color, rgba(255, 255, 255, 0.15))';
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '24px',
        zIndex: 100000,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '380px',
        pointerEvents: 'none'
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-notification animate-fade-in"
          style={{
            pointerEvents: 'auto',
            background: 'var(--bg-secondary, #18181b)',
            color: 'var(--text-primary, #f4f4f5)',
            border: `1px solid ${getBorderColor(toast.type)}`,
            borderRadius: '10px',
            padding: '10px 14px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
            fontWeight: '600',
            backdropFilter: 'blur(12px)',
            transition: 'all 0.2s ease',
            lineHeight: '1.4'
          }}
        >
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {getIcon(toast.type)}
          </div>
          <div style={{ flex: 1, wordBreak: 'break-word' }}>
            {toast.message}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, #71717a)',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
