import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseGet } from '../services/supabaseClient';

export type OwnerRestaurant = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  logo_url: string | null;
  location_text: string | null;
  contact_number: string | null;
  email: string | null;
  is_active: boolean;
};

type RestaurantOwnerAuthValue = {
  user: User | null;
  restaurant: OwnerRestaurant | null;
  loading: boolean;
  error: string;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshRestaurant: () => Promise<void>;
};

const RestaurantOwnerAuthContext = createContext<RestaurantOwnerAuthValue | null>(null);

export function RestaurantOwnerAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restaurant, setRestaurant] = useState<OwnerRestaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadRestaurant(currentUser: User | null) {
    if (!currentUser) {
      setRestaurant(null);
      return;
    }

    const rows = await supabaseGet<OwnerRestaurant>('restaurants', {
      select: 'id,slug,name,tagline,logo_url,location_text,contact_number,email,is_active',
      owner_id: `eq.${currentUser.id}`,
      is_active: 'eq.true',
      limit: '1',
    });

    setRestaurant(rows[0] ?? null);
  }

  useEffect(() => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    let mounted = true;

    let authListener: { subscription: { unsubscribe: () => void } } | null = null;

    // Wait for Supabase Auth to finish its initial session recovery before
    // registering the auth listener. Registering the listener during auth
    // initialization can race with token refresh on page reload and leave
    // the app stuck on the authentication loading screen.
    const initializeAuth = async () => {
      try {
        const { data, error: userError } = await supabase.auth.getUser();

        if (!mounted) return;

        if (userError) {
          // A missing/expired session is a normal signed-out state.
          setUser(null);
          setRestaurant(null);
          if (userError.name !== 'AuthSessionMissingError') {
            setError(userError.message);
          }
        } else {
          const currentUser = data.user ?? null;
          setUser(currentUser);
          await loadRestaurant(currentUser);
        }
      } catch (authError) {
        if (mounted) {
          setUser(null);
          setRestaurant(null);
          setError(authError instanceof Error ? authError.message : 'Unable to restore your session.');
        }
      } finally {
        if (mounted) setLoading(false);
      }

      if (!mounted) return;

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (!currentUser) {
          setRestaurant(null);
          setError('');
          return;
        }

        void loadRestaurant(currentUser).catch((restaurantError) => {
          if (mounted) {
            setError(
              restaurantError instanceof Error
                ? restaurantError.message
                : 'Unable to load your restaurant.',
            );
          }
        });
      });

      authListener = data;
    };

    void initializeAuth();

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error('Supabase is not configured.');
    setError('');
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) throw signInError;
    setUser(data.user);
    await loadRestaurant(data.user);
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    setUser(null);
    setRestaurant(null);
  }

  async function refreshRestaurant() {
    await loadRestaurant(user);
  }

  const value = useMemo(() => ({ user, restaurant, loading, error, signIn, signOut, refreshRestaurant }), [user, restaurant, loading, error]);

  return <RestaurantOwnerAuthContext.Provider value={value}>{children}</RestaurantOwnerAuthContext.Provider>;
}

export function useRestaurantOwnerAuth() {
  const value = useContext(RestaurantOwnerAuthContext);
  if (!value) throw new Error('useRestaurantOwnerAuth must be used within RestaurantOwnerAuthProvider');
  return value;
}
