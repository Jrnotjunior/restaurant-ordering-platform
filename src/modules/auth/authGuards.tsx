import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { RestaurantOwnerLoginPage } from '../../pages/RestaurantOwnerLoginPage';
import { useRestaurantOwnerAuth } from '../../components/RestaurantOwnerAuthProvider';
import { defaultRestaurant } from '../../config/defaultRestaurant';
import { supabase } from '../../services/supabaseClient';
import type { RestaurantConfig } from '../../types/restaurant';
import { staffRouteForRole } from './staffRoleRouting';

export function ownerRestaurantConfig(
  restaurant: NonNullable<ReturnType<typeof useRestaurantOwnerAuth>['restaurant']>,
): RestaurantConfig {
  return {
    ...defaultRestaurant,
    id: restaurant.id,
    name: restaurant.name,
    tagline: restaurant.tagline,
    logoUrl: restaurant.logo_url ?? undefined,
    locationText: restaurant.location_text ?? undefined,
    contactNumber: restaurant.contact_number ?? undefined,
    email: restaurant.email ?? undefined,
  };
}

export function RestaurantModuleGuard({ restaurantId, anyOf, children }: {
  restaurantId: string;
  anyOf: string[];
  children: ReactNode;
}) {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (!supabase) {
        if (mounted) { setAllowed(false); setChecking(false); }
        return;
      }
      const checks = await Promise.all(anyOf.map(async (moduleKey) => {
        const { data, error } = await supabase!.rpc('restaurant_has_module', {
          p_restaurant_id: restaurantId,
          p_module_key: moduleKey,
        });
        return !error && data === true;
      }));
      if (!mounted) return;
      setAllowed(checks.some(Boolean));
      setChecking(false);
    }
    void check();
    return () => { mounted = false; };
  }, [restaurantId, anyOf.join('|')]);

  if (checking) return <section className="restaurant-owner-auth-loading">Checking feature access…</section>;
  if (!allowed) {
    if (window.location.hash !== '#restaurant/owner') window.location.hash = '#restaurant/owner';
    return <section className="restaurant-owner-auth-loading">Loading…</section>;
  }
  return <>{children}</>;
}

export function RiderRouteGuard({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (!supabase) { if (mounted) window.location.hash = '#account'; return; }
      const { data, error } = await supabase.auth.getUser();
      if (error) { window.location.hash = '#account'; return; }

      const user = data.user;
      const role = user?.app_metadata?.role ?? user?.user_metadata?.role;
      if (!mounted) return;

      if (role === 'rider' || user) {
        if (user) {
          const { data: riderProfile, error: riderProfileError } = await supabase
            .from('restaurant_staff')
            .select('id,restaurant_id')
            .eq('auth_user_id', user.id)
            .eq('role', 'rider')
            .eq('is_active', true)
            .maybeSingle();
          if (!mounted) return;
          if (riderProfileError) {
            console.error('Unable to verify rider access.', riderProfileError);
            window.location.hash = '#account';
            return;
          }
          if (riderProfile) {
            if (!riderProfile.restaurant_id) {
              window.location.hash = '#account';
              return;
            }
            const { data: deliveryEnabled, error: moduleError } = await supabase.rpc('restaurant_has_module', {
              p_restaurant_id: riderProfile.restaurant_id,
              p_module_key: 'dispatch_delivery',
            });
            if (moduleError || deliveryEnabled !== true) {
              window.location.hash = '#restaurant/owner';
              return;
            }
            setChecking(false);
            return;
          }
          if (role === 'rider') {
            window.location.hash = '#account';
            return;
          }
        }
      }

      if (role === 'customer') { window.location.hash = ''; return; }

      if (user) {
        const { data: ownerRestaurant } = await supabase
          .from('restaurants')
          .select('id')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (!mounted) return;
        if (ownerRestaurant) { window.location.hash = '#restaurant/orders'; return; }
      }
      window.location.hash = '#account';
    }
    void check();
    return () => { mounted = false; };
  }, []);

  if (checking) return <section className="restaurant-owner-auth-loading">Checking account access…</section>;
  return <>{children}</>;
}

