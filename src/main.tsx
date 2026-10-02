import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { RestaurantOwnerAuthProvider } from './components/RestaurantOwnerAuthProvider';
import './styles/restaurant-dispatch.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/restaurant-orders.css';
import './styles/restaurant-menu.css';
import './styles/restaurant-shipping.css';
import './styles/restaurant-sales.css';
import './styles/restaurant-auth.css';
import './styles/restaurant-navigation.css';
import './styles/restaurant-riders.css';
import './styles/restaurant-employees.css';
import './styles/restaurant-employee-invite.css';
import './styles/restaurant-search.css';
import './styles/delivery-navigation.css';
import './styles/customer-contact.css';
import './styles/rider-delivery.css';
import './styles/rider-dashboard.css';
import './styles/restaurant-dashboard-standard.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RestaurantOwnerAuthProvider>
      <App />
    </RestaurantOwnerAuthProvider>
  </React.StrictMode>,
);
