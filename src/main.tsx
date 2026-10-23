import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/global.css';
import './styles/restaurant-orders.css';
import './styles/restaurant-menu.css';
import './styles/restaurant-sales.css';
import './styles/restaurant-auth.css';
import './styles/tenant-auth.css';
import './styles/restaurant-navigation.css';
import './styles/restaurant-employees.css';
import './styles/restaurant-employee-invite.css';
import './styles/restaurant-role-dashboard.css';
import './styles/restaurant-pos.css';
import './styles/restaurant-search.css';
import './styles/delivery-navigation.css';
import './styles/customer-contact.css';
import './styles/rider-delivery.css';
import './styles/rider-dashboard.css';
import './styles/restaurant-dashboard-standard.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Web2Table failed to render.', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ maxWidth: 680, margin: '64px auto', padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#202124' }}>
          <h1>Web2Table couldn't open this page</h1>
          <p>The app hit an unexpected error while rendering. Your account and restaurant data have not been changed by this screen.</p>
          <details>
            <summary>Technical details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{this.state.error.message}</pre>
          </details>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '10px 16px', cursor: 'pointer' }}>Reload app</button>
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
