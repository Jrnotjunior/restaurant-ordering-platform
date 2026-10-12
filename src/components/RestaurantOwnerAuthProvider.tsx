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
  staffRestaurantId: string | null;
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
  const [staffRestaurantId, setStaffRestaurantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const resolvedUserIdRef = useRef<string | null>(null);

  async function loadAccountContext(currentUser: User | null) {
    if (!currentUser) {
      setRestaurant(null);
      setAccountType(null);
      setStaffRole(null);
      setStaffRestaurantId(null);
      return;
    }

    const context = await resolveAccountContext(currentUser);
    setRestaurant(context.restaurant);
    setAccountType(context.accountType);
    setStaffRole(context.staffRole);
    setStaffRestaurantId(context.staffRestaurantId);
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
          setStaffRestaurantId(null);
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
            // A role lookup failure must never silently downgrade a privileged
            // user to customer context. Keep the session, leave the role
            // unresolved, and show the actual lookup error so the shared
            // gateway cannot incorrectly run customer-registration checks.
            if (mounted && currentUser) {
              setRestaurant(null);
              setAccountType(null);
              setStaffRole(null);
            setStaffRestaurantId(null);
            setStaffRestaurantId(null);
              setError(accountError instanceof Error ? accountError.message : 'Unable to load your account details. Please retry.');
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

        // Supabase emits auth-state events during MFA enrollment/verification
        // as well as ordinary token refreshes. Those events can keep the same
        // authenticated user; clearing the role context here briefly makes the
        // shared gateway remount and can send staff back to sign-in. Preserve
        // the already-resolved context for the same user and only resolve again
        // when the authenticated identity actually changes.
        if (resolvedUserIdRef.current === currentUser.id) {
          setError('');
          return;
        }

        resolvedUserIdRef.current = currentUser.id;
        setRestaurant(null);
        setAccountType(null);
        setStaffRole(null);

        // Do not call Supabase session APIs synchronously from inside
        // onAuthStateChange. Supabase warns that auth calls in this callback
        // can deadlock; the RPC helper reads the active session to build its
        // Authorization header. Defer role resolution until the callback exits.
        window.setTimeout(() => {
          void loadAccountContext(currentUser).then(() => {
            if (mounted) setError('');
          }).catch((accountError) => {
            if (mounted) {
              setRestaurant(null);
              setAccountType(null);
              setStaffRole(null);
              setError(
                accountError instanceof Error
                  ? accountError.message
                  : 'Unable to load your account. Please retry.',
              );
            }
          });
        }, 0);
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
      staffRestaurantId,
      loading,
      error,
      signOut,
      refreshRestaurant,
    }),
    [user, restaurant, accountType, staffRole, staffRestaurantId, loading, error],
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