export function OwnerRestaurantGuard({ children }: { children: (restaurant: RestaurantConfig) => ReactNode }) {
  const { restaurant, user, loading: authLoading } = useRestaurantOwnerAuth();
  const [checkingRole, setCheckingRole] = useState(true);
  const [roleCheckError, setRoleCheckError] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (authLoading) return;
      if (!user) { if (mounted) setCheckingRole(false); return; }
      if (!supabase) {
        if (mounted) { setRoleCheckError(true); setCheckingRole(false); }
        return;
      }
      setRoleCheckError(false);
      const role = user.app_metadata?.role ?? user.user_metadata?.role;
      if (role === 'customer') { window.location.hash = ''; return; }

      const { data: staffRows, error } = await supabase
        .from('restaurant_staff')
        .select('role')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);
      if (!mounted) return;
      if (error) {
        console.error('Unable to verify staff access.', error);
        setRoleCheckError(true);
        setCheckingRole(false);
        return;
      }

      const staffRole = staffRows?.[0]?.role;
      if (staffRole === 'cashier') { window.location.hash = '#restaurant/cashier'; return; }
      if (staffRole === 'kitchen') { window.location.hash = '#restaurant/kitchen'; return; }
      if (staffRole === 'dispatcher') { window.location.hash = '#restaurant/dispatcher'; return; }
      if (staffRole === 'rider' || role === 'rider') { window.location.hash = '#rider/dashboard'; return; }
      setCheckingRole(false);
    }
    void check();
    return () => { mounted = false; };
  }, [user, authLoading]);

  if (authLoading) return <section className="restaurant-owner-auth-loading">Loading restaurant session…</section>;
  if (!user) return <RestaurantOwnerLoginPage />;
  if (checkingRole) return <section className="restaurant-owner-auth-loading">Checking account access…</section>;
  if (roleCheckError) return <section className="restaurant-owner-auth-no-restaurant"><div className="restaurant-owner-auth-no-restaurant-card"><p className="eyebrow">Restaurant operations</p><h1>Unable to verify account access</h1><p>We couldn't verify your employee permissions. Please refresh the page or contact support. The owner dashboard is unavailable until access can be verified.</p></div></section>;
  if (!restaurant) return <section className="restaurant-owner-auth-no-restaurant"><div className="restaurant-owner-auth-no-restaurant-card"><p className="eyebrow">Restaurant operations</p><h1>No restaurant assigned</h1><p>Your owner account is signed in, but it is not linked to an active restaurant yet. Set the restaurant's <code>owner_id</code> to your Supabase Auth user ID, then reload this page.</p><p><strong>Signed in as:</strong> {user.email ?? user.id}</p></div></section>;
  return children(ownerRestaurantConfig(restaurant));
}

export function StaffRoleGuard({ role, children }: { role: 'cashier' | 'kitchen' | 'dispatcher'; children: (restaurant: RestaurantConfig) => ReactNode }) {
  const { user, loading: authLoading } = useRestaurantOwnerAuth();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (authLoading) return;
      if (!user || !supabase) { if (mounted) setChecking(false); return; }

      const { data: staffRows, error } = await supabase
        .from('restaurant_staff')
        .select('restaurant_id,role')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);
      const data = staffRows?.[0] ?? null;
      if (!mounted) return;
      if (error) { console.error('Unable to verify staff access.', error); setChecking(false); return; }
      if (data?.role === role && data.restaurant_id) {
        setRestaurantId(data.restaurant_id);
        setAllowed(true);
      } else {
        // A signed-in employee who opens another staff workspace should return
        // to their verified workspace, not the generic account/sign-in route.
        // This preserves the current Auth session and avoids a misleading login redirect.
        const destination = staffRouteForRole(data?.role) ?? '#account';
        setRedirecting(true);
        if (window.location.hash !== destination) window.location.hash = destination;
      }
      setChecking(false);
    }
    void check();
    return () => { mounted = false; };
  }, [role, user, authLoading]);

  if (authLoading) return <section className="restaurant-owner-auth-loading">Loading employee session…</section>;
  if (!user) return <RestaurantOwnerLoginPage />;
  if (checking) return <section className="restaurant-owner-auth-loading">Checking employee access…</section>;
  if (!allowed || !restaurantId) {
    return (
      <section className="restaurant-owner-auth-loading">
        {redirecting ? 'Returning to your workspace…' : 'Redirecting to your account…'}
      </section>
    );
  }
  return children({ ...defaultRestaurant, id: restaurantId });
}
