import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabaseGet } from '../../services/supabaseClient';

export type AccountType = 'owner' | 'staff' | 'customer';

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

export type AuthAccountContext = {
  restaurant: OwnerRestaurant | null;
  accountType: AccountType;
  staffRole: string | null;
};

export async function resolveAccountContext(currentUser: User | null): Promise<AuthAccountContext> {
  if (!currentUser) {
    return {
      restaurant: null,
      accountType: 'customer',
      staffRole: null,
    };
  }

  const ownerRows = await supabaseGet<OwnerRestaurant>('restaurants', {
    select: 'id,slug,name,tagline,logo_url,location_text,contact_number,email,is_active',
    owner_id: `eq.${currentUser.id}`,
    is_active: 'eq.true',
    limit: '1',
  });

  const ownerRestaurant = ownerRows[0] ?? null;

  if (ownerRestaurant) {
    return {
      restaurant: ownerRestaurant,
      accountType: 'owner',
      staffRole: null,
    };
  }

  const staffRows = await supabaseGet<{ restaurant_id: string; role: string }>('restaurant_staff', {
    select: 'restaurant_id,role',
    auth_user_id: `eq.${currentUser.id}`,
    is_active: 'eq.true',
    limit: '1',
  });

  return {
    restaurant: null,
    accountType: staffRows[0] ? 'staff' : 'customer',
    staffRole: staffRows[0]?.role ?? null,
  };
}

export async function initializeAuthSession(client: SupabaseClient) {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    // GitHub Pages hash routing can produce `#account#access_token=...`.
    // Parse the OAuth parameters after the last hash separator so `account`
    // does not become part of the access_token parameter name.
    const rawHash = url.hash.replace(/^#/, '');
    const authHash = rawHash.includes('#') ? rawHash.slice(rawHash.lastIndexOf('#') + 1) : rawHash;
    const hashParams = new URLSearchParams(authHash);
    const code = url.searchParams.get('code');
    const tokenHash = url.searchParams.get('token_hash') ?? hashParams.get('token_hash');
    const type = url.searchParams.get('type') ?? hashParams.get('type');
    const isTenantCallback =
      url.searchParams.get('tenant-invite') === '1' ||
      url.searchParams.get('tenant-owner-access') === '1';

    const isCustomerConfirmation = url.searchParams.get('customer-confirmation') === '1';
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (isCustomerConfirmation && accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        console.error('Customer confirmation session restoration failed', error);
        throw new Error(`Customer confirmation could not restore the session: ${error.message}`);
      } else {
        url.hash = '';
        window.history.replaceState({}, document.title, url.toString());
      }
      return;
    }

    if (isTenantCallback) {
      // Tenant callback URLs are owned by the tenant invitation flow.
      // Do not consume their auth parameters from the global provider.
      return;
    }

    // Supabase may return OAuth credentials in the URL fragment depending on
    // the provider/flow configuration. Session detection is disabled in the
    // client so we must restore those credentials explicitly, just like the
    // customer email-confirmation flow above.
    if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        console.error('OAuth callback session restoration failed', error);
        throw new Error(`Google sign-in returned, but Supabase could not restore the session: ${error.message}`);
      } else {
        // Remove OAuth credentials from the address bar without dropping the
        // route that initiated authentication. In hash-routed deployments the
        // redirect can look like "#account#access_token=..."; clearing the
        // entire hash unmounts the account page before it can enforce the
        // customer-registration requirement.
        const route = rawHash.includes('#')
          ? rawHash.slice(0, rawHash.lastIndexOf('#')).replace(/^#/, '')
          : '';
        url.hash = route ? `#${route}` : '';
        window.history.replaceState({}, document.title, url.toString());
      }
      return;
    }

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('Auth callback code exchange failed', error);
        throw new Error(`Google sign-in callback could not be completed: ${error.message}`);
      } else {
        url.searchParams.delete('code');
        window.history.replaceState({}, document.title, url.toString());
      }
      return;
    }

    // Only invitation callbacks are explicitly verified here.
    // Customer email-confirmation callbacks use the normal Supabase auth flow
    // and must never be mistaken for an invitation.
    if (tokenHash && type === 'invite') {
      const { error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'invite',
      });

      if (error) {
        console.error('Invitation token verification failed', error);
        throw new Error(`Invitation verification failed: ${error.message}`);
      } else {
        url.searchParams.delete('token_hash');
        url.searchParams.delete('type');

        const cleanedHash = new URLSearchParams(url.hash.replace(/^#/, ''));
        cleanedHash.delete('token_hash');
        cleanedHash.delete('type');
        url.hash = cleanedHash.toString() ? `#${cleanedHash.toString()}` : '';

        window.history.replaceState({}, document.title, url.toString());
      }
    }
  }
}
