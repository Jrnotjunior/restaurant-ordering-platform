import { useEffect, useRef, useState } from 'react';
import { MapboxLocationPickerUi, type MapboxDeliveryAddress } from '../components/MapboxLocationPickerUi';
import { configureMapboxPublicToken } from '../modules/location/locationService';
import { supabaseGet, supabaseRpc } from '../services/supabaseClient';

type PickerVariant = 'delivery' | 'restaurant';
type InitOptions = {
  variant: PickerVariant;
  disabled: boolean;
  initialLatitude: number | null;
  initialLongitude: number | null;
};
type MapSession = InitOptions & { parentOrigin: string };
type StorefrontMessage = { source: 'web2table-storefront'; type: string; [key: string]: unknown };
type PendingConfirmation = { resolve: () => void; reject: (error: Error) => void };

const MESSAGE_SOURCE = 'web2table-map-service';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function nullableCoordinate(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
}

function parseInit(value: unknown): InitOptions | null {
  const message = record(value);
  if (!message || message.source !== 'web2table-storefront' || message.type !== 'init') return null;
  if (message.variant !== 'delivery' && message.variant !== 'restaurant') return null;
  const latitude = nullableCoordinate(message.initialLatitude, -90, 90);
  const longitude = nullableCoordinate(message.initialLongitude, -180, 180);
  if ((latitude === null) !== (longitude === null)) return null;
  return {
    variant: message.variant,
    disabled: message.disabled === true,
    initialLatitude: latitude,
    initialLongitude: longitude,
  };
}

function postToParent(parentOrigin: string, message: Record<string, unknown>) {
  window.parent.postMessage({ source: MESSAGE_SOURCE, ...message }, parentOrigin);
}

function publicConfigUrl() {
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('Central map configuration is unavailable.');
  return `${baseUrl}/functions/v1/mapbox-public-config`;
}

