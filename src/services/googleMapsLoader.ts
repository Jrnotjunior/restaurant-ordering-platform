const GOOGLE_MAPS_SCRIPT_ID = 'web2table-google-maps-script';
const GOOGLE_MAPS_CALLBACK = '__web2tableGoogleMapsLoaded';

let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (loadPromise) return loadPromise;

  const apiKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps is not configured. Add VITE_GOOGLE_MAPS_API_KEY to the environment.'));
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      reject(new Error('Google Maps is already loading. Please wait and try again.'));
      return;
    }

    const globalWindow = window as Window & {
      [GOOGLE_MAPS_CALLBACK]?: () => void;
    };

    globalWindow[GOOGLE_MAPS_CALLBACK] = () => {
      delete globalWindow[GOOGLE_MAPS_CALLBACK];
      resolve();
    };

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${GOOGLE_MAPS_CALLBACK}`;
    script.onerror = () => {
      delete globalWindow[GOOGLE_MAPS_CALLBACK];
      reject(new Error('Unable to load Google Maps. Check the API key and API restrictions.'));
    };
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
