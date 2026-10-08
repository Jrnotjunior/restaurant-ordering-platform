import type { RestaurantProduct } from '../../types/menu';
import {
  createProduct as createProductRepository,
  deleteProduct as deleteProductRepository,
  getMenu as getMenuRepository,
  getOrCreateCategory as getOrCreateCategoryRepository,
  setProductAvailability as setProductAvailabilityRepository,
  updateProduct as updateProductRepository,
} from '../../services/menuRepository';
import {
  saveProductImage as saveProductImageRepository,
  uploadProductImage as uploadProductImageRepository,
} from '../../services/productImageRepository';

export const getMenu = getMenuRepository;
export const getOrCreateCategory = getOrCreateCategoryRepository;
export const setProductAvailability = setProductAvailabilityRepository;
export const createProduct = createProductRepository;
export const updateProduct = updateProductRepository;
export const deleteProduct = deleteProductRepository;
export const uploadProductImage = uploadProductImageRepository;
export const saveProductImage = saveProductImageRepository;

export type ProductUpdateValues = {
  name: string;
  description: string;
  price: number;
  categoryId: string;
};

export type ProductCreateValues = {
  restaurantId: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
};

export type { RestaurantProduct };
