import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../services/googleMapsLoader';

export type GoogleDeliveryAddress = {
  formattedAddress: string;
  city: string;
  barangay: string;
  address: string;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
};

type GooglePlaceComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type GooglePlace = {
  id?: string;
  formattedAddress?: string;
  location?: { lat: () => number; lng: () => number };
  addressComponents?: GooglePlaceComponent[];
  fetchFields: (options: { fields: string[] }) => Promise<void>;
};

type GooglePlaceSelectEvent = {
  place: GooglePlace;
};

type GoogleAutocompleteElement = HTMLElement & {
  value?: string;
  placeholder?: string;
  includedRegionCodes?: string[];
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

function componentText(components: GooglePlaceComponent[], types: string[]) {
  return components.find((component) => component.types?.some((type) => types.includes(type)))?.longText?.trim() ?? '';
}

export function GoogleDeliveryAddressPicker({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (address: GoogleDeliveryAddress) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let element: GoogleAutocompleteElement | null = null;

    async function setup() {
      setLoading(true);
      setError('');

      try {
        await loadGoogleMaps();
        if (!window.google?.maps?.importLibrary || !containerRef.current || cancelled) return;

        await window.google.maps.importLibrary('places');
        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = '';
        element = document.createElement('gmp-place-autocomplete') as GoogleAutocompleteElement;
        element.placeholder = 'Search your delivery address';
        element.setAttribute('placeholder', 'Search your delivery address');
        element.setAttribute('included-region-codes', 'ph');
        element.setAttribute('requested-language', 'en');
        element.style.display = 'block';
        element.style.width = '100%';

        const handleSelect = async (event: Event) => {
          const place = (event as CustomEvent<GooglePlaceSelectEvent>).detail?.place;
          if (!place) return;

          try {
            await place.fetchFields({
              fields: ['id', 'formattedAddress', 'location', 'addressComponents'],
            });

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
            const address = [streetNumber, street, premise]
              .filter(Boolean)
              .join(' ')
              .trim() || place.formattedAddress?.trim() || '';

            onSelect({
              formattedAddress: place.formattedAddress?.trim() || '',
              city,
              barangay,
              address,
              placeId: place.id?.trim() || '',
              latitude: place.location?.lat() ?? null,
              longitude: place.location?.lng() ?? null,
            });
          } catch (selectionError) {
            console.error('Unable to read the selected Google address.', selectionError);
            setError('We could not read that address. Please select another result.');
          }
        };

        element.addEventListener('gmp-select', handleSelect as EventListener);
        containerRef.current.appendChild(element);
      } catch (setupError) {
        console.error('Unable to initialize Google address search.', setupError);
        setError(setupError instanceof Error ? setupError.message : 'Google address search is unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void setup();
    return () => {
      cancelled = true;
      if (element) element.remove();
    };
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
    const input = containerRef.current.querySelector('gmp-place-autocomplete') as HTMLElement | null;
    if (input) input.toggleAttribute('disabled', disabled);
  }, [disabled, loading]);

  return (
    <div className="google-delivery-address-picker">
      <div ref={containerRef} />
      {loading && <p className="checkout-hint">Loading Google address search…</p>}
      {error && <p className="checkout-error" role="alert">{error}</p>}
      <p className="checkout-hint">Select the exact address from the Google results so we can identify the city and barangay.</p>
    </div>
  );
}
