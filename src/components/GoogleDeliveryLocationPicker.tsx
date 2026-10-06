import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../services/googleMapsLoader';
type LatLng = { lat: number; lng: number };

export type GoogleDeliveryAddress = {
  formattedAddress: string;
  city: string;
  barangay: string;
  address: string;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
};

type GoogleMapsApi = {
  maps: {
    importLibrary: (library: string) => Promise<unknown>;
  };
};

type MapsLibrary = {
  Map: new (element: HTMLElement, options: {
    center: LatLng;
    zoom: number;
    mapId: string;
    gestureHandling?: string;
    streetViewControl?: boolean;
    mapTypeControl?: boolean;
    fullscreenControl?: boolean;
  }) => GoogleMap;
};

type MarkerLibrary = {
  AdvancedMarkerElement: new (options: {
    map: GoogleMap;
    position: LatLng;
    gmpDraggable?: boolean;
    title?: string;
  }) => GoogleMarker;
};

type GoogleGeocoder = {
  geocode: (
    request: { location: LatLng; region?: string },
    callback: (results: GoogleGeocodeResult[], status: string) => void,
  ) => void;
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  place_id?: string;
  address_components?: GoogleGeocodeComponent[];
};

type GeocoderLibrary = {
  Geocoder: new () => GoogleGeocoder;
};

type GoogleMap = {
  setCenter: (position: LatLng) => void;
  setZoom: (zoom: number) => void;
  addListener: (eventName: string, handler: (event: { latLng?: { lat: () => number; lng: () => number } }) => void) => { remove: () => void };
};

type GoogleMarker = {
  position?: LatLng | { lat: () => number; lng: () => number };
  addEventListener: (eventName: string, handler: () => void) => void;
};

type GoogleGeocodeComponent = {
  long_name?: string;
  longText?: string;
  types?: string[];
};

function componentText(components: GoogleGeocodeComponent[], types: string[]) {
  return components.find((component) => component.types?.some((type) => types.includes(type)))?.long_name?.trim()
    ?? components.find((component) => component.types?.some((type) => types.includes(type)))?.longText?.trim()
    ?? '';
}

function getLatLng(marker: GoogleMarker): LatLng | null {
  const position = marker.position;
  if (!position) return null;

  if (typeof position.lat === 'function' && typeof position.lng === 'function') {
    return { lat: position.lat(), lng: position.lng() };
  }

  if (typeof position.lat !== 'number' || typeof position.lng !== 'number') {
    return null;
  }

  return { lat: position.lat, lng: position.lng };
}

