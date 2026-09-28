import { createContext, type ReactNode, useContext } from 'react';
import type { RestaurantConfig } from '../types/restaurant';

type RestaurantContextValue = RestaurantConfig;

const RestaurantContext = createContext<RestaurantContextValue | null>(null);

type RestaurantProviderProps = {
  restaurant: RestaurantConfig;
  children: ReactNode;
};

export function RestaurantProvider({ restaurant, children }: RestaurantProviderProps) {
  return (
    <RestaurantContext.Provider value={restaurant}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  const restaurant = useContext(RestaurantContext);

  if (!restaurant) {
    throw new Error('useRestaurant must be used within RestaurantProvider');
  }

  return restaurant;
}
