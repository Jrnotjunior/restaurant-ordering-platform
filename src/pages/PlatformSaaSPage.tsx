import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';
import './PlatformSaaSPage.css';

type AdminAccess = {
  access_level: string;
  is_active: boolean;
  status: string;
};

type DashboardSummary = {
  total_restaurants: number;
  active_restaurants: number;
  inactive_restaurants: number;
  active_system_administrators: number;
  pending_system_administrators: number;
};

type Tenant = {
  restaurant_id: string;
  slug: string;
  restaurant_name: string;
  custom_domain: string | null;
  is_active: boolean;
  created_at: string;
  package_id: number | null;
  package_name: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
};

type PackageOption = {
  id: number;
  package_key: string;
  name: string;
  description: string;
};

function asRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value && typeof value === 'object' ? [value as T] : [];
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(date);
}

export function PlatformSaaSPage() {
  const { user, loading: authLoading, signOut } = useRestaurantOwnerAuth();
  // Active System Admin access is validated server-side by the access-level RPC.
  // This intentionally supports approved read-only admins whose account is also a restaurant owner.
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [canManageTenants, setCanManageTenants] = useState(false);
  const [canInviteTenants, setCanInviteTenants] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [search, setSearch] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [newRestaurantName, setNewRestaurantName] = useState('');
  const [newPackageId, setNewPackageId] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null);
  const [domainValue, setDomainValue] = useState('');
  const [savingDomain, setSavingDomain] = useState(false);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [savingPackage, setSavingPackage] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');

  async function loadDashboard() {
    if (!supabase || !user) {
      setDashboardLoading(false);
      return;
    }

    setDashboardLoading(true);
    setDashboardError('');
    try {
      const { data: accessData, error: accessError } = await supabase.rpc('system_admin_get_my_access_level');
      if (accessError) throw accessError;
      const currentAccess = asRows<AdminAccess>(accessData)[0];
      if (!currentAccess || currentAccess.status !== 'active' || !currentAccess.is_active) {
        setAccess(currentAccess ?? null);
        setCanManageTenants(false);
        setCanInviteTenants(false);
        setSummary(null);
        setTenants([]);
        setPackages([]);
        setDashboardError('This account does not have active System Administrator access to the parent SaaS console.');
        return;
      }
      setAccess(currentAccess);

      const [
        { data: summaryData, error: summaryError },
        { data: tenantData, error: tenantError },
        { data: packageData, error: packageError },
        { data: manageData, error: manageError },
        { data: ownerData, error: ownerError },
      ] = await Promise.all([
        supabase.rpc('system_admin_get_dashboard_summary'),
        supabase.rpc('system_admin_get_tenant_registry'),
        supabase.rpc('system_admin_get_available_packages'),
        supabase.rpc('system_admin_has_manage_access'),
        supabase.rpc('system_admin_is_owner'),
      ]);

      if (summaryError) throw summaryError;
      if (tenantError) throw tenantError;
      if (packageError) throw packageError;

      setSummary(asRows<DashboardSummary>(summaryData)[0] ?? null);
      const parentDomain = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : 'app.web2table.io';
      const allTenants = asRows<Tenant>(tenantData);
      // app.web2table.io is the SaaS control plane, not a paying restaurant tenant.
      setTenants(allTenants.filter((tenant) => (tenant.custom_domain ?? '').trim().toLowerCase() !== parentDomain));
      setPackages(asRows<PackageOption>(packageData));
      setCanManageTenants(!manageError && manageData === true);
      setCanInviteTenants(!ownerError && ownerData === true);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Unable to load the parent SaaS dashboard.');
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setDashboardLoading(false);
      return;
    }
    void loadDashboard();
    // loadDashboard verifies access using database-backed System Admin access,
    // not only the Auth role claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tenants;
    return tenants.filter((tenant) =>
      tenant.restaurant_name.toLowerCase().includes(query) ||
      tenant.slug.toLowerCase().includes(query) ||
      (tenant.custom_domain ?? '').toLowerCase().includes(query) ||
      (tenant.package_name ?? '').toLowerCase().includes(query),
    );
  }, [tenants, search]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError('');
    if (!supabase) {
      setLoginError('The parent platform is not connected to Supabase yet.');
      return;
    }
    setLoginBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
      });
      if (error) throw error;
      setLoginPassword('');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in. Please check your credentials.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
      setAccess(null);
      setSummary(null);
      setTenants([]);
      setDashboardError('');
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  }

  async function createTenantInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !canInviteTenants) return;
    setInviteBusy(true);
    setInviteError('');
    setInviteMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('system-admin-invite-tenant', {
        body: {
          email: ownerEmail.trim().toLowerCase(),
          owner_name: ownerName.trim(),
          name: newRestaurantName.trim(),
          package_id: Number(newPackageId),
        },
      });
      if (error) {
        const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        const payload = await context?.json?.().catch(() => null);
        throw new Error(payload?.error || error.message || 'Unable to invite this tenant.');
      }
      if (data?.error) throw new Error(String(data.error));
      setInviteMessage(typeof data?.message === 'string' ? data.message : 'Tenant invitation created. The owner can finish setup from the invitation email.');
      setOwnerName('');
      setOwnerEmail('');
      setNewRestaurantName('');
      setNewPackageId('');
      setShowInviteForm(false);
      await loadDashboard();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Unable to invite this tenant.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function saveDomain(tenant: Tenant) {
    if (!supabase || !canManageTenants) return;
    setSavingDomain(true);
    setActionError('');
    setActionMessage('');
    try {
      const { data, error } = await supabase.rpc('system_admin_set_restaurant_domain', {
        p_restaurant_id: tenant.restaurant_id,
        p_custom_domain: domainValue.trim() || null,
      });
      if (error) throw error;
      setActionMessage(data ? `Domain updated to ${String(data)}.` : 'Tenant domain cleared.');
      setEditingDomainId(null);
      await loadDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update tenant domain.');
    } finally {
      setSavingDomain(false);
    }
  }

  async function savePackage(tenant: Tenant) {
    if (!supabase || !canManageTenants || !selectedPackageId) return;
    setSavingPackage(true);
    setActionError('');
    setActionMessage('');
    try {
      const { data, error } = await supabase.rpc('system_admin_assign_restaurant_package', {
        p_restaurant_id: tenant.restaurant_id,
        p_package_id: Number(selectedPackageId),
      });
      if (error) throw error;
      const row = asRows<{ package_name: string }>(data)[0];
      setActionMessage(row?.package_name ? `Package updated to ${row.package_name}.` : 'Tenant package updated.');
      setEditingPackageId(null);
      await loadDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update tenant package.');
    } finally {
      setSavingPackage(false);
    }
  }

  if (authLoading) {
    return <main className="saas-page"><section className="saas-centered-card"><p className="saas-eyebrow">Web2Table SaaS</p><h1>Loading secure platform access…</h1></section></main>;
  }

  if (!user) {
    return (
      <main className="saas-page">
        <div className="saas-topbar">
          <a className="saas-brand" href="/" aria-label="Web2Table parent SaaS">
            <span className="saas-brand-mark">W2</span>
            <span><strong>Web2Table</strong><small>Parent SaaS platform</small></span>
          </a>
          <span className="saas-topbar-badge">Platform access</span>
        </div>
        <section className="saas-login-layout">
          <div className="saas-hero">
            <p className="saas-eyebrow">One platform. Every restaurant.</p>
            <h1>Manage your restaurant SaaS from one place.</h1>
            <p>Control tenant onboarding, package access, and domain mapping while each restaurant keeps its own menu, orders, payments, branding, and team.</p>
            <div className="saas-feature-list">
              <span>✓ Shared product code and releases</span>
              <span>✓ Tenant-isolated restaurant data</span>
              <span>✓ Permission-checked platform controls</span>
            </div>
          </div>
          <form className="saas-login-card" onSubmit={(event) => void handleSignIn(event)}>
            <p className="saas-eyebrow">Authorized administrators</p>
            <h2>Sign in to Web2Table</h2>
            <p className="saas-muted">System Administrator access and authenticator verification are required.</p>
            {loginError ? <div className="saas-alert saas-alert-error" role="alert">{loginError}</div> : null}
            <label>Email address<input type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required disabled={loginBusy} /></label>
            <label>Password<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required disabled={loginBusy} /></label>
            <button className="saas-button saas-button-primary" type="submit" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Sign in securely'}</button>
            <p className="saas-footnote">This is not a restaurant customer login. Access is limited to approved Web2Table administrators.</p>
          </form>
        </section>
      </main>
    );
  }

  const activeCount = tenants.filter((tenant) => tenant.is_active).length;
  const inactiveCount = tenants.length - activeCount;

  return (
    <main className="saas-page">
      <header className="saas-topbar">
        <a className="saas-brand" href="/" aria-label="Web2Table parent SaaS home">
          <span className="saas-brand-mark">W2</span>
          <span><strong>Web2Table</strong><small>Parent SaaS platform</small></span>
        </a>
        <div className="saas-topbar-right">
          <span className="saas-admin-label"><span className="saas-status-dot" />System Admin</span>
          <span className="saas-user-email">{user.email ?? 'Administrator'}</span>
          <button className="saas-button saas-button-quiet" type="button" onClick={() => void handleSignOut()}>Sign out</button>
        </div>
      </header>

      <div className="saas-dashboard-shell">
        <section className="saas-dashboard-heading">
          <div>
            <p className="saas-eyebrow">Parent control plane</p>
            <h1>Tenant management</h1>
            <p className="saas-muted">One shared Web2Table product. Each tenant retains its own configuration and business data.</p>
          </div>
          <div className="saas-release-pill"><span className="saas-status-dot" />Shared source: <code>main</code></div>
        </section>

        {dashboardError ? <div className="saas-alert saas-alert-error" role="alert">{dashboardError}</div> : null}
        {actionMessage ? <div className="saas-alert saas-alert-success" role="status">{actionMessage}</div> : null}
        {actionError ? <div className="saas-alert saas-alert-error" role="alert">{actionError}</div> : null}
        {inviteMessage ? <div className="saas-alert saas-alert-success" role="status">{inviteMessage}</div> : null}
        {inviteError ? <div className="saas-alert saas-alert-error" role="alert">{inviteError}</div> : null}

        {dashboardLoading ? (
          <section className="saas-centered-card"><p>Loading tenant registry…</p></section>
        ) : access?.status !== 'active' || !access.is_active ? (
          <section className="saas-centered-card">
            <p className="saas-eyebrow">Access not active</p>
            <h2>Parent console access could not be verified.</h2>
            <p className="saas-muted">Your account remains signed in, but tenant data is hidden until System Administrator access is active and verified.</p>
          </section>
        ) : (
          <>
            <section className="saas-stats-grid" aria-label="Platform summary">
              <article className="saas-stat-card"><span>Total tenants</span><strong>{tenants.length}</strong><small>Excludes the parent app domain</small></article>
              <article className="saas-stat-card"><span>Active tenants</span><strong>{activeCount}</strong><small>Tenant storefronts enabled</small></article>
              <article className="saas-stat-card"><span>Inactive tenants</span><strong>{inactiveCount}</strong><small>Not currently active</small></article>
              <article className="saas-stat-card"><span>Active administrators</span><strong>{summary?.active_system_administrators ?? '—'}</strong><small>{summary?.pending_system_administrators ?? 0} pending access requests</small></article>
            </section>

            <section className="saas-panel">
              <div className="saas-panel-heading">
                <div><h2>Tenant directory</h2><p className="saas-muted">Domains determine which tenant’s configuration is loaded by the shared app.</p></div>
                <div className="saas-panel-actions">
                  <input className="saas-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tenants, domains, packages…" aria-label="Search tenants" />
                  {canInviteTenants ? <button className="saas-button saas-button-primary" type="button" onClick={() => { setShowInviteForm((value) => !value); setInviteError(''); setInviteMessage(''); }}>+ Add tenant</button> : null}
                </div>
              </div>

              {showInviteForm && canInviteTenants ? (
                <form className="saas-invite-form" onSubmit={(event) => void createTenantInvitation(event)}>
                  <div className="saas-form-heading"><h3>Invite a new restaurant</h3><p className="saas-muted">Creates a tenant with its own package and owner invitation.</p></div>
                  <div className="saas-form-grid">
                    <label>Restaurant name<input value={newRestaurantName} onChange={(event) => setNewRestaurantName(event.target.value)} required minLength={2} disabled={inviteBusy} /></label>
                    <label>Owner full name<input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} required minLength={2} disabled={inviteBusy} /></label>
                    <label>Owner email<input type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} required disabled={inviteBusy} /></label>
                    <label>Package<select value={newPackageId} onChange={(event) => setNewPackageId(event.target.value)} required disabled={inviteBusy}><option value="">Choose package…</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  </div>
                  <div className="saas-form-actions">
                    <button className="saas-button saas-button-quiet" type="button" onClick={() => setShowInviteForm(false)} disabled={inviteBusy}>Close</button>
                    <button className="saas-button saas-button-primary" type="submit" disabled={inviteBusy}>{inviteBusy ? 'Creating invitation…' : 'Create tenant and invite owner'}</button>
                  </div>
                </form>
              ) : null}

              {filteredTenants.length === 0 ? (
                <div className="saas-empty-state"><strong>No tenants found.</strong><span>Change the search or add a tenant if your access level allows it.</span></div>
              ) : (
                <div className="saas-tenant-list">
                  {filteredTenants.map((tenant) => (
                    <article className="saas-tenant-row" key={tenant.restaurant_id}>
                      <div className="saas-tenant-identity">
                        <span className="saas-tenant-avatar">{tenant.restaurant_name.slice(0, 1).toUpperCase()}</span>
                        <div><strong>{tenant.restaurant_name}</strong><small><code>{tenant.slug}</code> · Created {formatDate(tenant.created_at)}</small></div>
                      </div>
                      <div className="saas-tenant-domain">
                        <span className="saas-column-label">Storefront domain</span>
                        {tenant.custom_domain ? <a href={`https://${tenant.custom_domain}`} target="_blank" rel="noreferrer">{tenant.custom_domain}</a> : <span className="saas-muted">Not mapped yet</span>}
                        {canManageTenants ? <button className="saas-link-button" type="button" onClick={() => { setEditingDomainId(editingDomainId === tenant.restaurant_id ? null : tenant.restaurant_id); setDomainValue(tenant.custom_domain ?? ''); setActionError(''); setActionMessage(''); }}>Edit domain</button> : null}
                      </div>
                      <div className="saas-tenant-package">
                        <span className="saas-column-label">Package</span>
                        <strong>{tenant.package_name ?? 'Not assigned'}</strong>
                        <small>{tenant.subscription_status ?? 'No subscription record'}</small>
                        {canManageTenants ? <button className="saas-link-button" type="button" onClick={() => { setEditingPackageId(editingPackageId === tenant.restaurant_id ? null : tenant.restaurant_id); setSelectedPackageId(String(tenant.package_id ?? '')); setActionError(''); setActionMessage(''); }}>Change package</button> : null}
                      </div>
                      <div className="saas-tenant-status">
                        <span className={tenant.is_active ? 'saas-status-badge is-active' : 'saas-status-badge is-inactive'}>{tenant.is_active ? 'Active' : 'Inactive'}</span>
                      </div>

                      {editingDomainId === tenant.restaurant_id && canManageTenants ? (
                        <form className="saas-edit-panel" onSubmit={(event) => { event.preventDefault(); void saveDomain(tenant); }}>
                          <label>Custom domain<input value={domainValue} onChange={(event) => setDomainValue(event.target.value)} placeholder="restaurant.example.com" disabled={savingDomain} /></label>
                          <p className="saas-muted">This saves the hostname-to-tenant mapping in Supabase. DNS and Hostinger domain assignment must also point to the shared app deployment.</p>
                          <div className="saas-form-actions"><button className="saas-button saas-button-quiet" type="button" onClick={() => setEditingDomainId(null)} disabled={savingDomain}>Cancel</button><button className="saas-button saas-button-primary" type="submit" disabled={savingDomain}>{savingDomain ? 'Saving…' : 'Save domain mapping'}</button></div>
                        </form>
                      ) : null}

                      {editingPackageId === tenant.restaurant_id && canManageTenants ? (
                        <form className="saas-edit-panel" onSubmit={(event) => { event.preventDefault(); void savePackage(tenant); }}>
                          <label>New package<select value={selectedPackageId} onChange={(event) => setSelectedPackageId(event.target.value)} required disabled={savingPackage}><option value="">Choose package…</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                          <p className="saas-muted">Changing a package resets explicit module overrides and uses the selected package’s included features.</p>
                          <div className="saas-form-actions"><button className="saas-button saas-button-quiet" type="button" onClick={() => setEditingPackageId(null)} disabled={savingPackage}>Cancel</button><button className="saas-button saas-button-primary" type="submit" disabled={savingPackage || !selectedPackageId}>{savingPackage ? 'Saving…' : 'Assign package'}</button></div>
                        </form>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
              <div className="saas-panel-footer"><span>Read access: {access.access_level.replaceAll('_', ' ')}</span><button className="saas-link-button" type="button" onClick={() => void loadDashboard()}>Refresh tenant registry</button></div>
            </section>

            <section className="saas-architecture-note">
              <div><strong>One shared codebase</strong><span>Feature changes are made once in the main repository.</span></div>
              <div><strong>Separate tenant data</strong><span>Menus, orders, staff, payments and storefront customization remain tenant-scoped.</span></div>
              <div><strong>One release path to finish</strong><span>Each tenant domain must be attached to the shared Hostinger deployment or its app must auto-deploy from the same main branch.</span></div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