export function GoogleDeliveryLocationPicker({
  disabled = false,
  onSelect,
  variant = 'delivery',
  initialLatitude = null,
  initialLongitude = null,
}: {
  disabled?: boolean;
  onSelect: (address: GoogleDeliveryAddress) => void | Promise<void>;
  variant?: 'delivery' | 'restaurant';
  initialLatitude?: number | null;
  initialLongitude?: number | null;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const geocoderRef = useRef<GoogleGeocoder | null>(null);
  const reverseGeocodeRequestRef = useRef(0);
  const [searchPicker, setSearchPicker] = useState<HTMLElement | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<GoogleDeliveryAddress | null>(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  function placePin(location: LatLng) {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    marker.position = location;
    map.setCenter(location);

    setSelectedAddress((current) => {
      const updatedAddress: GoogleDeliveryAddress = current
        ? {
            ...current,
            latitude: location.lat,
            longitude: location.lng,
          }
        : {
            formattedAddress: '',
            city: '',
            barangay: '',
            address: '',
            placeId: '',
            latitude: location.lat,
            longitude: location.lng,
          };

      setLocationConfirmed(false);
      return updatedAddress;
    });
  }

  function reverseGeocode(location: LatLng) {
    const geocoder = geocoderRef.current;
    if (!geocoder) {
      setError('Google address lookup is still loading. Please try again in a moment.');
      return;
    }

    const requestId = ++reverseGeocodeRequestRef.current;
    geocoder.geocode({ location, region: 'PH' }, (results, status) => {
      if (requestId !== reverseGeocodeRequestRef.current) return;

      if (status !== 'OK' || !results.length) {
        console.error('Google reverse geocoding failed.', { status, location });
        setError(
          status === 'REQUEST_DENIED'
            ? 'Google address lookup was denied for this map key. The map pin still works; you can enter the address manually.'
            : status === 'ZERO_RESULTS'
              ? 'Google could not match this pin to a street address. You can still move the pin and enter the address manually.'
              : `Google address lookup failed (${status}). You can still move the pin and enter the address manually.`,
        );
        return;
      }

      const result = results[0];
      const components = result.address_components ?? [];
      const city = componentText(components, ['locality', 'administrative_area_level_2']);
      const barangay = componentText(components, [
        'sublocality_level_1',
        'sublocality_level_2',
        'sublocality',
        'neighborhood',
      ]);
      const street = componentText(components, ['route']);
      const streetNumber = componentText(components, ['street_number']);
      const premise = componentText(components, ['premise', 'subpremise']);
      const address = [streetNumber, street, premise].filter(Boolean).join(' ').trim()
        || result.formatted_address?.trim()
        || '';

      const nextAddress: GoogleDeliveryAddress = {
        formattedAddress: result.formatted_address?.trim() || '',
        city,
        barangay,
        address,
        placeId: result.place_id?.trim() || '',
        latitude: location.lat,
        longitude: location.lng,
      };

      setSelectedAddress(nextAddress);
      setLocationConfirmed(false);
      setError('');
    });
  }

  function movePinAndReverseGeocode(location: LatLng) {
    placePin(location);
    reverseGeocode(location);
  }

  useEffect(() => {
    let cancelled = false;
    let searchElement: HTMLElement | null = null;
    let mapClickListener: { remove: () => void } | null = null;

    async function setup() {
      setLoading(true);
      setError('');

      try {
        await loadGoogleMaps();
        const googleMaps = (window as Window & { google?: GoogleMapsApi }).google;
        if (!googleMaps?.maps?.importLibrary || !mapContainerRef.current || cancelled) return;

        const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([
          googleMaps.maps.importLibrary('maps') as Promise<MapsLibrary>,
          googleMaps.maps.importLibrary('marker') as Promise<MarkerLibrary>,
        ]);

        if (cancelled || !mapContainerRef.current) return;

        const defaultCenter = Number.isFinite(initialLatitude) && Number.isFinite(initialLongitude)
          ? { lat: Number(initialLatitude), lng: Number(initialLongitude) }
          : { lat: 14.6760, lng: 120.9780 };
        const map = new Map(mapContainerRef.current, {
          center: defaultCenter,
          zoom: 13,
          mapId: 'DEMO_MAP_ID',
          gestureHandling: 'greedy',
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });

        const marker = new AdvancedMarkerElement({
          map,
          position: defaultCenter,
          gmpDraggable: true,
          title: variant === 'restaurant' ? 'Restaurant location' : 'Drag this pin to your exact delivery location',
        });

        const { Geocoder } = await googleMaps.maps.importLibrary('geocoding') as GeocoderLibrary;
        geocoderRef.current = new Geocoder();

        mapRef.current = map;
        markerRef.current = marker;

        marker.addEventListener('gmp-dragend', () => {
          const location = getLatLng(marker);
          if (location) movePinAndReverseGeocode(location);
        });

        mapClickListener = map.addListener('click', (event) => {
          const location = event.latLng
            ? { lat: event.latLng.lat(), lng: event.latLng.lng() }
            : null;
          if (location) movePinAndReverseGeocode(location);
        });

        const picker = document.createElement('gmp-place-autocomplete');
        picker.setAttribute('placeholder', variant === 'restaurant' ? 'Search the restaurant address' : 'Search your delivery address');
        picker.setAttribute('included-region-codes', 'ph');
        picker.setAttribute('requested-language', 'en');
        picker.style.display = 'block';
        picker.style.width = '100%';

        const handleSearchSelect = async (event: Event) => {
          const placePrediction = (event as Event & {
            placePrediction?: {
              toPlace: () => {
                id?: string;
                formattedAddress?: string;
                location?: { lat: () => number; lng: () => number };
                addressComponents?: GoogleGeocodeComponent[];
                fetchFields: (options: { fields: string[] }) => Promise<void>;
              };
            };
          }).placePrediction;

          if (!placePrediction) {
            setError('We could not read that address. Please select an address from the Google suggestions.');
            return;
          }

          try {
            const place = placePrediction.toPlace();
            await place.fetchFields({
              fields: ['id', 'formattedAddress', 'location', 'addressComponents'],
            });

            const location = place.location
              ? { lat: place.location.lat(), lng: place.location.lng() }
              : null;
            if (!location) {
              setError('Google did not return a map location for that address.');
              return;
            }

            const components = place.addressComponents ?? [];
            const city = componentText(components, ['locality', 'administrative_area_level_2']);
            const barangay = componentText(components, [
              'sublocality_level_1',
              'sublocality_level_2',
              'sublocality',
              'neighborhood',
            ]);
            const street = componentText(components, ['route']);
            const streetNumber = componentText(components, ['street_number']);
            const premise = componentText(components, ['premise', 'subpremise']);
            const address = [streetNumber, street, premise].filter(Boolean).join(' ').trim()
              || place.formattedAddress?.trim()
              || '';

            const nextAddress: GoogleDeliveryAddress = {
              formattedAddress: place.formattedAddress?.trim() || '',
              city,
              barangay,
              address,
              placeId: place.id?.trim() || '',
              latitude: location.lat,
              longitude: location.lng,
            };

            if (mapRef.current) {
              mapRef.current.setCenter(location);
              mapRef.current.setZoom(17);
            }
            if (markerRef.current) {
              markerRef.current.position = location;
            }

            setSelectedAddress(nextAddress);
            setLocationConfirmed(false);
            setError('');
          } catch (selectionError) {
            console.error('Unable to read the selected Google address.', selectionError);
            setError('We could not read that address. Please select another result.');
          }
        };

        picker.addEventListener('gmp-select', handleSearchSelect as EventListener);
        mapContainerRef.current.parentElement?.insertBefore(picker, mapContainerRef.current);
        searchElement = picker;
        setSearchPicker(picker);
      } catch (setupError) {
        console.error('Unable to initialize Google delivery map.', setupError);
        setError(setupError instanceof Error ? setupError.message : 'Google Maps is unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void setup();

    return () => {
      cancelled = true;
      mapClickListener?.remove();
      if (searchElement) searchElement.remove();
      mapRef.current = null;
      markerRef.current = null;
      geocoderRef.current = null;
    };
  }, []);

  useEffect(() => {
    const picker = searchPicker;
    if (picker) picker.toggleAttribute('disabled', disabled);
  }, [disabled, searchPicker]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError('Your browser does not provide location services. Search your address or move the pin manually.');
      return;
    }

    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lng: position.coords.longitude };
        movePinAndReverseGeocode(location);
        setLocating(false);
      },
      (locationError) => {
        console.error('Unable to read the customer location.', locationError);
        setLocating(false);
        setError('We could not access your current location. Please allow location access or move the pin manually.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div className="google-delivery-location-picker">
      <p className="checkout-hint">{variant === 'restaurant' ? 'Search the restaurant address or move the pin to the exact restaurant location.' : 'Search your address, use your current location, or move the pin to the exact place where you want the order delivered.'}</p>
      <div className="google-delivery-map" ref={mapContainerRef} aria-label="Delivery location map" />
      <div className="google-delivery-map-actions">
        <button className="button button-secondary" type="button" onClick={useCurrentLocation} disabled={disabled || loading || locating}>
          {locating ? 'Finding your location…' : variant === 'restaurant' ? 'Use my current location' : 'Use my current location'}
        </button>
        <span>{variant === 'restaurant' ? 'Move the pin or tap the map to set the restaurant location.' : 'Drag the pin or tap the map to adjust it.'}</span>
      </div>
      {selectedAddress && (
        <div className="google-delivery-location-confirmation">
          <strong>{locationConfirmed ? (variant === 'restaurant' ? 'Restaurant location confirmed' : 'Delivery location confirmed') : (variant === 'restaurant' ? 'Confirm restaurant location' : 'Confirm your delivery location')}</strong>
          <span>{selectedAddress.formattedAddress || selectedAddress.address || 'Exact map location selected. Complete the address details below.'}</span>
          {(selectedAddress.city || selectedAddress.barangay) && <small>{selectedAddress.city}{selectedAddress.barangay ? `, ${selectedAddress.barangay}` : ''}</small>}
          <button
            className="button button-primary"
            type="button"
            onClick={async () => {
              setConfirming(true);
              setError('');
              try {
                await onSelectRef.current(selectedAddress);
                setLocationConfirmed(true);
              } catch (confirmationError) {
                console.error('Unable to confirm delivery location.', confirmationError);
                setError(confirmationError instanceof Error ? confirmationError.message : 'We could not confirm this location. Please try again.');
                setLocationConfirmed(false);
              } finally {
                setConfirming(false);
              }
            }}
            disabled={disabled || locationConfirmed || confirming}
          >
            {locationConfirmed ? (variant === 'restaurant' ? 'Restaurant Location Confirmed' : 'Location Confirmed') : confirming ? 'Confirming Location…' : (variant === 'restaurant' ? 'Confirm Restaurant Location' : 'Confirm Location')}
          </button>
        </div>
      )}
      {error && <p className="checkout-error" role="alert">{error}</p>}
    </div>
  );
}
