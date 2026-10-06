import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../services/googleMapsLoader';
import type { GoogleDeliveryAddress } from './GoogleDeliveryAddressPicker';

type LatLng = { lat: number; lng: number };

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
    request: { location: LatLng },
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
}: {
  disabled?: boolean;
  onSelect: (address: GoogleDeliveryAddress) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const geocoderRef = useRef<GoogleGeocoder | null>(null);
  const reverseGeocodeRequestRef = useRef(0);
  const [searchPicker, setSearchPicker] = useState<HTMLElement | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<GoogleDeliveryAddress | null>(null);
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

      onSelectRef.current(updatedAddress);
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
    geocoder.geocode({ location }, (results, status) => {
      if (requestId !== reverseGeocodeRequestRef.current) return;

      if (status !== 'OK' || !results.length) {
        setError('We could not find a street address for that location. You can still move the pin and enter the address manually.');
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
      onSelectRef.current(nextAddress);
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

        const defaultCenter = { lat: 14.6760, lng: 120.9780 };
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
          title: 'Drag this pin to your exact delivery location',
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
          if (location) placePin(location);
        });

        const picker = document.createElement('gmp-place-autocomplete');
        picker.setAttribute('placeholder', 'Search your delivery address');
        picker.setAttribute('included-region-codes', 'ph');
        picker.setAttribute('requested-language', 'en');
        picker.style.display = 'block';
        picker.style.width = '100%';

        const handleSearchSelect = async (event: Event) => {
          const place = (event as Event & { place?: {
            id?: string;
            formattedAddress?: string;
            location?: { lat: () => number; lng: () => number };
            addressComponents?: GoogleGeocodeComponent[];
            fetchFields: (options: { fields: string[] }) => Promise<void>;
          } }).place;
          if (!place) return;

          try {
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

            setSelectedAddress(nextAddress);
            onSelectRef.current(nextAddress);
            placePin(location);
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
      <p className="checkout-hint">Search your address, use your current location, or move the pin to the exact place where you want the order delivered.</p>
      <div className="google-delivery-map" ref={mapContainerRef} aria-label="Delivery location map" />
      <div className="google-delivery-map-actions">
        <button className="button button-secondary" type="button" onClick={useCurrentLocation} disabled={disabled || loading || locating}>
          {locating ? 'Finding your location…' : 'Use my current location'}
        </button>
        <span>Drag the pin or tap the map to adjust it.</span>
      </div>
      {selectedAddress && (
        <div className="google-delivery-location-confirmation">
          <strong>Delivery pin</strong>
          <span>{selectedAddress.formattedAddress || selectedAddress.address || 'Exact map location selected. Complete the address details below.'}</span>
          {(selectedAddress.city || selectedAddress.barangay) && <small>{selectedAddress.city}{selectedAddress.barangay ? `, ${selectedAddress.barangay}` : ''}</small>}
        </div>
      )}
      {error && <p className="checkout-error" role="alert">{error}</p>}
    </div>
  );
}
