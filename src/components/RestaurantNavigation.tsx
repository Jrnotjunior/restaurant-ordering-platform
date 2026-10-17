import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { uploadRestaurantSupportAttachments } from '../services/supportAttachmentService';
import { useRestaurant } from './RestaurantProvider';
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

export type RestaurantNavigationRole = 'owner' | 'cashier' | 'kitchen' | 'dispatcher' | 'rider';

type NavigationItem = {
  label: string;
  href: string;
  icon: 'dashboard' | 'orders' | 'menu' | 'inventory' | 'recipes' | 'riders' | 'shipping' | 'sales' | 'reports' | 'dispatch' | 'settings' | 'loyalty' | 'customization' | 'payroll';
};

type OwnerSupportTicket = { id: string; request_number: string | null; subject: string; status: string; created_at: string; updated_at: string };
type OwnerSupportMessage = { id: string; ticket_id: string; sender_user_id: string; message: string; visibility: 'public' | 'internal'; created_at: string };
type OwnerSupportAttachment = { id: string; message_id: string | null; storage_path: string; file_name: string; file_size: number; created_at: string };

const ownerNavigationItems: NavigationItem[] = [
  { label: 'Dashboard', href: '#restaurant/owner', icon: 'dashboard' },
  { label: 'Orders', href: '#restaurant/orders', icon: 'orders' },
  { label: 'Menu', href: '#restaurant/menu', icon: 'menu' },
  { label: 'Employees', href: '#restaurant/employees', icon: 'riders' },
  { label: 'Payroll & HR', href: '#restaurant/payroll', icon: 'payroll' },
  { label: 'Sales', href: '#restaurant/sales', icon: 'sales' },
  { label: 'Business Reports', href: '#restaurant/business-reports', icon: 'reports' },
  { label: 'Inventory', href: '#restaurant/inventory', icon: 'inventory' },
  { label: 'Recipes', href: '#restaurant/recipes', icon: 'recipes' },
  { label: 'Loyalty', href: '#restaurant/loyalty', icon: 'loyalty' },
  { label: 'Store Settings', href: '#restaurant/settings', icon: 'settings' },
  { label: 'Website & Branding', href: '#restaurant/website-customization', icon: 'customization' },
];


const ownerNavigationGroups: Array<{ label: string; hrefs: string[] }> = [
  { label: 'Overview', hrefs: ['#restaurant/owner'] },
  { label: 'Operations', hrefs: ['#restaurant/orders', '#restaurant/menu', '#restaurant/inventory', '#restaurant/recipes'] },
  { label: 'People', hrefs: ['#restaurant/employees', '#restaurant/payroll'] },
  { label: 'Business', hrefs: ['#restaurant/sales', '#restaurant/business-reports', '#restaurant/loyalty'] },
  { label: 'Store', hrefs: ['#restaurant/settings', '#restaurant/website-customization'] },
];

function shouldShowOwnerNavigationItem(item: NavigationItem, ownerModules: Record<string, boolean>) {
  const requiredModules =
    item.href === '#restaurant/orders' ? ['self_ordering', 'dispatch_delivery'] :
    item.href === '#restaurant/menu' ? ['self_ordering', 'pos'] :
    item.href === '#restaurant/delivery-dispatch' || item.href === '#restaurant/shipping-fee' ? ['dispatch_delivery'] :
    item.href === '#restaurant/sales' || item.href === '#restaurant/business-reports' || item.href === '#restaurant/inventory' ? ['sales'] :
    item.href === '#restaurant/loyalty' ? ['loyalty'] :
    item.href === '#restaurant/payroll' ? ['payroll'] :
    item.href === '#restaurant/website-customization' ? ['website'] : [];
  return item.href === '#restaurant/owner' || item.href === '#restaurant/employees' ||
    (item.href === '#restaurant/payroll' && ownerModules.payroll === true) ||
    item.href === '#restaurant/settings' || requiredModules.length === 0 ||
    requiredModules.some((moduleKey) => ownerModules[moduleKey] === true);
}

