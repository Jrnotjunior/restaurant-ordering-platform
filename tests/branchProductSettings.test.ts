import { describe, expect, it } from 'vitest';
import type { RestaurantProduct } from '../src/types/menu';
import { applyBranchProductSetting, type BranchProductSetting } from '../src/modules/products/branchProductRepository';

const baseProduct: RestaurantProduct = {
  id: 'product-1',
  restaurantId: 'restaurant-1',
  categoryId: 'category-1',
  name: 'Chicken Rice',
  slug: 'chicken-rice',
  description: 'Chicken and rice',
  price: 120,
  sortOrder: 1,
  isAvailable: true,
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
};

describe('branch product settings', () => {
  it('inherits the shared catalog when a branch has no override', () => {
    const product = applyBranchProductSetting(baseProduct);
    expect(product.isAvailable).toBe(true);
    expect(product.price).toBe(120);
  });

  it('can hide a globally available product at one branch', () => {
    const setting: BranchProductSetting = { productId: baseProduct.id, isAvailable: false, priceOverride: null };
    const product = applyBranchProductSetting(baseProduct, setting);
    expect(product.isAvailable).toBe(false);
    expect(product.price).toBe(120);
  });

  it('uses a branch price override without changing the shared catalog price', () => {
    const setting: BranchProductSetting = { productId: baseProduct.id, isAvailable: true, priceOverride: 135 };
    const product = applyBranchProductSetting(baseProduct, setting);
    expect(product.price).toBe(135);
    expect(baseProduct.price).toBe(120);
  });

  it('cannot make a globally unavailable product available at one branch', () => {
    const setting: BranchProductSetting = { productId: baseProduct.id, isAvailable: true, priceOverride: 135 };
    const product = applyBranchProductSetting({ ...baseProduct, isAvailable: false }, setting);
    expect(product.isAvailable).toBe(false);
    expect(product.price).toBe(135);
  });
});
