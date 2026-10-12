import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  const resolvedUserIdRef = useRef<string | null>(null);

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
          resolvedUserIdRef.current = null;
          setUser(null);
          setRestaurant(null);
          setAccountType(null);
          setStaffRole(null);
          if (userError.name !== 'AuthSessionMissingError') {
            setError(userError.message);
          }
        } else {
          const currentUser = data.user ?? null;
          resolvedUserIdRef.current = currentUser?.id ?? null;
          setUser(currentUser);
          try {
            await loadAccountContext(currentUser);
          } catch (accountError) {
            // A tenant/account-profile lookup failure must not erase a valid
            // Supabase session. Keep the user authenticated and fall back to
            // customer context so the account icon does not send them back
            // to sign-in just because a role lookup failed.
            if (mounted && currentUser) {
              setRestaurant(null);
              setAccountType('customer');
              setStaffRole(null);
              setError(accountError instanceof Error ? accountError.message : 'Unable to load your account details.');
            } else if (mounted) {
              throw accountError;
            }
          }
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

      const { data } = client.auth.onAuthStateChange((event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (!currentUser) {
          resolvedUserIdRef.current = null;
          setRestaurant(null);
          setAccountType(null);
          setStaffRole(null);
          setError('');
          return;
        }

        // Token refreshes do not change a user's account role. Reusing the
        // already-resolved context avoids repeating owner/staff profile queries
        // and prevents the privileged MFA gate from flashing during refreshes.
        // Only skip the lookup when the refreshed session belongs to the same
        // user whose context is already resolved.
        if (event === 'TOKEN_REFRESHED' && resolvedUserIdRef.current === currentUser.id) {
          setError('');
          return;
        }

        resolvedUserIdRef.current = currentUser.id;
        setRestaurant(null);
        setAccountType(null);
        setStaffRole(null);

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