function NavigationIcon({ type }: { type: NavigationItem['icon'] }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (type === 'dashboard') {
    return <svg {...common}><path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-3H4z" /></svg>;
  }

  if (type === 'orders') {
    return <svg {...common}><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M14 3.5v4h4" /><path d="M9 12h6M9 15.5h6" /></svg>;
  }

  if (type === 'menu') {
    return <svg {...common}><path d="M4 5v6M7 5v6M4 8h3M5.5 11v8" /><path d="M14 5v14M14 5c3 2 4 5 0 7" /></svg>;
  }

  if (type === 'inventory') {
    return <svg {...common}><path d="m12 3.5 8 4.2v8.6l-8 4.2-8-4.2V7.7z" /><path d="m4.5 7.8 7.5 4 7.5-4M12 12v8" /></svg>;
  }

  if (type === 'recipes') {
    return <svg {...common}><path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11H8a3 3 0 0 1-3-3z" /><path d="M5 4.5v11A3 3 0 0 0 8 18.5M9 8h6M9 11h6" /></svg>;
  }

  if (type === 'riders') {
    return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.7-3.2 2.5-5 5.5-5s4.8 1.8 5.5 5" /><path d="M16 6.5h4M18 4.5v4" /></svg>;
  }

  if (type === 'dispatch') {
    return <svg {...common}><path d="M4 18h16M6 14l4-4 3 3 5-6" /><path d="M17 7h3v3" /></svg>;
  }

  if (type === 'shipping') {
    return <svg {...common}><circle cx="7" cy="17.5" r="2.5" /><circle cx="18" cy="17.5" r="2.5" /><path d="M9.5 17.5h6M4.5 17.5H3v-5h2l2-5h6l3 3h3l2 3v4h-1.5" /><path d="M7 7.5h6M13 10.5h3" /></svg>;
  }

  if (type === 'reports') {
    return <svg {...common}><path d="M4 20V12h4v8M10 20V5h4v15M16 20V9h4v11" /><path d="M3 20.5h18" /></svg>;
  }

  if (type === 'loyalty') {
    return <svg {...common}><path d="M12 3.5l2.1 2.2 3-.2.8 2.9 2.5 1.7-1.4 2.7 1.4 2.7-2.5 1.7-.8 2.9-3-.2-2.1 2.2-2.1-2.2-3 .2-.8-2.9-2.5-1.7 1.4-2.7-1.4-2.7 2.5-1.7.8-2.9 3 .2z"/><circle cx="12" cy="12" r="2.5"/></svg>;
  }

  if (type === 'settings') {
    return <svg {...common}><path d="M12 3v2M12 19v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M3 12h2M19 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /><circle cx="12" cy="12" r="3.5" /></svg>;
  }
  if (type === 'payroll') return <svg {...common}><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>;
  if (type === 'customization') {
    return <svg {...common}><path d="M4 5.5h16M4 12h16M4 18.5h16" /><circle cx="9" cy="5.5" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="11" cy="18.5" r="2" fill="currentColor" stroke="none" /></svg>;
  }


  return <svg {...common}><path d="M4 17.5 9 12l4 3 7-8" /><path d="M15.5 7H20v4.5" /><path d="M3 20.5h18" /></svg>;
}

function getCurrentRoute() {
  return window.location.hash || '#restaurant/dashboard';
}

const roleNavigationItems: Record<RestaurantNavigationRole, NavigationItem[]> = {
  owner: ownerNavigationItems,
  cashier: [
    { label: 'POS', href: '#restaurant/cashier-pos', icon: 'orders' },
    { label: 'Orders', href: '#restaurant/cashier', icon: 'orders' },
    { label: 'Sales', href: '#restaurant/cashier-sales', icon: 'sales' },
  ],
  kitchen: [
    { label: 'Orders', href: '#restaurant/kitchen', icon: 'orders' },
    { label: 'Menu', href: '#restaurant/kitchen-menu', icon: 'menu' },
  ],
  dispatcher: [{ label: 'Dispatch', href: '#restaurant/dispatcher', icon: 'dispatch' }],
  rider: [{ label: 'Deliveries', href: '#rider/dashboard', icon: 'dispatch' }],
};

