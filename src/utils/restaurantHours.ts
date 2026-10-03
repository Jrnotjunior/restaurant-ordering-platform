import type { RestaurantOperatingHours } from '../types/restaurant';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function minutes(value: string) {
  const [hours, mins] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : NaN;
}

export function isRestaurantCurrentlyOpen(hours?: RestaurantOperatingHours) {
  if (!hours) return true;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const weekday = parts.find((part) => part.type === 'weekday')?.value.toLowerCase() ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const day = hours[weekday] ?? hours[DAY_KEYS.find((key) => key === weekday) ?? 'sunday'];

  if (!day || day.isOpen === false) return false;

  const current = hour * 60 + minute;
  const open = minutes(day.open);
  const close = minutes(day.close);

  if (!Number.isFinite(open) || !Number.isFinite(close)) return false;

  // Supports both normal hours (09:00–21:00) and overnight hours (21:00–02:00).
  if (open === close) return true;
  if (close > open) return current >= open && current < close;
  return current >= open || current < close;
}
