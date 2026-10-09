import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import {
  initializeAuthSession,
  resolveAccountContext,
  type AccountType,
  type OwnerRestaurant,
} from '../modules/auth/authService';

type RestaurantOwnerAuthValue = {
  user: User | null;
  restaurant: OwnerRestaurant | null;
  accountType: AccountType | null;
  staffRole: string | null;
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
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [staffRole, setStaffRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadAccountContext(currentUser: User | null) {
    if (!currentUser) {
      setRestaurant(null);
      setAccountType(null);
      setStaffRole(null);
      return;
    }

    const context = await resolveAccountContext(currentUser);
    setRestaurant(context.restaurant);
    setAccountType(context.accountType);
    setStaffRole(context.staffRole);
  }

  useEffect(() => {
    const client = supabase;

    if (!client) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    let mounted = true;
    let authListener: { subscription: { unsubscribe: () => void } } | null = null;

    const initializeAuth = async () => {
      try {
        await initializeAuthSession(client);

        const { data, error: userError } = await client.auth.getUser();

        if (!mounted) return;

        if (userError) {
          setUser(null);
          setRestaurant(null);
          setAccountType(null);
          setStaffRole(null);
          if (userError.name !== 'AuthSessionMissingError') {
            setError(userError.message);
          }
        } else {
          const currentUser = data.user ?? null;
          setUser(currentUser);
          await loadAccountContext(currentUser);
        }
      } catch (authError) {
        if (mounted) {
          setUser(null);
          setRestaurant(null);
          setAccountType(null);
          setStaffRole(null);
          setError(authError instanceof Error ? authError.message : 'Unable to restore your session.');
        }
      } finally {
        if (mounted) setLoading(false);
      }

      if (!mounted) return;

      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (!currentUser) {
          setRestaurant(null);
          setAccountType(null);
          setStaffRole(null);
          setError('');
          return;
        }

        void loadAccountContext(currentUser).catch((accountError) => {
          if (mounted) {
            setError(
              accountError instanceof Error
                ? accountError.message
                : 'Unable to load your account.',
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
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) throw signInError;
    setUser(data.user);
    await loadAccountContext(data.user);
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    setUser(null);
    setRestaurant(null);
    setAccountType(null);
    setStaffRole(null);
  }

  async function refreshRestaurant() {
    await loadAccountContext(user);
  }

  const value = useMemo(
    () => ({
      user,
      restaurant,
      accountType,
      staffRole,
      loading,
      error,
      signIn,
      signOut,
      refreshRestaurant,
    }),
    [user, restaurant, accountType, staffRole, loading, error],
  );

  return (
    <RestaurantOwnerAuthContext.Provider value={value}>
      {children}
    </RestaurantOwnerAuthContext.Provider>
  );
}

export function useRestaurantOwnerAuth() {
  const value = useContext(RestaurantOwnerAuthContext);
  if (!value) {
    throw new Error('useRestaurantOwnerAuth must be used within RestaurantOwnerAuthProvider');
  }
  return value;
}
