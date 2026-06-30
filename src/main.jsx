import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/shared/ErrorBoundary.jsx';
import './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary name="AppRoot" isTopLevel>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
