import React from 'react';
import { useTranslation } from 'react-i18next';

export default function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  type = 'danger'
}) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  const confirmButtonClass = type === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--modal-overlay)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
        animation: 'fade-in 0.2s ease-out'
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          boxShadow: 'var(--card-shadow)',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          transform: 'scale(1)',
          transition: 'transform 0.2s ease-out'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'Outfit', color: 'var(--text-primary)' }}>
            {title || t('common.confirm')}
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            {message}
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
          <button
            className="btn btn-secondary"
            style={{ padding: '8px 16px', fontSize: '14px' }}
            onClick={onCancel}
          >
            {cancelText || t('common.cancel')}
          </button>
          <button
            className={confirmButtonClass}
            style={{ padding: '8px 16px', fontSize: '14px' }}
            onClick={onConfirm}
          >
            {confirmText || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
