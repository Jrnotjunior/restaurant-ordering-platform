import { useEffect, useState } from 'react';
import { supabaseRpc } from '../services/supabaseClient';
import { useRestaurant } from '../components/RestaurantProvider';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import '../styles/customer-order-history.css';

type HistoryItem = { productName: string; quantity: number; unitPrice: number; lineTotal: number };
type HistoryOrder = {
  order_id: string;
  order_number: string;
  order_type: string;
  payment_method: string;
  payment_status: string;
  status: string;
  delivery_status: string | null;
  total: number;
  created_at: string;
  items: HistoryItem[];
};

function statusLabel(order: HistoryOrder) {
  if (order.delivery_status === 'delivered' || order.status === 'completed') return 'Completed';
  if (order.status === 'cancelled') return 'Cancelled';
  if (order.delivery_status === 'failed') return 'Delivery failed';
  if (order.delivery_status === 'delivering' || order.delivery_status === 'out_for_delivery') return 'Out for delivery';
  if (order.status === 'ready') return 'Ready';
  if (order.status === 'confirmed') return 'Preparing';
  return 'Order received';
}

function typeLabel(value: string) {
  return value === 'dine_in' ? 'Dine-in' : value === 'pickup' ? 'Pickup' : 'Delivery';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

export function CustomerOrderHistoryPage() {
  const restaurant = useRestaurant();
  const { user } = useRestaurantOwnerAuth();
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user || !restaurant.id) {
        if (!cancelled) {
          setOrders([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError('');
      try {
        const rows = await supabaseRpc<HistoryOrder>('get_my_order_history', {
          p_restaurant_id: restaurant.id,
        });
        if (!cancelled) setOrders(rows);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load your order history.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [restaurant.id, user?.id]);

  return (
    <section className="customer-order-history-page">
      <div className="menu-intro">
        <p className="eyebrow">My account</p>
        <h1>Order history.</h1>
        <p>View your previous orders and their details.</p>
      </div>

      {loading ? <div className="customer-order-history-empty"><p>Loading your orders…</p></div>
        : error ? <div className="customer-order-history-empty"><p>{error}</p></div>
        : orders.length === 0 ? <div className="customer-order-history-empty"><p>You don't have any orders yet.</p><a className="button button-primary" href="./">Start an order</a></div>
        : <div className="customer-order-history-list">
          {orders.map((order) => (
            <article className="customer-order-history-card" key={order.order_id}>
              <div className="customer-order-history-card-header">
                <div><p className="eyebrow">Order</p><h2>#{order.order_number}</h2><span>{formatDate(order.created_at)}</span></div>
                <strong className="customer-order-history-status">{statusLabel(order)}</strong>
              </div>
              <div className="customer-order-history-meta"><span>{typeLabel(order.order_type)}</span><span>{order.payment_method === 'gcash' ? 'Online Payment' : 'Cash'}</span><strong>₱{Number(order.total).toFixed(2)}</strong></div>
              <div className="customer-order-history-items">
                {order.items.map((item, index) => <div key={index}><span>{item.quantity} × {item.productName}</span><strong>₱{Number(item.lineTotal).toFixed(2)}</strong></div>)}
              </div>
              <a className="button button-primary customer-order-history-track" href={`?trackOrder=${encodeURIComponent(order.order_number)}`}>View order tracking</a>
            </article>
          ))}
        </div>}
    </section>
  );
}