async function loadPublicToken(): Promise<string> {
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!anonKey) throw new Error('Central map configuration is unavailable.');
  const response = await fetch(publicConfigUrl(), {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as { token?: unknown; error?: unknown };
  if (!response.ok || typeof body.token !== 'string' || !body.token.startsWith('pk.')) {
    throw new Error(typeof body.error === 'string' ? body.error : 'The central map service is not configured yet.');
  }
  return body.token;
}

async function verifyTenantOrigin(origin: string) {
  const host = new URL(origin).hostname.toLowerCase();
  // GitHub Pages is an explicitly scoped temporary storefront used for manual
  // testing; every other browser origin must resolve to an active tenant domain.
  if (host === 'jrnotjunior.github.io') {
    const slug = String(import.meta.env.VITE_RESTAURANT_SLUG ?? '').trim();
    if (!slug) return false;
    const restaurants = await supabaseGet<{ id: string }>('restaurants', {
      select: 'id',
      slug: `eq.${slug}`,
      is_active: 'eq.true',
      limit: '1',
    });
    return restaurants.length > 0;
  }

  const restaurants = await supabaseRpc<{ id?: string }>('resolve_restaurant_by_domain', {
    p_hostname: host,
  });
  return restaurants.length > 0;
}

export function MapServiceApp() {
  const [session, setSession] = useState<MapSession | null>(null);
  const [status, setStatus] = useState('Waiting for a Web2Table storefront…');
  const [serviceError, setServiceError] = useState('');
  const setupOriginRef = useRef<string | null>(null);
  const validatedSessionRef = useRef<MapSession | null>(null);
  const setupGenerationRef = useRef(0);
  const pendingConfirmationsRef = useRef(new Map<string, PendingConfirmation>());

  useEffect(() => {
    let disposed = false;

    async function handleInit(event: MessageEvent<unknown>, options: InitOptions) {
      if (event.origin === 'null') return;
      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(event.origin);
      } catch {
        return;
      }
      const secure = parsedOrigin.protocol === 'https:'
        || (import.meta.env.DEV && ['localhost', '127.0.0.1', '::1'].includes(parsedOrigin.hostname) && parsedOrigin.protocol === 'http:');
      if (!secure) return;

      const existing = validatedSessionRef.current;
      if (existing?.parentOrigin === event.origin) {
        const updated = { ...existing, ...options };
        validatedSessionRef.current = updated;
        setSession(updated);
        postToParent(event.origin, { type: 'ready' });
        return;
      }
      if (setupOriginRef.current === event.origin) return;

      const generation = ++setupGenerationRef.current;
      setupOriginRef.current = event.origin;
      validatedSessionRef.current = null;
      setSession(null);
      setServiceError('');
      setStatus('Verifying restaurant website…');

      try {
        const isRegisteredTenant = await verifyTenantOrigin(event.origin);
        if (disposed || generation !== setupGenerationRef.current) return;
        if (!isRegisteredTenant) throw new Error('This map is available only inside an active Web2Table restaurant website.');

        setStatus('Connecting to the central map account…');
        const token = await loadPublicToken();
        if (disposed || generation !== setupGenerationRef.current) return;
        configureMapboxPublicToken(token);

        const next: MapSession = { ...options, parentOrigin: event.origin };
        validatedSessionRef.current = next;
        setSession(next);
        setStatus('');
        postToParent(event.origin, { type: 'ready' });
      } catch (error) {
        if (disposed || generation !== setupGenerationRef.current) return;
        const message = error instanceof Error ? error.message : 'The central map service could not be initialized.';
        setServiceError(message);
        setStatus('');
        postToParent(event.origin, { type: 'service-error', message });
      }
    }

    function handleMessage(event: MessageEvent<unknown>) {
      if (event.source !== window.parent) return;
      const message = record(event.data);
      if (!message || message.source !== 'web2table-storefront' || typeof message.type !== 'string') return;

      const current = validatedSessionRef.current;
      if (message.type === 'location-selection-result') {
        if (!current || event.origin !== current.parentOrigin) return;
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        const pending = pendingConfirmationsRef.current.get(requestId);
        if (!pending || !requestId) return;
        pendingConfirmationsRef.current.delete(requestId);
        if (message.ok === true) pending.resolve();
        else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Unable to confirm the selected location.'));
        return;
      }

      const options = parseInit(event.data);
      if (!options) return;
      void handleInit(event, options);
    }

    window.addEventListener('message', handleMessage);
    // This message contains no tenant or location data; the parent validates
    // the sender's origin and window before returning initialization options.
    if (window.parent !== window) {
      window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'ready' }, '*');
    }

    return () => {
      disposed = true;
      setupGenerationRef.current += 1;
      window.removeEventListener('message', handleMessage);
      pendingConfirmationsRef.current.forEach((pending) => pending.reject(new Error('The map service was closed.')));
      pendingConfirmationsRef.current.clear();
    };
  }, []);

  async function confirmLocation(address: MapboxDeliveryAddress) {
    const current = validatedSessionRef.current;
    if (!current) throw new Error('The map service is not connected to the storefront.');
    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `location-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise<void>((resolve, reject) => {
      pendingConfirmationsRef.current.set(requestId, { resolve, reject });
      postToParent(current.parentOrigin, { type: 'location-selected', requestId, address });
    });
  }

  function notifyLocationChanged() {
    const current = validatedSessionRef.current;
    if (current) postToParent(current.parentOrigin, { type: 'location-changed' });
  }

  if (!session) {
    return (
      <main className="map-service-page">
        <div className={serviceError ? 'map-service-status is-error' : 'map-service-status'} role={serviceError ? 'alert' : 'status'}>
          <strong>{serviceError ? 'Map unavailable' : 'Web2Table central map'}</strong>
          <p>{serviceError || status}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="map-service-page">
      <MapboxLocationPickerUi
        key={`${session.variant}:${session.initialLatitude ?? ''}:${session.initialLongitude ?? ''}`}
        variant={session.variant}
        disabled={session.disabled}
        initialLatitude={session.initialLatitude}
        initialLongitude={session.initialLongitude}
        onLocationChange={notifyLocationChanged}
        onSelect={confirmLocation}
      />
      {serviceError && <p className="map-service-status is-error" role="alert">{serviceError}</p>}
    </main>
  );
}
