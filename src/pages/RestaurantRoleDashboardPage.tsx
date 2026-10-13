import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadOwnerStats, type OwnerStats } from '../modules/sales/salesService';
import { supabase } from '../services/supabaseClient';

export type RestaurantRole = 'owner' | 'cashier' | 'kitchen' | 'dispatcher';
type InventoryAlertItem = { id: string; name: string; unit: string; quantity_on_hand: number | string; low_stock_threshold: number | string };

const roleInfo = {
  owner: { eyebrow: 'Restaurant owner', title: 'Owner Dashboard', description: 'Manage your restaurant, team, products, orders, and operations.' },
  cashier: { eyebrow: 'Cashier', title: 'Cashier Dashboard', description: 'Handle customer orders, payments, receipts, and cashier tasks.' },
  kitchen: { eyebrow: 'Kitchen', title: 'Kitchen Dashboard', description: 'View confirmed orders and update the kitchen preparation status.' },
  dispatcher: { eyebrow: 'Dispatch', title: 'Dispatcher Dashboard', description: 'Manage ready orders, rider assignments, pickups, and courier handoffs.' },
} as const;

type Props = {
  role: RestaurantRole;
  restaurantName?: string;
  restaurantId?: string;
  children?: ReactNode;
};

function OwnerDashboard({ restaurantName, restaurantId }: { restaurantName?: string; restaurantId?: string }) {
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inventoryItems, setInventoryItems] = useState<InventoryAlertItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) return;
    const ownerRestaurantId = restaurantId;
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError('');
        const data = await loadOwnerStats(ownerRestaurantId);
        if (mounted) setStats(data);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load dashboard data.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    const channel = supabase?.channel(`owner-dashboard:${ownerRestaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${ownerRestaurantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `restaurant_id=eq.${ownerRestaurantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_staff', filter: `restaurant_id=eq.${ownerRestaurantId}` }, () => { void load(); })
      .subscribe();
    return () => {
      mounted = false;
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId || !supabase) { setInventoryLoading(false); return; }
    const client = supabase;
    let mounted = true;
    const loadInventoryAlerts = async () => {
      const { data, error: inventoryError } = await client
        .from('restaurant_inventory_items')
        .select('id,name,unit,quantity_on_hand,low_stock_threshold')
        .eq('restaurant_id', restaurantId)
        .order('name');
      if (!mounted) return;
      if (inventoryError) {
        console.error('Unable to load inventory alerts.', inventoryError);
      } else {
        setInventoryItems((data ?? []) as InventoryAlertItem[]);
      }
      setInventoryLoading(false);
    };
    void loadInventoryAlerts();
    const channel = client.channel(`owner-inventory-alerts:${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_inventory_items', filter: `restaurant_id=eq.${restaurantId}` }, () => { void loadInventoryAlerts(); })
      .subscribe();
    return () => { mounted = false; void client.removeChannel(channel); };
  }, [restaurantId]);

  const outOfStockItems = inventoryItems.filter((item) => Number(item.quantity_on_hand) <= 0);
  const lowStockItems = inventoryItems.filter((item) => Number(item.quantity_on_hand) > 0 && Number(item.quantity_on_hand) <= Number(item.low_stock_threshold));
  const alertItems = [...outOfStockItems, ...lowStockItems];

  const statCards = useMemo(() => [
    { label: 'Today\'s Sales', value: loading ? '—' : `₱${(stats?.sales ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` },
  ], [loading, stats]);

  return (
    <div className="restaurant-owner-dashboard">
      {error && <div className="restaurant-owner-dashboard-error" role="alert">{error}</div>}

      <section className="restaurant-owner-dashboard-stats" aria-label="Restaurant overview">
        {statCards.map((card) => (
          <article className="restaurant-owner-dashboard-stat" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="restaurant-owner-dashboard-chart" aria-label="Inventory alerts">
        <div className="restaurant-owner-dashboard-chart-heading">
          <div><p className="eyebrow">Stock monitoring</p><h2>Inventory alerts</h2></div>
          <a href="#restaurant/inventory">Manage inventory →</a>
        </div>
        {inventoryLoading ? <div className="restaurant-owner-dashboard-chart-empty">Checking stock levels…</div> : alertItems.length ? (
          <div style={{display:'grid',gap:8}}>
            {outOfStockItems.map((item) => <div key={item.id} style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',padding:'10px 12px',borderRadius:10,background:'#fef2f2',color:'#991b1b'}}>
              <strong>{item.name}</strong><span>Out of stock · {Number(item.quantity_on_hand)} {item.unit}</span>
            </div>)}
            {lowStockItems.map((item) => <div key={item.id} style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',padding:'10px 12px',borderRadius:10,background:'#fffbeb',color:'#92400e'}}>
              <strong>{item.name}</strong><span>Low stock · {Number(item.quantity_on_hand)} {item.unit} left (level {Number(item.low_stock_threshold)} {item.unit})</span>
            </div>)}
          </div>
        ) : <div className="restaurant-owner-dashboard-chart-empty">{inventoryItems.length ? 'All tracked items have sufficient stock.' : 'No inventory items yet. Add ingredients and low-stock levels in Inventory to start receiving alerts.'}</div>}
      </section>

      <section className="restaurant-owner-dashboard-chart">
        <div className="restaurant-owner-dashboard-chart-heading">
          <div>
            <p className="eyebrow">Sales activity</p>
            <h2>Daily Sales</h2>
          </div>
          <span>Last 7 days</span>
        </div>

        {loading ? (
          <div className="restaurant-owner-dashboard-chart-empty">Loading sales data…</div>
        ) : (
          <div className="restaurant-owner-dashboard-sales-chart" role="img" aria-label="Daily completed sales for the last 7 days">
            <div className="restaurant-owner-dashboard-sales-axis">
              <span>₱{Math.round((Math.max(...(stats?.dailySales.map((point) => point.total) ?? [0]), 0)) / 1000)}k</span>
              <span>₱0</span>
            </div>
            <div className="restaurant-owner-dashboard-sales-bars">
              {(stats?.dailySales ?? []).map((point) => {
                const max = Math.max(...(stats?.dailySales.map((item) => item.total) ?? [0]), 1);
                const height = point.total > 0 ? Math.max((point.total / max) * 100, 5) : 2;
                return (
                  <div className="restaurant-owner-dashboard-sales-column" key={point.label}>
                    <div className="restaurant-owner-dashboard-sales-value">{point.total > 0 ? `₱${point.total.toLocaleString('en-PH', { maximumFractionDigits: 0 })}` : '₱0'}</div>
                    <div className="restaurant-owner-dashboard-sales-track">
                      <div className="restaurant-owner-dashboard-sales-bar" style={{ height: `${height}%` }} />
                    </div>
                    <span>{point.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function RestaurantRoleDashboardPage({ role, restaurantName, restaurantId, children }: Props) {
  const info = roleInfo[role];

  if (role === 'owner') {
    return (
      <section className="restaurant-role-dashboard">
        <OwnerDashboard restaurantName={restaurantName} restaurantId={restaurantId} />
      </section>
    );
  }

  return (
    <section className="restaurant-role-dashboard">
      <div className="restaurant-role-dashboard-header">
        <div>
          <p className="eyebrow">{info.eyebrow}</p>
          <h1>{info.title}</h1>
          <p>{restaurantName ? restaurantName + ' · ' : ''}{info.description}</p>
        </div>
      </div>
      <div className="restaurant-role-dashboard-content">{children}</div>
    </section>
  );
}
