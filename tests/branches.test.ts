import { describe, expect, it } from 'vitest';
import {
  BRANCH_DAYS,
  DEFAULT_BRANCH_HOURS,
  branchToDraft,
  makeDefaultBranchDraft,
  type RestaurantBranch,
} from '../src/modules/branches/branchTypes';

describe('multi-branch domain defaults', () => {
  it('creates a fresh branch draft with safe location defaults', () => {
    const first = makeDefaultBranchDraft();
    const second = makeDefaultBranchDraft();

    expect(first.is_active).toBe(true);
    expect(first.ordering_enabled).toBe(true);
    expect(first.delivery_location_latitude).toBeNull();
    expect(first.delivery_location_longitude).toBeNull();
    expect(first.delivery_distance_increment_meters).toBeGreaterThan(0);
    expect(Object.keys(first.operating_hours)).toHaveLength(7);
    expect(BRANCH_DAYS.map(({ key }) => key)).toEqual(Object.keys(DEFAULT_BRANCH_HOURS));
    expect(first.operating_hours.monday).toEqual({ isOpen: true, open: '09:00', close: '21:00' });

    first.operating_hours.monday.open = '10:00';
    expect(second.operating_hours.monday.open).toBe('09:00');
  });

  it('normalizes nullable branch fields and fills missing days when editing', () => {
    const branch: RestaurantBranch = {
      id: 'branch-1',
      restaurant_id: 'business-1',
      branch_code: 'QC01',
      name: 'Quezon City',
      store_address: null,
      restaurant_address: '123 Main Street',
      contact_number: null,
      is_active: true,
      is_default: false,
      ordering_enabled: true,
      operating_hours: {
        monday: { isOpen: false, open: '10:00', close: '20:00' },
      },
      delivery_location_latitude: 14.6,
      delivery_location_longitude: 120.98,
      delivery_base_fee: 5,
      delivery_distance_increment_meters: 500,
      delivery_fee_per_increment: 10,
      delivery_max_distance_meters: 8000,
      created_at: '2026-10-20T00:00:00Z',
      updated_at: '2026-10-20T00:00:00Z',
    };

    const draft = branchToDraft(branch);

    expect(draft.store_address).toBe('123 Main Street');
    expect(draft.restaurant_address).toBe('123 Main Street');
    expect(draft.contact_number).toBe('');
    expect(draft.operating_hours.monday).toEqual({ isOpen: false, open: '10:00', close: '20:00' });
    expect(draft.operating_hours.tuesday).toEqual(DEFAULT_BRANCH_HOURS.tuesday);
    expect(draft.delivery_location_latitude).toBe(14.6);
    expect(draft.delivery_location_longitude).toBe(120.98);
    expect(draft.delivery_max_distance_meters).toBe(8000);
  });
});
