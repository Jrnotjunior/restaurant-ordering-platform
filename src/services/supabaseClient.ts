import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function getRestaurantContextHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  const hostname = window.location.hostname.trim().toLowerCase();
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const headers: Record<string, string> = {};

  if (!isLocalHost && hostname) {
    headers['x-restaurant-domain'] = hostname;
  }

  const configuredSlug = String(import.meta.env.VITE_RESTAURANT_SLUG ?? '').trim();
  if (configuredSlug) {
    headers['x-restaurant-slug'] = configuredSlug;
  }

  return headers;
}

function getRestaurantAuthStorageKey(): string {
  if (typeof window === 'undefined') return 'restaurant-ordering-platform-auth';

  // Keep the per-tab identifier in sessionStorage. Unlike window.name, this
  // storage is scoped to this origin and survives the cross-domain Google
  // OAuth round trip when the browser returns to this tab.
  const storageKey = 'restaurant-ordering-platform-tab-id';
  let tabId = '';

  try {
    tabId = window.sessionStorage.getItem(storageKey) ?? '';

    // Migrate the previous window.name identifier when available so existing
    // tabs can keep using their current Supabase auth storage key.
    if (!tabId && window.name.startsWith('restaurant-ordering-tab:')) {
      tabId = window.name.slice('restaurant-ordering-tab:'.length);
    }

    if (!tabId) {
      tabId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    window.sessionStorage.setItem(storageKey, tabId);
  } catch {
    // If storage is unavailable, use a stable-in-this-context fallback.
    // The normal browser path above is expected to use sessionStorage.
    const existingTabId = window.name.startsWith('restaurant-ordering-tab:')
      ? window.name.slice('restaurant-ordering-tab:'.length)
      : '';
    tabId = existingTabId || (
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
  }

  return `restaurant-ordering-platform-auth:${tabId}`;
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        // Each restaurant browser tab gets an independent Auth session.
        // This prevents Store Owner, Cashier, Kitchen, and Dispatcher tabs
        // from broadcasting their sign-in state to one another.
        storageKey: getRestaurantAuthStorageKey(),
        storage: window.sessionStorage,
        // Tenant invitation callbacks are explicitly handled after a user click.
        detectSessionInUrl: false,
      },
      global: {
        headers: getRestaurantContextHeaders(),
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

async function getAuthorizationHeaders() {
  const accessToken = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  return accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : { Authorization: `Bearer ${supabaseAnonKey ?? ''}` };
}

export async function supabaseGet<T>(path: string, params: Record<string, string>): Promise<T[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const searchParams = new URLSearchParams(params);
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}?${searchParams.toString()}`, {
    headers: {
      apikey: supabaseAnonKey,
      ...getRestaurantContextHeaders(),
      Accept: 'application/json',
      ...(await getAuthorizationHeaders()),
    }
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const detail = errorBody.trim() ? ` ${errorBody.trim()}` : '';
    throw new Error(`Supabase request failed with status ${response.status}.${detail}`);
  }

  // Some Supabase/proxy responses can legitimately have an empty body.
  // Treat an empty successful response as an empty result instead of calling
  // response.json(), which throws "Unexpected end of JSON input".
  const responseText = await response.text();
  if (!responseText.trim()) return [];

  try {
    const data = JSON.parse(responseText);
    return Array.isArray(data) ? data as T[] : [data as T];
  } catch {
    throw new Error('Supabase returned an invalid JSON response.');
  }
}

export async function supabaseRpc<T>(functionName: string, body: Record<string, unknown>): Promise<T[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      ...getRestaurantContextHeaders(),
      ...(await getAuthorizationHeaders()),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const detail = errorBody.trim() ? ` ${errorBody.trim()}` : '';
    throw new Error(`Supabase RPC request failed with status ${response.status}.${detail}`);
  }

  const responseText = await response.text();
  if (!responseText.trim()) return [];

  try {
    const data = JSON.parse(responseText);
    return Array.isArray(data) ? data as T[] : [data as T];
  } catch {
    throw new Error(`Supabase RPC ${functionName} returned an invalid JSON response.`);
  }
}
