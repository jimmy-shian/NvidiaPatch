import React from 'react';
import { withTranslation } from 'react-i18next';

class ErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', this.props.name || 'Unknown', error.message, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { t } = this.props;
      const isTopLevel = this.props.isTopLevel;

      if (isTopLevel) {
        const handleReload = () => {
          if (window.electronAPI?.restartApp) {
            window.electronAPI.restartApp();
          } else {
            window.location.reload();
          }
        };

        return (
          <div style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            padding: '24px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '40px' }}>⚠️</div>
            <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>
              {t('errorBoundary.appCrash', 'Application Error')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '420px', lineHeight: '1.6' }}>
              {this.state.error?.message || t('errorBoundary.unknownError', 'An unexpected error occurred.')}
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              {t('errorBoundary.recoveryHint', 'You can try reloading or restarting the application.')}
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                {t('errorBoundary.reload', 'Reload')}
              </button>
              <button className="btn btn-primary" onClick={handleReload}>
                {t('errorBoundary.restartApp', 'Restart App')}
              </button>
            </div>
          </div>
        );
      }

      return (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-inactive)',
          borderRadius: '8px'
        }}>
          <h3 style={{ color: 'var(--text-inactive)', marginBottom: '8px' }}>
            {this.props.fallbackText || t('errorBoundary.panelError', 'Panel Error')}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px' }}>
            {this.state.error?.message || t('errorBoundary.unknownError', 'An unexpected error occurred.')}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            {t('errorBoundary.tryAgain', 'Try Again')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ErrorBoundary = withTranslation()(ErrorBoundaryInner);

export default ErrorBoundary;
