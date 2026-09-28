import { defaultRestaurant } from './defaultRestaurant';
import { ConfigRestaurantRepository } from '../services/restaurantService';

export const restaurantRepository = new ConfigRestaurantRepository(defaultRestaurant);

export const currentRestaurantLookup = {
  slug: 'your-restaurant'
};
