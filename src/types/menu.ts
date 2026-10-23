export type RestaurantCategory = {
  id: string;
  restaurantId: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductTaxCategory = 'standard_rate' | 'vat_exempt' | 'zero_rated';

export type RestaurantProduct = {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  /** NULL/undefined means tax treatment has not been reviewed. */
  taxCategory?: ProductTaxCategory | null;
  imageUrl?: string;
  sortOrder: number;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};
