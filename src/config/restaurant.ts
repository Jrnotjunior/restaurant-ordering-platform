import { defaultRestaurant } from './defaultRestaurant';
import { ConfigRestaurantRepository } from '../modules/restaurant/restaurantService';

export const restaurantRepository = new ConfigRestaurantRepository(defaultRestaurant);

export const currentRestaurantLookup = {
  slug: import.meta.env.VITE_RESTAURANT_SLUG?.trim() ?? ''
};
