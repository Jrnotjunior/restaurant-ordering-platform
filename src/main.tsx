import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { RestaurantOwnerAuthProvider } from './components/RestaurantOwnerAuthProvider';
import './styles/tokens.css';
import './styles/global.css';
import './styles/restaurant-orders.css';
import './styles/restaurant-dashboard.css';
import './styles/restaurant-menu.css';
import './styles/restaurant-shipping.css';
import './styles/restaurant-auth.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RestaurantOwnerAuthProvider>
      <App />
    </RestaurantOwnerAuthProvider>
  </React.StrictMode>,
);
