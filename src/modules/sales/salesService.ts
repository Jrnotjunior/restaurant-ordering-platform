import type { RestaurantOperatingHours } from '../../types/restaurant';
import { supabase } from '../../services/supabaseClient';

export type OwnerStats = {
  sales: number;
  orders: number;
  pendingOrders: number;
  products: number;
  employees: number;
  activeDeliveries: number;
  dailySales: { label: string; total: number }[];
};

type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

const DAY_KEYS: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getManilaDateParts(dateString: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(dateString));

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const date = new Date(Date.UTC(year, month - 1, day));
  return { year, month, day, hour, minute, weekday: DAY_KEYS[date.getUTCDay()], date };
}

function formatBusinessDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getBusinessDateKey(dateString: string, operatingHours: RestaurantOperatingHours): string {
  const current = getManilaDateParts(dateString);
  const currentHours = operatingHours[current.weekday];
  const nowMinutes = current.hour * 60 + current.minute;

  if (currentHours?.isOpen) {
    const [openHour, openMinute] = currentHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = currentHours.close.split(':').map(Number);
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;

    if (
      openMinutes === closeMinutes ||
      (closeMinutes > openMinutes && nowMinutes >= openMinutes && nowMinutes < closeMinutes) ||
      (closeMinutes < openMinutes && nowMinutes >= openMinutes)
    ) {
      return formatBusinessDate(current.date);
    }
  }

  const previousDate = new Date(current.date);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const previousHours = operatingHours[DAY_KEYS[previousDate.getUTCDay()]];

  if (previousHours?.isOpen) {
    const [openHour, openMinute] = previousHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = previousHours.close.split(':').map(Number);
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;

    if (closeMinutes < openMinutes && nowMinutes < closeMinutes) {
      return formatBusinessDate(previousDate);
    }
  }

  return formatBusinessDate(current.date);
}

export async function loadOwnerStats(restaurantId: string): Promise<OwnerStats> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('operating_hours')
    .eq('id', restaurantId)
    .single();

  if (restaurantError) throw restaurantError;

  const operatingHours = (restaurant?.operating_hours ?? {}) as RestaurantOperatingHours;
  const nowParts = getManilaDateParts(new Date().toISOString());
  const currentBusinessDate = getBusinessDateKey(new Date().toISOString(), operatingHours);
  const currentDate = nowParts.date;
  const chartStart = new Date(currentDate);
  chartStart.setUTCDate(chartStart.getUTCDate() - 6);
  const queryStart = new Date(chartStart);
  queryStart.setUTCDate(queryStart.getUTCDate() - 1);
  const queryEnd = new Date(currentDate);
  queryEnd.setUTCDate(queryEnd.getUTCDate() + 2);

  const start = queryStart.toISOString();
  const end = queryEnd.toISOString();

  const [orders, products, employees] = await Promise.all([
    supabase.from('orders').select('id,total,status,created_at,order_type,delivery_status').eq('restaurant_id', restaurantId).gte('created_at', start).lt('created_at', end),
    supabase.from('products').select('id').eq('restaurant_id', restaurantId),
    supabase.from('restaurant_staff').select('id').eq('restaurant_id', restaurantId).eq('is_active', true),
  ]);

  if (orders.error) throw orders.error;
  if (products.error) throw products.error;
  if (employees.error) throw employees.error;

  const orderRows = orders.data ?? [];
  const completedStatuses = new Set(['completed']);
  const businessDateForOrder = (order: typeof orderRows[number]) => getBusinessDateKey(order.created_at, operatingHours);

  const todayOrders = orderRows.filter((order) => businessDateForOrder(order) === currentBusinessDate);
  const sales = todayOrders.reduce(
    (sum, order) => completedStatuses.has(order.status) ? sum + Number(order.total ?? 0) : sum,
    0,
  );

  const pendingStatuses = new Set(['new', 'confirmed', 'preparing', 'ready']);
  const pendingOrders = todayOrders.filter((order) => pendingStatuses.has(order.status)).length;
  const activeDeliveries = todayOrders.filter(
    (order) => order.order_type === 'delivery' && ['assigned', 'picked_up', 'out_for_delivery'].includes(order.delivery_status ?? ''),
  ).length;

  const dailySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(chartStart);
    date.setUTCDate(chartStart.getUTCDate() + index);
    const key = formatBusinessDate(date);
    const total = orderRows.reduce((sum, order) => {
      return businessDateForOrder(order) === key && completedStatuses.has(order.status)
        ? sum + Number(order.total ?? 0)
        : sum;
    }, 0);

    return {
      label: new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila',
        weekday: 'short',
      }).format(date),
      total,
    };
  });

  return {
    sales,
    orders: todayOrders.length,
    pendingOrders,
    products: products.data?.length ?? 0,
    employees: employees.data?.length ?? 0,
    activeDeliveries,
    dailySales,
  };
}

export { getRestaurantSales } from './salesRepository';
