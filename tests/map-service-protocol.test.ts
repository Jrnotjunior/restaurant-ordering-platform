import { describe, expect, it } from 'vitest';
import {
  isPublicMapboxToken,
  normalizeSecureOrigin,
  parseMapboxDeliveryAddress,
} from '../src/modules/location/mapServiceProtocol';

describe('central map service protocol', () => {
  it('accepts only public Mapbox tokens for browser initialization', () => {
    expect(isPublicMapboxToken('pk.example-public-token')).toBe(true);
    expect(isPublicMapboxToken(' sk.example-public-token ')).toBe(false);
    expect(isPublicMapboxToken('sk.example-secret-token')).toBe(false);
    expect(isPublicMapboxToken('')).toBe(false);
    expect(isPublicMapboxToken(null)).toBe(false);
  });

  it('accepts HTTPS storefront origins and rejects insecure or opaque origins', () => {
    expect(normalizeSecureOrigin('https://restaurant.example')).toBe('https://restaurant.example');
    expect(normalizeSecureOrigin('http://restaurant.example')).toBeNull();
    expect(normalizeSecureOrigin('null')).toBeNull();
    expect(normalizeSecureOrigin('https://restaurant.example/path')).toBeNull();
    expect(normalizeSecureOrigin('javascript:alert(1)')).toBeNull();
  });

  it('allows localhost origins only when explicitly in development mode', () => {
    expect(normalizeSecureOrigin('http://localhost:5173')).toBeNull();
    expect(normalizeSecureOrigin('http://localhost:5173', true)).toBe('http://localhost:5173');
    expect(normalizeSecureOrigin('http://evil.example', true)).toBeNull();
  });

  it('accepts well-formed delivery address messages with exact coordinates', () => {
    const address = {
      formattedAddress: '1 Example Street, Caloocan, Philippines',
      city: 'Caloocan',
      barangay: 'Example',
      address: '1 Example Street',
      placeId: 'mapbox-id',
      latitude: 14.65,
      longitude: 120.97,
    };
    expect(parseMapboxDeliveryAddress(address)).toEqual(address);
  });

  it('rejects forged address payloads and out-of-range coordinates', () => {
    expect(parseMapboxDeliveryAddress(null)).toBeNull();
    expect(parseMapboxDeliveryAddress({ latitude: 14, longitude: 120 })).toBeNull();
    expect(parseMapboxDeliveryAddress({
      formattedAddress: '',
      city: '',
      barangay: '',
      address: '',
      placeId: '',
      latitude: 100,
      longitude: 120,
    })).toBeNull();
  });
});
