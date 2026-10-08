import type { RestaurantProduct } from '../../types/menu';

export type CartItem = {
  product: RestaurantProduct;
  quantity: number;
};
