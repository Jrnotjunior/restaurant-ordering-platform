import type { User } from '@supabase/supabase-js';
import { currentRestaurantLookup } from '../../config/restaurant';
import { SupabaseRestaurantRepository } from '../../services/supabaseRestaurantRepository';
import { supabase } from '../../services/supabaseClient';

export type CustomerSignUpInput = {
  name: string;
  phone: string;
  email: string;
  password: string;
};

export type CustomerSignUpResult = {
  user: User | null;
  hasSession: boolean;
  emailConfirmationRequired: boolean;
};

function isLocalHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export async function getCurrentCustomerRestaurant() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const hostname = window.location.hostname.trim().toLowerCase();
  const repository = new SupabaseRestaurantRepository();

  const restaurant = await repository.getRestaurant(
    !isLocalHost(hostname) && hostname
      ? { domain: hostname }
      : { slug: currentRestaurantLookup.slug },
  );

  if (!restaurant?.id) {
    throw new Error('This restaurant could not be identified from the current website.');
  }

  return restaurant;
}

export async function signUpCustomer(input: CustomerSignUpInput): Promise<CustomerSignUpResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const restaurant = await getCurrentCustomerRestaurant();
  const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}#signup-confirmation`;

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        role: 'customer',
        name: input.name,
        phone: input.phone || null,
        restaurant_id: restaurant.id,
      },
      emailRedirectTo: redirectTo,
    },
  });

  if (error) throw error;

  if (data.session) {
    const { error: profileError } = await supabase.rpc('upsert_customer_profile', {
      p_restaurant_id: restaurant.id,
      p_name: input.name,
      p_phone: input.phone || null,
    });

    if (profileError) throw profileError;
  }

  return {
    user: data.user ?? null,
    hasSession: Boolean(data.session),
    emailConfirmationRequired: !data.session,
  };
}

export async function getCurrentCustomerUser(): Promise<User | null> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (error.name === 'AuthSessionMissingError') return null;
    throw error;
  }

  return data.user ?? null;
}
