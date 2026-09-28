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

export type RestaurantProduct = {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  imageUrl?: string;
  sortOrder: number;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};
