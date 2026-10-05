import { useEffect, useRef, useState } from 'react';

export type DeliveryCoordinate = { latitude: number; longitude: number };

type Props = {
  center: DeliveryCoordinate;
  marker: DeliveryCoordinate | null;
  radiusKm: number;
  interactive?: boolean;
  onMarkerChange?: (coordinate: DeliveryCoordinate) => void;
  height?: number;
};

type GoogleMapsApi = {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => any;
    Marker: new (options: Record<string, unknown>) => any;
    Circle: new (options: Record<string, unknown>) => any;
    ControlPosition: { RIGHT_TOP: unknown };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsApi;
  }
}

let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google);

  if (googleMapsPromise) return googleMapsPromise;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is not configured. Add VITE_GOOGLE_MAPS_API_KEY to your local .env file.'));
  }

  googleMapsPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-web2table-google-maps]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        if (window.google?.maps) resolve(window.google);
        else reject(new Error('Google Maps loaded without the Maps JavaScript API.'));
      }, { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Google Maps could not be loaded. Check the API key and allowed website restrictions.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.web2tableGoogleMaps = 'true';
    script.onload = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error('Google Maps loaded without the Maps JavaScript API.'));
    };
    script.onerror = () => reject(new Error('Google Maps could not be loaded. Check the API key and allowed website restrictions.'));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

export function DeliveryCoverageMap({
  center,
  marker,
  radiusKm,
  interactive = false,
  onMarkerChange,
  height = 360,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const onMarkerChangeRef = useRef(onMarkerChange);
  const [loadError, setLoadError] = useState('');

  onMarkerChangeRef.current = onMarkerChange;

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
          center: { lat: center.latitude, lng: center.longitude },
          zoom: Math.max(10, Math.min(16, 14 - Math.log2(Math.max(radiusKm, 1) / 2))),
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        });

        const circle = new google.maps.Circle({
          map,
          center: { lat: center.latitude, lng: center.longitude },
          radius: Math.max(radiusKm, 0.1) * 1000,
          fillColor: '#2563eb',
          fillOpacity: 0.14,
          strokeColor: '#2563eb',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          clickable: false,
        });

        mapRef.current = map;
        circleRef.current = circle;

        if (interactive) {
          map.addListener('click', (event: any) => {
            if (event.latLng) {
              onMarkerChangeRef.current?.({
                latitude: event.latLng.lat(),
                longitude: event.latLng.lng(),
              });
            }
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Google Maps could not be loaded.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    const circle = circleRef.current;
    if (!map || !circle) return;

    map.setCenter({ lat: center.latitude, lng: center.longitude });
    circle.setCenter({ lat: center.latitude, lng: center.longitude });
    circle.setRadius(Math.max(radiusKm, 0.1) * 1000);
  }, [center.latitude, center.longitude, radiusKm]);

  useEffect(() => {
    const map = mapRef.current;
    const google = window.google;
    if (!map || !google?.maps) return;

    if (markerRef.current) {
      markerRef.current.setMap(null);
      markerRef.current = null;
    }

    if (!marker) return;

    const mapMarker = new google.maps.Marker({
      map,
      position: { lat: marker.latitude, lng: marker.longitude },
      draggable: interactive,
      title: interactive ? 'Drag or click the map to move the location' : 'Selected delivery location',
    });

    if (interactive) {
      mapMarker.addListener('dragend', () => {
        const position = mapMarker.getPosition();
        if (!position) return;
        onMarkerChangeRef.current?.({
          latitude: position.lat(),
          longitude: position.lng(),
        });
      });
    }

    markerRef.current = mapMarker;
  }, [marker?.latitude, marker?.longitude, interactive]);

  useEffect(() => () => {
    markerRef.current?.setMap(null);
    circleRef.current?.setMap(null);
    markerRef.current = null;
    circleRef.current = null;
    mapRef.current = null;
  }, []);

  return (
    <div className="delivery-map-shell">
      <div
        className="delivery-map"
        ref={containerRef}
        style={{ height }}
        aria-label={interactive ? 'Interactive delivery coverage map' : 'Delivery coverage map'}
      />
      {loadError && (
        <div className="delivery-map-error" role="alert">
          {loadError}
        </div>
      )}
    </div>
  );
}