export function RestaurantNavigation({ role = 'owner', ownerDashboard = false }: { role?: RestaurantNavigationRole; ownerDashboard?: boolean }) {
  const [currentRoute, setCurrentRoute] = useState(getCurrentRoute);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('Restaurant Owner');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [logoutSaving, setLogoutSaving] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportType, setSupportType] = useState<'incident' | 'change_request' | 'request_item'>('incident');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDescription, setSupportDescription] = useState('');
  const [supportFiles, setSupportFiles] = useState<File[]>([]);
  const [supportImpact, setSupportImpact] = useState('normal');
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportError, setSupportError] = useState('');
  const [supportSuccess, setSupportSuccess] = useState('');
  const [supportView, setSupportView] = useState<'new' | 'requests'>('new');
  const [supportTickets, setSupportTickets] = useState<OwnerSupportTicket[]>([]);
  const [supportInboxLoading, setSupportInboxLoading] = useState(false);
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState<string | null>(null);
  const [supportMessages, setSupportMessages] = useState<OwnerSupportMessage[]>([]);
  const [supportAttachments, setSupportAttachments] = useState<OwnerSupportAttachment[]>([]);
  const [supportAttachmentUrls, setSupportAttachmentUrls] = useState<Record<string, string>>({});
  const [supportMessagesLoading, setSupportMessagesLoading] = useState(false);
  const [supportReply, setSupportReply] = useState('');
  const [supportReplyFiles, setSupportReplyFiles] = useState<File[]>([]);
  const [supportReplySending, setSupportReplySending] = useState(false);
  const [supportCurrentUserId, setSupportCurrentUserId] = useState<string | null>(null);
  const restaurant = useRestaurant();
  const [ownerModules, setOwnerModules] = useState<Record<string, boolean>>({});
  const [modulesLoading, setModulesLoading] = useState(role === 'owner');

  useEffect(() => {
    if (!supabase || role !== 'owner' || !restaurant.id) {
      setModulesLoading(false);
      return;
    }

    let mounted = true;
    void supabase.rpc('restaurant_get_my_modules', { p_restaurant_id: restaurant.id }).then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        console.error('Unable to load restaurant package modules.', error);
        setOwnerModules({});
      } else {
        const modules = Array.isArray(data) ? data as Array<{ module_key: string; enabled: boolean }> : [];
        setOwnerModules(Object.fromEntries(modules.map((module) => [module.module_key, module.enabled])));
      }
      setModulesLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [role, restaurant.id]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      setSupportCurrentUserId(user?.id ?? null);
      const metadata = user?.user_metadata as Record<string, unknown> | undefined;
      const name = typeof metadata?.full_name === 'string' ? metadata.full_name : typeof metadata?.name === 'string' ? metadata.name : '';
      setEmail(user?.email ?? '');
      setDisplayName(name || user?.email?.split('@')[0] || 'Restaurant Owner');
    });
  }, []);

  useEffect(() => {
    if (!supportOpen || supportView !== 'requests' || !supabase || !restaurant.id) return;
    const client = supabase;
    let active = true;
    setSupportInboxLoading(true);
    void client.from('restaurant_support_requests')
      .select('id,request_number,subject,status,created_at,updated_at')
      .eq('restaurant_id', restaurant.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { setSupportError('Unable to load your support requests. Please try again.'); console.error('Support inbox load failed.', error); }
        else {
          const rows = (data ?? []) as OwnerSupportTicket[];
          setSupportTickets(rows);
          if (selectedSupportTicketId && !rows.some((row) => row.id === selectedSupportTicketId)) setSelectedSupportTicketId(null);
        }
        setSupportInboxLoading(false);
      });
    const channel = client.channel('restaurant-support-ticket-list-' + restaurant.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_support_requests', filter: 'restaurant_id=eq.' + restaurant.id }, () => {
        void client.from('restaurant_support_requests').select('id,request_number,subject,status,created_at,updated_at').eq('restaurant_id', restaurant.id).order('created_at', { ascending: false })
          .then(({ data }) => { if (active && data) setSupportTickets(data as OwnerSupportTicket[]); });
      }).subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [supportOpen, supportView, restaurant.id, selectedSupportTicketId]);

  useEffect(() => {
    if (!supportOpen || supportView !== 'requests' || !selectedSupportTicketId || !supabase) { setSupportMessages([]); setSupportAttachments([]); setSupportAttachmentUrls({}); return; }
    const client = supabase;
    let active = true;
    const loadMessages = async () => {
      setSupportMessagesLoading(true);
      const { data, error } = await client.from('support_ticket_messages')
        .select('id,ticket_id,sender_user_id,message,visibility,created_at')
        .eq('ticket_id', selectedSupportTicketId)
        .eq('visibility', 'public')
        .order('created_at', { ascending: true });
      if (!active) return;
      if (error) { setSupportError('Unable to load this conversation. Please try again.'); console.error('Support conversation load failed.', error); }
      else {
        setSupportMessages((data ?? []) as OwnerSupportMessage[]);
        const { data: attachmentRows, error: attachmentError } = await client.from('support_ticket_attachments').select('id,message_id,storage_path,file_name,file_size,created_at').eq('ticket_id', selectedSupportTicketId).eq('visibility', 'public').order('created_at', { ascending: true });
        if (!active) return;
        if (attachmentError) console.error('Support attachment load failed.', attachmentError);
        const safeAttachments = (attachmentRows ?? []) as OwnerSupportAttachment[];
        setSupportAttachments(safeAttachments);
        const signed = await Promise.all(safeAttachments.map(async attachment => {
          const { data: urlData, error: urlError } = await client.storage.from('support-attachments').createSignedUrl(attachment.storage_path, 60);
          return [attachment.id, urlError ? '' : urlData.signedUrl] as const;
        }));
        if (active) setSupportAttachmentUrls(Object.fromEntries(signed));
      }
      setSupportMessagesLoading(false);
    };
    void loadMessages();
    const channel = client.channel('restaurant-support-messages-' + selectedSupportTicketId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_ticket_messages', filter: 'ticket_id=eq.' + selectedSupportTicketId }, () => { void loadMessages(); })
      .subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [supportOpen, supportView, selectedSupportTicketId]);

  async function sendSupportReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedSupportTicketId || !supportReply.trim()) return;
    const client = supabase;
    setSupportReplySending(true); setSupportError('');
    try {
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error('Your session has expired. Please sign in again.');
      const { data: sentMessage, error } = await client.from('support_ticket_messages').insert({
        ticket_id: selectedSupportTicketId, sender_user_id: user.id, message: supportReply.trim(), visibility: 'public',
      }).select('id').single();
      if (error) throw error;
      if (supportReplyFiles.length) await uploadRestaurantSupportAttachments(selectedSupportTicketId, supportReplyFiles, sentMessage.id);
      setSupportReply('');
      setSupportReplyFiles([]);
      const { data } = await client.from('support_ticket_messages').select('id,ticket_id,sender_user_id,message,visibility,created_at').eq('ticket_id', selectedSupportTicketId).eq('visibility', 'public').order('created_at', { ascending: true });
      if (data) setSupportMessages(data as OwnerSupportMessage[]);
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Your reply could not be sent.';
      setSupportError(message);
    } finally { setSupportReplySending(false); }
  }

  function openPasswordChange() {
    setAccountOpen(false);
    setPasswordError('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordOpen(true);
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    if (!supabase) { setPasswordError('Supabase is not configured.'); return; }
    const passwordPolicyError = getPasswordPolicyError(newPassword); if (passwordPolicyError) { setPasswordError(passwordPolicyError); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match.'); return; }
    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    if (error) { setPasswordError(error.message); return; }
    setPasswordOpen(false);
  }

  async function handleLogout() {
    if (!supabase) return;
    setLogoutSaving(true);
    const { error } = await supabase.auth.signOut();
    setLogoutSaving(false);
    if (error) { setPasswordError(error.message); return; }
    window.location.href = `${window.location.origin}${import.meta.env.BASE_URL}`;
  }

  useEffect(() => {
    const handleHashChange = () => setCurrentRoute(getCurrentRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (role === 'owner' && ownerDashboard) {
    return (
      <>
        <aside className="restaurant-owner-sidebar" aria-label="Restaurant management navigation">
          <a className="restaurant-owner-brand restaurant-owner-brand-premium" href="#restaurant/owner" aria-label={`${restaurant.name || 'Restaurant'} dashboard`}>
            <span className="restaurant-owner-brand-mark" aria-hidden="true">
              {(restaurant.name || 'Restaurant').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join('') || 'R'}
            </span>
            <span className="restaurant-owner-brand-copy">
              <strong>{restaurant.name || 'Restaurant'}</strong>
              <small>RESTAURANT MANAGEMENT</small>
            </span>
          </a>
          <nav className="restaurant-owner-sidebar-nav">
            {ownerNavigationGroups.map((group) => {
              const items = ownerNavigationItems.filter((item) =>
                group.hrefs.includes(item.href) && shouldShowOwnerNavigationItem(item, ownerModules)
              );
              if (modulesLoading || items.length === 0) return null;
              return (
                <div className="restaurant-owner-nav-group" key={group.label}>
                  <span className="restaurant-owner-nav-heading">{group.label}</span>
                  {items.map((item) => {
                    const active = currentRoute === item.href;
                    return (
                      <a key={item.href} className={active ? 'is-active' : ''} href={item.href} aria-current={active ? 'page' : undefined}>
                        <NavigationIcon type={item.icon} />
                        <span>{item.label}</span>
                      </a>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <div className="restaurant-owner-sidebar-support">
            <button type="button" className="restaurant-owner-sidebar-support-button" onClick={() => { setSupportOpen(true); setSupportError(''); setSupportSuccess(''); setSupportView('new'); setSelectedSupportTicketId(null); }}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
                <path d="M4 12h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2ZM20 12h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2Z" />
                <path d="M17 19a5 5 0 0 1-5 2" />
              </svg>
              <span>Contact Customer Support</span>
            </button>
          </div>
        </aside>
        {supportOpen ? (
          <div className="restaurant-support-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !supportSubmitting) setSupportOpen(false); }}>
            <section className="restaurant-support-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-support-title">
              <div className="restaurant-support-modal-header">
                <div>
                  <span className="restaurant-support-eyebrow">OWNER SUPPORT</span>
                  <h2 id="restaurant-support-title">How can we help?</h2>
                  <p>Report an issue, request an improvement, or ask for a standard service or item.</p>
                </div>
                <button className="restaurant-support-close" type="button" aria-label="Close support form" disabled={supportSubmitting} onClick={() => setSupportOpen(false)}>×</button>
              </div>
              <div className="restaurant-support-tabs" role="tablist" aria-label="Support options">
                <button type="button" role="tab" aria-selected={supportView === 'new'} className={supportView === 'new' ? 'is-active' : ''} onClick={() => { setSupportView('new'); setSupportError(''); }}>New request</button>
                <button type="button" role="tab" aria-selected={supportView === 'requests'} className={supportView === 'requests' ? 'is-active' : ''} onClick={() => { setSupportView('requests'); setSupportError(''); setSelectedSupportTicketId(null); }}>My requests</button>
              </div>
              {supportView === 'new' ? (
              <form onSubmit={async (event: FormEvent) => {
                event.preventDefault();
                setSupportError('');
                setSupportSuccess('');
                if (!supabase) { setSupportError('Support submission is temporarily unavailable. Please try again later.'); return; }
                if (!restaurant.id) { setSupportError('We could not identify your restaurant. Refresh the page and try again.'); return; }
                if (!supportSubject.trim() || !supportDescription.trim()) { setSupportError('Please complete the subject and description.'); return; }
                setSupportSubmitting(true);
                try {
                  const { data: { user }, error: userError } = await supabase.auth.getUser();
                  if (userError) throw userError;
                  if (!user) {
                    setSupportError('Your session has expired. Please sign in again and resubmit your request.');
                    return;
                  }

                  const { data: submittedRequest, error } = await supabase.from('restaurant_support_requests').insert({
                    restaurant_id: restaurant.id,
                    requester_user_id: user.id,
                    requester_email: user.email ?? email ?? null,
                    request_type: supportType,
                    subject: supportSubject.trim(),
                    description: supportDescription.trim(),
                    impact: supportImpact,
                    status: 'open',
                  }).select('id,request_number').single();

                  if (error) {
                    console.error('Support request submission failed.', {
                      code: error.code,
                      message: error.message,
                      details: error.details,
                      hint: error.hint,
                      restaurantId: restaurant.id,
                    });
                    if (error.code === '42501' || error.code === 'PGRST301') {
                      throw new Error('Your account could not submit a support request for this restaurant. Please refresh the page and sign in again. If the problem continues, contact support.');
                    }
                    throw new Error(error.message || 'The support request could not be saved. Please try again.');
                  }

                  if (supportFiles.length && submittedRequest?.id) {
                    await uploadRestaurantSupportAttachments(submittedRequest.id, supportFiles, null);
                  }
                  setSupportSuccess(`Your request ${submittedRequest?.request_number ?? ''} has been submitted. Our support team will follow up.`.trim());
                  setSupportSubject('');
                  setSupportDescription('');
                  setSupportFiles([]);
                  setSupportType('incident');
                  setSupportImpact('normal');
                } catch (submitError) {
                  const message = submitError && typeof submitError === 'object' && 'message' in submitError
                    ? String((submitError as { message?: unknown }).message || '')
                    : submitError instanceof Error ? submitError.message : '';
                  console.error('Unable to submit support request.', submitError);
                  setSupportError(message || 'Unable to submit your request. Please try again.');
                } finally {
                  setSupportSubmitting(false);
                }
              }}>
                <div className="restaurant-support-type-grid">
                  <button type="button" className={supportType === 'incident' ? 'is-selected' : ''} onClick={() => setSupportType('incident')} disabled={supportSubmitting}>
                    <span className="restaurant-support-type-icon" aria-hidden="true">!</span><span><strong>Incident</strong><small>Report a bug, outage, or something broken.</small></span>
                  </button>
                  <button type="button" className={supportType === 'change_request' ? 'is-selected' : ''} onClick={() => setSupportType('change_request')} disabled={supportSubmitting}>
                    <span className="restaurant-support-type-icon" aria-hidden="true">↗</span><span><strong>Change request</strong><small>Request a new feature or improvement.</small></span>
                  </button>
                  <button type="button" className={supportType === 'request_item' ? 'is-selected' : ''} onClick={() => setSupportType('request_item')} disabled={supportSubmitting}>
                    <span className="restaurant-support-type-icon" aria-hidden="true">＋</span><span><strong>Request Item (RITM)</strong><small>Request a standard service, access, or supported item.</small></span>
                  </button>
                </div>
                <label className="restaurant-support-field">Subject<input value={supportSubject} onChange={(event) => setSupportSubject(event.target.value)} maxLength={160} placeholder={supportType === 'incident' ? 'Briefly describe the issue' : supportType === 'change_request' ? 'What would you like to change?' : 'What service or item do you need?'} required /></label>
                <label className="restaurant-support-field">Description<textarea value={supportDescription} onChange={(event) => setSupportDescription(event.target.value)} maxLength={5000} rows={5} placeholder={supportType === 'incident' ? 'What happened? Include steps to reproduce and what you expected.' : supportType === 'change_request' ? 'Describe the change, why it would help, and how you expect it to work.' : 'Describe the item or service you need and why you need it.'} required /></label>
                <label className="restaurant-support-attach-icon" title="Attach files (images, PDF, or text; up to 10 MB each)" aria-label="Attach files to support request"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.4 11.1-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg><span className="restaurant-support-attach-tooltip">Attach files</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain" aria-label="Attach files to support request" disabled={supportSubmitting} onChange={(event) => setSupportFiles(Array.from(event.target.files ?? []))} /></label>
                <label className="restaurant-support-field">Impact / priority<select value={supportImpact} onChange={(event) => setSupportImpact(event.target.value)}><option value="low">Low — minor inconvenience</option><option value="normal">Normal — standard request</option><option value="high">High — work is significantly affected</option><option value="critical">Critical — business operations blocked</option></select></label>
                {supportFiles.length ? <p className="restaurant-support-feedback">{supportFiles.map((file) => file.name).join(', ')}</p> : null}
                {supportError ? <p className="restaurant-support-feedback is-error" role="alert">{supportError}</p> : null}
                {supportSuccess ? <p className="restaurant-support-feedback is-success" role="status">{supportSuccess}</p> : null}
                <div className="restaurant-support-actions">
                  <button type="button" className="restaurant-support-secondary" disabled={supportSubmitting} onClick={() => setSupportOpen(false)}>Cancel</button>
                  <button type="submit" className="restaurant-support-primary" disabled={supportSubmitting}>{supportSubmitting ? 'Submitting…' : 'Submit request'}</button>
                </div>
              </form>
              ) : (
                <div className="restaurant-support-inbox">
                  {supportError ? <p className="restaurant-support-feedback is-error" role="alert">{supportError}</p> : null}
                  {selectedSupportTicketId ? (
                    <div className="restaurant-support-thread">
                      <button type="button" className="restaurant-support-back" onClick={() => { setSelectedSupportTicketId(null); setSupportError(''); }}>← All requests</button>
                      {(() => { const ticket = supportTickets.find((item) => item.id === selectedSupportTicketId); return ticket ? <div className="restaurant-support-selected-ticket"><strong>{ticket.request_number || 'Support request'}</strong><span>{ticket.subject}</span><small>Status: {ticket.status.replace('_', ' ')}</small></div> : null; })()}
                      <div className="restaurant-support-messages" aria-live="polite">
                        {supportAttachments.some(attachment => !attachment.message_id) ? <article className="restaurant-support-message from-support"><div><strong>Ticket attachments</strong></div><ul className="restaurant-support-attachments">{supportAttachments.filter(attachment => !attachment.message_id).map(attachment => <li key={attachment.id}>{supportAttachmentUrls[attachment.id] ? <a href={supportAttachmentUrls[attachment.id]} target="_blank" rel="noreferrer">{attachment.file_name}</a> : <span>{attachment.file_name} (unavailable)</span>} <small>{(attachment.file_size / 1024 / 1024).toFixed(2)} MB</small></li>)}</ul></article> : null}
                        {supportMessagesLoading ? <p>Loading conversation…</p> : supportMessages.length === 0 ? <p>No replies yet. You can send a message to support below.</p> : supportMessages.map((message) => (
                          <article key={message.id} className={'restaurant-support-message ' + (message.sender_user_id === supportCurrentUserId ? 'from-owner' : 'from-support')}>
                            <div><strong>{message.sender_user_id === supportCurrentUserId ? 'You' : 'Support team'}</strong><time>{new Date(message.created_at).toLocaleString()}</time></div>
                            <p>{message.message}</p>
                            {supportAttachments.some(attachment => attachment.message_id === message.id) ? <ul className="restaurant-support-attachments">{supportAttachments.filter(attachment => attachment.message_id === message.id).map(attachment => <li key={attachment.id}>{supportAttachmentUrls[attachment.id] ? <a href={supportAttachmentUrls[attachment.id]} target="_blank" rel="noreferrer">{attachment.file_name}</a> : <span>{attachment.file_name} (unavailable)</span>} <small>{(attachment.file_size / 1024 / 1024).toFixed(2)} MB</small></li>)}</ul> : null}
                          </article>
                        ))}
                      </div>
                      {(() => { const ticket = supportTickets.find((item) => item.id === selectedSupportTicketId); const closed = !ticket || ['resolved','closed','cancelled'].includes(ticket.status); return closed ? <p className="restaurant-support-feedback">This request is closed. Submit a new request if you need more help.</p> : (
                        <form className="restaurant-support-reply-form" onSubmit={(event) => void sendSupportReply(event)}>
                          <label className="restaurant-support-field">Reply to support<textarea value={supportReply} onChange={(event) => setSupportReply(event.target.value)} rows={3} maxLength={10000} required placeholder="Add more details or reply to support…" /></label>
                          <label className="restaurant-support-attach-icon" title="Attach files (images, PDF, or text; up to 10 MB each)" aria-label="Attach files to support reply"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.4 11.1-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg><span className="restaurant-support-attach-tooltip">Attach files</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain" aria-label="Attach files to support reply" disabled={supportReplySending} onChange={(event) => setSupportReplyFiles(Array.from(event.target.files ?? []))} /></label>
                          {supportReplyFiles.length ? <p className="restaurant-support-feedback">{supportReplyFiles.map((file) => file.name).join(', ')}</p> : null}
                          <button type="submit" className="restaurant-support-primary" disabled={supportReplySending || !supportReply.trim()}>{supportReplySending ? 'Sending…' : 'Send reply'}</button>
                        </form>
                      ); })()}
                    </div>
                  ) : (
                    <div className="restaurant-support-request-list">
                      {supportInboxLoading ? <p>Loading your requests…</p> : supportTickets.length === 0 ? <p>You haven't submitted any support requests yet.</p> : supportTickets.map((ticket) => (
                        <button type="button" key={ticket.id} className="restaurant-support-request-row" onClick={() => { setSelectedSupportTicketId(ticket.id); setSupportError(''); }}>
                          <span><strong>{ticket.request_number || 'Support request'}</strong><small>{ticket.subject}</small><time>{new Date(ticket.created_at).toLocaleDateString()}</time></span>
                          <b className={'status-' + ticket.status}>{ticket.status.replace('_', ' ')}</b><span aria-hidden="true">›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        ) : null}
        <header className="restaurant-owner-topbar">
          <div className="restaurant-owner-topbar-status"><span /> <div><strong>Live</strong><small>System Online</small></div></div>
          <div className="restaurant-owner-topbar-divider" />
          <div className="restaurant-account-menu">
            <button className="restaurant-owner-user" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
              <span className="restaurant-owner-avatar">{displayName.slice(0, 2).toUpperCase()}</span>
              <span className="restaurant-owner-user-copy"><strong>{displayName}</strong><small>Store Owner</small></span>
              <span className="restaurant-owner-chevron" aria-hidden="true">⌄</span>
            </button>
            {accountOpen ? (
              <div className="restaurant-account-dropdown">
                <div className="restaurant-account-email">{email || 'Restaurant account'}</div>
                <button type="button" onClick={openPasswordChange}>Change password</button>
                <button type="button" onClick={() => void handleLogout()} disabled={logoutSaving}>{logoutSaving ? 'Logging out…' : 'Log out'}</button>
              </div>
            ) : null}
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <div className={`restaurant-navigation-row${role === 'dispatcher' ? ' is-dispatcher' : ''}`}>
        {role !== 'dispatcher' ? (
          <nav className="restaurant-navigation" aria-label="Restaurant operations navigation">
            {roleNavigationItems[role].map((item) => {
              const active = currentRoute === item.href;
              return (
                <a
                  key={item.href}
                  className={`restaurant-navigation-item${active ? ' is-active' : ''}`}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="restaurant-navigation-icon"><NavigationIcon type={item.icon} /></span>
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
        ) : null}

        <div className="restaurant-account-menu">
          <button className="restaurant-account-button" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
            </svg>
          </button>
          {accountOpen ? (
            <div className="restaurant-account-dropdown">
              <div className="restaurant-account-email">{email || 'Restaurant account'}</div>
              <button type="button" onClick={openPasswordChange}>Change password</button>
              <button type="button" onClick={() => void handleLogout()} disabled={logoutSaving}>{logoutSaving ? 'Logging out…' : 'Log out'}</button>
            </div>
          ) : null}
        </div>
      </div>

      {passwordOpen ? (
        <div className="restaurant-password-overlay" role="presentation" onMouseDown={() => setPasswordOpen(false)}>
          <section className="restaurant-password-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="restaurant-password-modal-header">
              <div><p className="eyebrow">Account</p><h2 id="restaurant-password-title">Change password</h2></div>
              <button className="restaurant-password-close" type="button" aria-label="Close" onClick={() => setPasswordOpen(false)}>×</button>
            </div>
            <p className="restaurant-password-helper">Choose a unique password with 8–128 characters. Avoid common passwords.</p>
            <form onSubmit={handleChangePassword}>
              <label className="restaurant-password-field"><span>New password</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" required /></label>
              <label className="restaurant-password-field"><span>Confirm new password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" required /></label>
              {passwordError ? <p className="restaurant-password-error" role="alert">{passwordError}</p> : null}
              <div className="restaurant-password-actions"><button className="button" type="button" onClick={() => setPasswordOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={passwordSaving}>{passwordSaving ? 'Saving…' : 'Change password'}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
