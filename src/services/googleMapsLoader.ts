const GOOGLE_MAPS_SCRIPT_ID = 'web2table-google-maps-script';

let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  const apiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps is not configured. Add VITE_GOOGLE_MAPS_API_KEY to the environment.'));
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load Google Maps.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Google Maps. Check the API key and API restrictions.'));
    document.head.appendChild(script);
  });

  return loadPromise;
}

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary: (library: string) => Promise<unknown>;
      };
    };
  }
}

export {};
