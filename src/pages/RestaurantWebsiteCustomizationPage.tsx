import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { defaultRestaurant } from '../config/defaultRestaurant';
import { supabase } from '../services/supabaseClient';
import { RestaurantFaviconSettings } from '../components/RestaurantFaviconSettings';
import { useOwnerUnsavedChanges } from '../contexts/OwnerUnsavedChangesContext';
import { useOwnerUnsavedChangesTracking } from '../hooks/useOwnerUnsavedChangesTracking';
import type { RestaurantStorefront, RestaurantTheme } from '../types/restaurant';

type Props = { restaurantId: string };

type WebsiteStyle = 'classic' | 'modern' | 'elegant' | 'warm';

const WEBSITE_STYLE_PRESETS: Record<WebsiteStyle, RestaurantTheme> = {
  classic: defaultRestaurant.theme,
  modern: { ...defaultRestaurant.theme, fontHeading: 'Manrope', fontBody: 'Inter', fontUi: 'Inter', borderRadius: 'small', buttonStyle: 'filled', colors: { ...defaultRestaurant.theme.colors, primary: '#111827', primaryHover: '#1f2937', secondary: '#f3f4f6', background: '#ffffff', surface: '#ffffff', text: '#111827', muted: '#64748b', border: '#e2e8f0' } },
  elegant: { ...defaultRestaurant.theme, fontHeading: 'Manrope', fontBody: 'Manrope', fontUi: 'Manrope', borderRadius: 'large', buttonStyle: 'outline', colors: { ...defaultRestaurant.theme.colors, primary: '#4b2e2e', primaryHover: '#633d3d', secondary: '#f5f1ed', secondaryText: '#4b2e2e', background: '#fffdf9', surface: '#ffffff', text: '#2f2925', muted: '#756b64', border: '#e7ded6' } },
  warm: { ...defaultRestaurant.theme, fontHeading: 'Manrope', fontBody: 'Inter', fontUi: 'Inter', borderRadius: 'large', buttonStyle: 'soft', colors: { ...defaultRestaurant.theme.colors, primary: '#b45309', primaryHover: '#92400e', secondary: '#fff7ed', secondaryText: '#9a3412', background: '#fffbf5', surface: '#ffffff', text: '#431407', muted: '#78716c', border: '#fed7aa' } }
};

function themeMatchesStyle(theme: RestaurantTheme, style: WebsiteStyle) {
  const preset = WEBSITE_STYLE_PRESETS[style];
  return theme.fontHeading === preset.fontHeading && theme.fontBody === preset.fontBody && theme.borderRadius === preset.borderRadius && theme.buttonStyle === preset.buttonStyle && theme.colors.primary === preset.colors.primary && theme.colors.background === preset.colors.background;
}

export function RestaurantWebsiteCustomizationPage({ restaurantId }: Props) {
  const { setUnsavedChanges } = useOwnerUnsavedChanges();
  const [logoUrl, setLogoUrl] = useState('');
  const [restaurantName, setRestaurantName] = useState(defaultRestaurant.name);
  const [restaurantTagline, setRestaurantTagline] = useState(defaultRestaurant.tagline);
  const [websiteTheme, setWebsiteTheme] = useState<RestaurantTheme>(defaultRestaurant.theme);
  const [websiteStyle, setWebsiteStyle] = useState<WebsiteStyle>('classic');
  const [storefront, setStorefront] = useState<RestaurantStorefront>(defaultRestaurant.storefront);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const previewDragRef = useRef<{ active: boolean; startX: number; startY: number; originX: number; originY: number }>({
    active: false, startX: 0, startY: 0, originX: 0, originY: 0
  });

  async function loadCustomization() {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .select('name,tagline,logo_url')
        .eq('id', restaurantId)
        .single();
      if (restaurantError) throw restaurantError;
      setRestaurantName(restaurant?.name ?? defaultRestaurant.name);
      setRestaurantTagline(restaurant?.tagline ?? defaultRestaurant.tagline);
      setLogoUrl(restaurant?.logo_url ?? '');

      const { data: customization, error: customizationError } = await supabase
        .from('restaurant_website_customizations')
        .select('theme,storefront')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (customizationError) throw customizationError;

      const customTheme = customization?.theme as Partial<RestaurantTheme> | null;
      setWebsiteTheme({
        ...defaultRestaurant.theme,
        ...(customTheme ?? {}),
        colors: { ...defaultRestaurant.theme.colors, ...(customTheme?.colors ?? {}) }
      });
      const loadedTheme = {
        ...defaultRestaurant.theme,
        ...(customTheme ?? {}),
        colors: { ...defaultRestaurant.theme.colors, ...(customTheme?.colors ?? {}) }
      };
      const matchingStyle = (Object.keys(WEBSITE_STYLE_PRESETS) as WebsiteStyle[]).find((style) => themeMatchesStyle(loadedTheme, style));
      setWebsiteStyle(matchingStyle ?? 'classic');

      const customStorefront = customization?.storefront as Partial<RestaurantStorefront> | null;
      const loadedStorefront = {
        ...defaultRestaurant.storefront,
        ...(customStorefront ?? {}),
        hero: { ...defaultRestaurant.storefront.hero, ...(customStorefront?.hero ?? {}) },
      };
      setStorefront(loadedStorefront);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load website customization.');
    } finally {
      setLoading(false);
    }
  }

  useOwnerUnsavedChangesTracking('.restaurant-shipping-page');

  useEffect(() => { void loadCustomization(); }, [restaurantId]);


  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = previewDragRef.current;
      if (!drag.active) return;

      const phoneWidth = window.innerWidth <= 700 ? 320 : 375;
      const phoneHeight = window.innerWidth <= 700 ? 650 : 760;
      const maxX = Math.max(0, window.innerWidth - phoneWidth);
      const maxY = Math.max(0, window.innerHeight - phoneHeight);
      const nextX = drag.originX + event.clientX - drag.startX;
      const nextY = drag.originY + event.clientY - drag.startY;

      setPreviewPosition({
        x: Math.max(0, Math.min(maxX, nextX)),
        y: Math.max(0, Math.min(maxY, nextY))
      });
    };

    const handlePointerUp = () => {
      previewDragRef.current.active = false;
      setPreviewDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  function openLivePreview() {
    const phoneWidth = window.innerWidth <= 700 ? 320 : 375;
    const phoneHeight = window.innerWidth <= 700 ? 650 : 760;
    setPreviewPosition({
      x: Math.max(0, (window.innerWidth - phoneWidth) / 2),
      y: Math.max(0, (window.innerHeight - phoneHeight) / 2)
    });
    setPreviewDragging(false);
    setShowLivePreview(true);
  }

  function startPreviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    previewDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewPosition.x,
      originY: previewPosition.y
    };
    setPreviewDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function resetPreviewPosition() {
    const phoneWidth = window.innerWidth <= 700 ? 320 : 375;
    const phoneHeight = window.innerWidth <= 700 ? 650 : 760;
    setPreviewPosition({
      x: Math.max(0, (window.innerWidth - phoneWidth) / 2),
      y: Math.max(0, (window.innerHeight - phoneHeight) / 2)
    });
    setPreviewDragging(false);
  }

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !supabase) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Logo must be a PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be 2 MB or smaller.');
      return;
    }

    setLogoUploading(true);
    setError('');
    setMessage('');
    try {
      const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${restaurantId}/logo.${extension}`;
      const { error: uploadError } = await supabase.storage.from('restaurant-logos').upload(path, file, {
        upsert: true, contentType: file.type, cacheControl: '3600'
      });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('restaurant-logos').getPublicUrl(path);
      const publicUrl = publicUrlData.publicUrl;
      const { error: saveError } = await supabase.from('restaurants').update({ logo_url: publicUrl }).eq('id', restaurantId);
      if (saveError) throw saveError;

      setLogoUrl(publicUrl);
      setMessage('Restaurant logo updated successfully.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload restaurant logo.');
    } finally {
      setLogoUploading(false);
    }
  }

  async function saveCustomization() {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { error: saveError } = await supabase
        .from('restaurant_website_customizations')
        .upsert({ restaurant_id: restaurantId, theme: websiteTheme, storefront }, { onConflict: 'restaurant_id' });
      if (saveError) throw saveError;
      setMessage('Website customization saved successfully.');
      setUnsavedChanges(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save website customization.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="restaurant-page restaurant-shipping-page">
      <style>{`
        .website-customization-form{display:grid;gap:22px}
        .owner-feedback-toast{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:12000;width:min(520px,calc(100vw - 32px));box-sizing:border-box;display:flex;align-items:flex-start;gap:12px;padding:15px 18px;border:1px solid;border-radius:14px;box-shadow:0 14px 40px rgba(15,23,42,.18);font-size:14px;line-height:1.45;animation:ownerFeedbackToastIn .22s ease-out}
        .owner-feedback-toast strong{display:block;margin:1px 0 3px;font-size:14px;font-weight:750}
        .owner-feedback-toast p{margin:0;font-size:13px}
        .owner-feedback-toast-icon{width:25px;height:25px;flex:0 0 25px;display:grid;place-items:center;border-radius:50%;font-size:13px;font-weight:800}
        .owner-feedback-toast.is-success{background:#f0fdf4;border-color:#86efac;color:#166534}
        .owner-feedback-toast.is-success .owner-feedback-toast-icon{background:#dcfce7;color:#15803d}
        .owner-feedback-toast.is-error{background:#fff7f7;border-color:#fca5a5;color:#991b1b}
        .owner-feedback-toast.is-error .owner-feedback-toast-icon{background:#fee2e2;color:#b91c1c}
        @keyframes ownerFeedbackToastIn{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
        @media(prefers-reduced-motion:reduce){.owner-feedback-toast{animation:none}}
        .website-customization-notice{display:flex;align-items:flex-start;gap:12px;margin:0 0 18px;padding:14px 16px;border:1px solid;border-radius:12px;font-size:14px;line-height:1.5;box-shadow:0 2px 8px rgba(15,23,42,.035);animation:websiteNoticeIn .18s ease-out}
        .website-customization-notice-icon{width:24px;height:24px;flex:0 0 24px;display:grid;place-items:center;border-radius:50%;font-size:13px;font-weight:800}
        .website-customization-notice-content{min-width:0;flex:1}
        .website-customization-notice-title{display:block;margin:0 0 2px;font-size:13px;font-weight:750;letter-spacing:.01em}
        .website-customization-notice-message{margin:0;font-size:13px}
        .website-customization-notice.is-success{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
        .website-customization-notice.is-success .website-customization-notice-icon{background:#dcfce7;color:#15803d}
        .website-customization-notice.is-error{background:#fff7f7;border-color:#fecaca;color:#991b1b}
        .website-customization-notice.is-error .website-customization-notice-icon{background:#fee2e2;color:#b91c1c}
        @keyframes websiteNoticeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @media(prefers-reduced-motion:reduce){.website-customization-notice{animation:none}}
        .website-customization-header{padding:24px;border:1px solid #e1e5eb;border-radius:14px;background:#fff}
        .website-customization-card{padding:24px;border:1px solid #e1e5eb;border-radius:14px;background:#fff}
        .website-customization-live-nav{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid}
        .website-customization-live-brand{display:flex;align-items:center;gap:8px;min-width:0}
        .website-customization-live-brand strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
        .website-customization-live-brand img,.website-customization-live-logo-fallback{width:30px;height:30px;object-fit:contain;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
        .website-customization-live-hero{margin:12px;padding:20px 16px;min-height:230px;box-sizing:border-box;border:1px solid;background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:center}
        .website-customization-live-eyebrow{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
        .website-customization-live-hero h3{font-size:25px;line-height:1.08;margin:7px 0 8px}
        .website-customization-live-hero p{margin:0;font-size:13px;line-height:1.5}
        .website-customization-live-disabled{margin:12px;padding:22px;text-align:center;border:1px dashed;font-size:12px}
        .website-customization-live-section{margin:12px;padding:12px;border:1px solid;border-color:inherit;border-radius:9px;display:flex;justify-content:space-between;gap:8px;font-size:12px}
        .website-customization-live-product-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px}
        .website-customization-live-product-card{min-width:0;overflow:hidden;border:1px solid;border-radius:10px;background:var(--product-card-bg,#fff)}
        .website-customization-live-product-image{height:88px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f1f5f9,#e2e8f0);font-size:32px}
        .website-customization-live-product-content{padding:9px}
        .website-customization-live-product-name{font-size:11px;font-weight:800;line-height:1.3;margin:0 0 4px}
        .website-customization-live-product-description{font-size:9px;line-height:1.4;margin:0 0 7px}
        .website-customization-live-product-bottom{display:flex;align-items:center;justify-content:space-between;gap:4px;font-size:10px;font-weight:800}
        .website-customization-live-product-add{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;font-size:15px;line-height:1}
        .website-customization-live-footer{padding:8px 12px;border-top:1px solid;text-align:center;font-size:9px;min-height:0}
        .website-customization-live-footer-powered-by{display:inline-flex;align-items:center;justify-content:center;gap:5px;margin-top:5px;color:inherit;text-decoration:none;font-size:8px;opacity:.8}
        .website-customization-live-footer-powered-logo{display:block;width:54px;max-width:100%;height:14px;object-fit:contain;object-position:left center;flex:0 0 auto}
        .website-customization-live-buttons{display:flex;gap:8px;margin:12px}
        .website-customization-live-buttons button{flex:1;border:1px solid transparent;border-radius:8px;padding:10px 6px;font:inherit;font-size:11px;font-weight:700}
        .website-customization-live-footer{padding:12px 10px 10px;border-top:1px solid;text-align:center;font-size:10px;min-height:0}
        .website-customization-live-footer-social{display:flex;flex-direction:column;align-items:center;gap:5px;padding:0 0 9px}
        .website-customization-live-footer-social-heading{margin:0;font-size:11px;font-weight:700;line-height:1.2}
        .website-customization-live-footer-socials{display:flex;align-items:center;justify-content:center;gap:7px}
        .website-customization-live-footer-social-link{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;box-sizing:border-box;border:1px solid #e3e7ee;border-radius:50%;background:#fff}
        .website-customization-live-footer-social-link.is-disabled{opacity:.42}
        .website-customization-live-footer-social-link img{display:block;width:17px;height:17px;object-fit:contain}
        .website-customization-live-footer-legal{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch;padding:4px 0;border-top:1px solid #e5e8ee;border-bottom:1px solid #e5e8ee}
        .website-customization-live-footer-legal-item{display:flex;min-width:0;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;padding:5px 3px;color:inherit;text-decoration:none;text-align:center}
        .website-customization-live-footer-legal-item+.website-customization-live-footer-legal-item{border-left:1px solid #e5e8ee}
        .website-customization-live-footer-legal-icon{display:block;width:14px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
        .website-customization-live-footer-legal-title{display:block;width:100%;max-width:74px;margin-inline:auto;font-size:8px;line-height:1.2;white-space:normal;overflow-wrap:normal;word-break:normal}
        .website-customization-live-footer-bottom{display:flex;flex-direction:column;align-items:center;gap:5px;padding-top:8px}
        .website-customization-live-footer-powered-by{display:inline-flex;align-items:center;justify-content:center;gap:5px;margin-top:0;color:inherit;text-decoration:none;font-size:9px;opacity:.8}
        .website-customization-live-footer-powered-logo{display:block;width:70px;max-width:100%;height:16px;object-fit:contain;object-position:left center;flex:0 0 auto}
        .website-customization-live-footer-powered-mark{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:4px;font-size:8px;font-weight:900}
        .website-customization-phone-toolbar{height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 6px 0 9px;box-sizing:border-box;color:#fff;font-size:11px;font-weight:800}
        .website-customization-phone-toolbar>div{display:flex;gap:4px}
        .website-customization-phone-toolbar button{border:1px solid rgba(255,255,255,.2);background:#1f2937;color:#fff;border-radius:5px;padding:3px 7px;font:inherit;font-size:10px;cursor:pointer}
        .website-customization-phone-toolbar button:last-child{font-size:15px;line-height:1;padding:1px 7px}
        .website-customization-card h2{margin:0 0 8px}
        .website-customization-section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}
        .website-customization-section-heading>div{min-width:0}
        .website-customization-inline-preview{flex:0 0 auto;white-space:nowrap}
        @media(max-width:600px){.website-customization-section-heading{align-items:flex-start;flex-direction:column}.website-customization-inline-preview{width:100%}}
        .website-customization-help{margin:0;color:#64748b;line-height:1.6}
        .website-customization-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}
        .website-customization-field{display:grid;gap:7px;font-weight:600;font-size:14px}
        .website-customization-field input[type=text],.website-customization-field select{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:12px;font:inherit;color:#0f172a;background:#fff}
        .website-customization-field input[type=color]{width:100%;height:44px;padding:4px;border:1px solid #dbe2ea;border-radius:10px;background:#fff;cursor:pointer}
        .website-customization-field input:focus,.website-customization-field select:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .website-customization-preview{margin-top:20px;padding:20px;border:1px solid #e1e5eb;border-radius:14px;background:var(--color-background);color:var(--color-text)}
        .website-customization-preview-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--color-border)}
        .website-customization-brand{display:flex;align-items:center;gap:10px;font-weight:800}
        .website-customization-dot{width:30px;height:30px;border-radius:var(--radius-sm);background:var(--color-primary)}
        .website-customization-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
        .website-customization-swatch{height:46px;border-radius:var(--radius-md);border:1px solid var(--color-border)}
        .website-customization-logo-row{display:flex;align-items:center;gap:16px;margin-top:16px;flex-wrap:wrap}
        .website-customization-logo-preview{width:96px;height:96px;border:1px solid #dbe2ea;border-radius:12px;background:#f8fafc;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#94a3b8;font-size:12px}
        .website-customization-logo-preview img{width:100%;height:100%;object-fit:contain}
        .website-customization-logo-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center}
        .website-customization-logo-button input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
        .website-customization-switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;font-weight:700;color:#0f172a}
        .website-customization-switch{position:relative;display:inline-flex;flex:0 0 auto}
        .website-customization-switch input{position:absolute;opacity:0;pointer-events:none}
        .website-customization-switch-track{position:relative;width:48px;height:28px;border-radius:999px;background:#cbd5e1;display:block}
        .website-customization-switch-thumb{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.25);transition:transform .2s ease}
        .website-customization-switch input:checked + .website-customization-switch-track{background:#101b2f}
        .website-customization-switch input:checked + .website-customization-switch-track .website-customization-switch-thumb{transform:translateX(20px)}
        .website-customization-toggle-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:22px}
        .website-customization-toggle{display:flex;align-items:center;gap:8px;min-height:44px;font-size:14px;font-weight:600}
        .website-customization-actions-bar{display:flex;justify-content:flex-end}
        .website-customization-confirm-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.45)}
        .website-customization-confirm-modal{width:min(420px,100%);box-sizing:border-box;padding:24px;border:1px solid #dbe2ea;border-radius:14px;background:#fff;box-shadow:0 20px 60px rgba(15,23,42,.2)}
        .website-customization-confirm-modal h2{margin:0 0 8px;color:#0f172a;font-size:20px}
        .website-customization-confirm-modal p{margin:0;color:#64748b;line-height:1.5}
        .website-customization-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
        @media(max-width:480px){.website-customization-confirm-actions{flex-direction:column-reverse}.website-customization-confirm-actions .button{width:100%}}
        .website-customization-preview-launch-card{display:flex;align-items:center;justify-content:space-between;gap:20px}
        .website-customization-preview-launch-card h2{margin:0 0 6px}
        .website-customization-phone{position:fixed;z-index:9998;width:375px;height:760px;box-sizing:border-box;padding:9px;border:8px solid #111827;border-radius:38px;background:#111827;box-shadow:0 24px 55px rgba(15,23,42,.28);cursor:grab;user-select:none;touch-action:none}
        .website-customization-phone.is-dragging{cursor:grabbing;box-shadow:0 30px 70px rgba(15,23,42,.34)}
        .website-customization-phone-screen{width:100%;height:calc(100% - 34px);box-sizing:border-box;overflow:auto;border-radius:25px;scrollbar-width:none}
        .website-customization-phone-screen::-webkit-scrollbar{display:none}
        .website-customization-branding-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(220px,.6fr);gap:24px;margin-top:18px;align-items:start}
        .website-customization-subheading{display:block;font-size:13px;font-weight:700;color:#475569;margin-bottom:8px}
        .website-customization-color-control{display:flex;align-items:center;gap:10px}
        .website-customization-color-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}
        .website-customization-color-setting{display:grid;gap:8px;padding:14px;border:1px solid #e2e8f0;border-radius:10px}
        .website-customization-color-setting>span{font-size:14px;font-weight:700}
        @media(max-width:700px){.website-customization-color-settings{grid-template-columns:1fr}}
        .website-customization-color-control input[type="color"]{width:48px;height:40px;padding:3px;border:1px solid #dbe2ea;border-radius:8px;cursor:pointer}
        .website-customization-color-control span{font-size:13px;font-weight:700;color:#0f172a}
        .website-customization-field-hint{display:block;margin-top:5px;color:#64748b;font-size:12px}
        .website-customization-style-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}
        .website-customization-style-card{display:grid;gap:7px;text-align:left;padding:14px;border:1px solid #dbe2ea;border-radius:12px;background:#fff;color:#0f172a;cursor:pointer;font:inherit}
        .website-customization-style-card:hover{border-color:#94a3b8}
        .website-customization-style-card.is-selected{border:2px solid #101b2f;padding:13px;box-shadow:0 0 0 2px rgba(16,27,47,.08)}
        .website-customization-style-card small{color:#64748b;font-size:12px}
        .website-customization-style-sample{display:block;width:100%;height:52px;border-radius:8px;background:#111827}
        .website-customization-style-sample-modern{background:linear-gradient(135deg,#111827,#64748b)}
        .website-customization-style-sample-elegant{background:linear-gradient(135deg,#4b2e2e,#d6bfae)}
        .website-customization-style-sample-warm{background:linear-gradient(135deg,#b45309,#fdba74)}
        .website-customization-homepage-group{margin-top:22px;padding-top:20px;border-top:1px solid #e2e8f0}
        .website-customization-homepage-group:first-of-type{border-top:0;padding-top:0}
        .website-customization-homepage-group h3{margin:0 0 6px;font-size:14px;color:#0f172a}
        @media(max-width:700px){.website-customization-branding-grid,.website-customization-style-grid{grid-template-columns:1fr}.website-customization-grid,.website-customization-toggle-grid,.website-customization-live-section-grid{grid-template-columns:1fr}.website-customization-preview-launch-card{align-items:flex-start;flex-direction:column}.website-customization-phone{width:320px;height:650px}.website-customization-live-hero h3{font-size:24px}.website-customization-actions-bar .button{width:100%}}
      `}</style>

      {error ? <div className="owner-feedback-toast is-error" role="alert"><span className="owner-feedback-toast-icon" aria-hidden="true">!</span><div><strong>Couldn't complete that action</strong><p>{error}</p></div></div> : null}
      {message ? <div className="owner-feedback-toast is-success" role="status"><span className="owner-feedback-toast-icon" aria-hidden="true">✓</span><div><strong>Changes saved</strong><p>{message}</p></div></div> : null}

      <form className="website-customization-form" onSubmit={(event: FormEvent) => { event.preventDefault(); setShowSaveConfirmation(true); }}>
        <div className="website-customization-header">
          <p className="eyebrow">Customer-facing website</p>
          <h1 style={{ margin: 0 }}>Customize</h1>
          <p className="website-customization-help" style={{ marginTop: 8 }}>Customize your restaurant's branding, homepage content, and visible customer-facing sections. These settings affect this restaurant only.</p>
        </div>

        {showLivePreview ? (
          <div
            className={`website-customization-phone website-customization-phone-floating${previewDragging ? ' is-dragging' : ''}`}
            onPointerDown={startPreviewDrag}
            style={{ left: previewPosition.x, top: previewPosition.y }}
          >
            <div className="website-customization-phone-toolbar">
              <span>Live Preview</span>
              <div>
                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={resetPreviewPosition}>Reset</button>
                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setShowLivePreview(false)} aria-label="Hide live preview">×</button>
              </div>
            </div>
            <div
              className="website-customization-phone-screen"
              style={{
                background: websiteTheme.colors.background,
                color: websiteTheme.colors.text,
                borderColor: websiteTheme.colors.border,
                borderRadius: websiteTheme.borderRadius === 'large' ? 18 : websiteTheme.borderRadius === 'small' ? 8 : 12,
                fontFamily: websiteTheme.fontBody
              }}
            >
              <div className="website-customization-live-nav" style={{ backgroundColor: websiteTheme.colors.header ?? websiteTheme.colors.background, color: websiteTheme.colors.text, borderBottomColor: websiteTheme.colors.border }}>
                <div className="website-customization-live-brand">
                  {logoUrl ? <img src={logoUrl} alt="" /> : <span className="website-customization-live-logo-fallback" style={{ background: websiteTheme.colors.primary, color: websiteTheme.colors.primaryText }}>🍴</span>}
                  <strong style={{ fontFamily: websiteTheme.fontHeading }}>{restaurantName}</strong>
                </div>
                <span style={{ color: websiteTheme.colors.muted }}>Menu</span>
              </div>
<div
                  className="website-customization-live-hero"
                  style={{
                    backgroundColor: websiteTheme.colors.hero ?? websiteTheme.colors.surface,
                    backgroundImage: storefront.hero.imageUrl ? `linear-gradient(rgba(0,0,0,.38),rgba(0,0,0,.38)), url("${storefront.hero.imageUrl}")` : undefined,
                    color: storefront.hero.imageUrl ? '#fff' : websiteTheme.colors.text,
                    borderColor: websiteTheme.colors.border,
                    borderRadius: websiteTheme.borderRadius === 'large' ? 16 : websiteTheme.borderRadius === 'small' ? 8 : 12
                  }}
                >
                  {storefront.hero.eyebrow ? <span className="website-customization-live-eyebrow" style={{ color: storefront.hero.imageUrl ? '#fff' : websiteTheme.colors.primary }}>{storefront.hero.eyebrow}</span> : null}
                  <h3 style={{ fontFamily: websiteTheme.fontHeading }}>{restaurantName}</h3>
                  {restaurantTagline ? <p>{restaurantTagline}</p> : null}
                </div>

              <div className="website-customization-live-section" style={{ backgroundColor: websiteTheme.colors.productCard ?? websiteTheme.colors.surface, color: websiteTheme.colors.text, borderColor: websiteTheme.colors.border }}><strong>Popular items</strong><span style={{ color: websiteTheme.colors.muted }}>Customer favorites</span></div>
              <div className="website-customization-live-product-grid">
                <article className="website-customization-live-product-card" style={{ borderColor: websiteTheme.colors.border, backgroundColor: websiteTheme.colors.productCard ?? websiteTheme.colors.surface, color: websiteTheme.colors.text }}>
                  <div className="website-customization-live-product-image" aria-hidden="true">🍔</div>
                  <div className="website-customization-live-product-content">
                    <p className="website-customization-live-product-name">Classic Burger</p>
                    <p className="website-customization-live-product-description" style={{ color: websiteTheme.colors.muted }}>Grilled beef, lettuce &amp; house sauce</p>
                    <div className="website-customization-live-product-bottom"><span>₱249</span><span className="website-customization-live-product-add" style={{ backgroundColor: websiteTheme.colors.primary, color: websiteTheme.colors.primaryText }}>+</span></div>
                  </div>
                </article>
                <article className="website-customization-live-product-card" style={{ borderColor: websiteTheme.colors.border, backgroundColor: websiteTheme.colors.productCard ?? websiteTheme.colors.surface, color: websiteTheme.colors.text }}>
                  <div className="website-customization-live-product-image" aria-hidden="true">🍕</div>
                  <div className="website-customization-live-product-content">
                    <p className="website-customization-live-product-name">Margherita Pizza</p>
                    <p className="website-customization-live-product-description" style={{ color: websiteTheme.colors.muted }}>Tomato, mozzarella &amp; fresh basil</p>
                    <div className="website-customization-live-product-bottom"><span>₱329</span><span className="website-customization-live-product-add" style={{ backgroundColor: websiteTheme.colors.primary, color: websiteTheme.colors.primaryText }}>+</span></div>
                  </div>
                </article>
              </div>
              <div className="website-customization-live-buttons"><button type="button" style={{ backgroundColor: websiteTheme.colors.primary, color: websiteTheme.colors.primaryText, borderColor: websiteTheme.colors.primary }}>Primary button</button><button type="button" style={{ backgroundColor: websiteTheme.colors.secondary, color: websiteTheme.colors.secondaryText, borderColor: websiteTheme.colors.border }}>Secondary button</button></div>

              <div className="website-customization-live-footer" style={{ backgroundColor: websiteTheme.colors.footer ?? websiteTheme.colors.background, borderTopColor: websiteTheme.colors.border, color: websiteTheme.colors.muted }}>
                <section className="website-customization-live-footer-social" aria-label="Follow the restaurant">
                  <h4 className="website-customization-live-footer-social-heading" style={{ color: websiteTheme.colors.text }}>Follow Us</h4>
                  <nav className="website-customization-live-footer-socials" aria-label="Social media links">
                    {([
                      ['Facebook', storefront.socialLinks?.facebook, `${import.meta.env.BASE_URL}social-facebook.svg`],
                      ['Instagram', storefront.socialLinks?.instagram, `${import.meta.env.BASE_URL}social-instagram.svg`],
                      ['TikTok', storefront.socialLinks?.tiktok, `${import.meta.env.BASE_URL}social-tiktok.svg`],
                    ] as const).map(([name, url, icon]) => (
                      url ? (
                        <a key={name} className="website-customization-live-footer-social-link" href={url} target="_blank" rel="noreferrer" aria-label={name} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                          <img src={icon} alt="" />
                        </a>
                      ) : (
                        <span key={name} className="website-customization-live-footer-social-link is-disabled" aria-label={`${name} not configured`} aria-disabled="true">
                          <img src={icon} alt="" />
                        </span>
                      )
                    ))}
                  </nav>
                </section>
                <nav className="website-customization-live-footer-legal" aria-label="Customer legal information">
                  <a className="website-customization-live-footer-legal-item" href="#privacy" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <svg className="website-customization-live-footer-legal-icon" viewBox="0 0 32 36" aria-hidden="true"><path d="M16 2 29 7v9c0 8-5.5 14-13 18C8.5 30 3 24 3 16V7L16 2Z" /></svg>
                    <span className="website-customization-live-footer-legal-title">Privacy Notice</span>
                  </a>
                  <a className="website-customization-live-footer-legal-item" href="#terms" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <svg className="website-customization-live-footer-legal-icon" viewBox="0 0 32 36" aria-hidden="true"><path d="M6 2h14l8 8v24H6Z" /><path d="M20 2v9h8M11 18h12M11 24h12" /></svg>
                    <span className="website-customization-live-footer-legal-title">Terms &amp; Conditions</span>
                  </a>
                  <a className="website-customization-live-footer-legal-item" href="#refunds" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <svg className="website-customization-live-footer-legal-icon" viewBox="0 0 36 36" aria-hidden="true"><path d="M29 13A13 13 0 0 0 6 10L3 14M3 6v8h8M7 23a13 13 0 0 0 23 3l3-4m0 8v-8h-8" /></svg>
                    <span className="website-customization-live-footer-legal-title">Refund &amp; Cancellation Policy</span>
                  </a>
                </nav>
                <div className="website-customization-live-footer-bottom">
                  <div>{`© ${new Date().getFullYear()} All rights reserved.`}</div>
                  <a className="website-customization-live-footer-powered-by" href="https://web2table.io" target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <span>Powered by</span>
                    <img src="https://xaihajwrsvcdjisezmmc.supabase.co/storage/v1/object/public/web2table-assets/web2table%20(1).png" alt="Web2Table" className="website-customization-live-footer-powered-logo" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <RestaurantFaviconSettings
          restaurantId={restaurantId}
          faviconUrl={storefront.faviconUrl}
          disabled={loading || saving}
          onChange={(url) => { setStorefront((current) => ({ ...current, faviconUrl: url || undefined })); setMessage(''); setError(''); }}
        />

        <div className="website-customization-card">
          <h2>Branding</h2>
          <p className="website-customization-help">Set the logo and main color customers will see across your website.</p>
          <div className="website-customization-branding-grid">
            <div>
              <span className="website-customization-subheading">Logo</span>
              <div className="website-customization-logo-row">
                <div className="website-customization-logo-preview">{logoUrl ? <img src={logoUrl} alt="Restaurant logo" /> : <span>No logo</span>}</div>
                <label className="button button-secondary website-customization-logo-button restaurant-compact-action">
                  {logoUploading ? 'Uploading…' : 'Choose logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleLogoChange(event)} disabled={loading || saving || logoUploading} />
                </label>
              </div>
            </div>

          </div>
        </div>

        <div className="website-customization-card">
          <h2>Social Media Links</h2>
          <p className="website-customization-help">Add your restaurant's Facebook, Instagram, and TikTok profile URLs. These links appear in the Follow Us section of your customer-facing website footer. Leave a field blank to show that network as unavailable.</p>
          <div className="website-customization-grid">
            {([
              ['facebook', 'Facebook URL', 'https://www.facebook.com/your-restaurant'],
              ['instagram', 'Instagram URL', 'https://www.instagram.com/your-restaurant'],
              ['tiktok', 'TikTok URL', 'https://www.tiktok.com/@your-restaurant'],
            ] as const).map(([key, label, placeholder]) => (
              <label className="website-customization-field" key={key}>
                <span>{label}</span>
                <input
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  placeholder={placeholder}
                  value={storefront.socialLinks?.[key] ?? ''}
                  disabled={loading || saving}
                  onChange={(event) => {
                    const value = event.target.value;
                    setStorefront((current) => ({
                      ...current,
                      socialLinks: { ...current.socialLinks, [key]: value }
                    }));
                    setMessage('');
                    setError('');
                  }}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="website-customization-card">
          <div className="website-customization-section-heading">
            <div>
              <h2>Website Colors</h2>
              <p className="website-customization-help">Choose colors for each part of your customer-facing store. Changes update the preview immediately and are saved per restaurant.</p>
            </div>
            <button type="button" className="button button-primary website-customization-inline-preview restaurant-compact-action" onClick={openLivePreview}>
              See Live Preview
            </button>
          </div>
          <div className="website-customization-color-settings">
            {([
              ['background', 'Page background', websiteTheme.colors.background],
              ['header', 'Header color', websiteTheme.colors.header ?? websiteTheme.colors.background],
              ['footer', 'Footer color', websiteTheme.colors.footer ?? websiteTheme.colors.background],
              ['hero', 'Hero section color', websiteTheme.colors.hero ?? websiteTheme.colors.surface],
              ['productCard', 'Product card color', websiteTheme.colors.productCard ?? websiteTheme.colors.surface],
              ['text', 'Font color', websiteTheme.colors.text],
              ['primary', 'Primary button color', websiteTheme.colors.primary],
              ['primaryText', 'Primary button font color', websiteTheme.colors.primaryText],
              ['secondary', 'Secondary button color', websiteTheme.colors.secondary],
              ['secondaryText', 'Secondary button font color', websiteTheme.colors.secondaryText],
            ] as const).map(([key, label, value]) => (
              <label className="website-customization-color-setting" key={key}>
                <span>{label}</span>
                <div className="website-customization-color-control">
                  <input
                    type="color"
                    value={value}
                    disabled={loading || saving}
                    onChange={(event) => {
                      const color = event.target.value;
                      setWebsiteTheme((current) => ({
                        ...current,
                        colors: {
                          ...current.colors,
                          [key]: color,
                          ...(key === 'primary' ? { primaryHover: color } : {}),
                        }
                      }));
                      setMessage('');
                      setError('');
                    }}
                  />
                  <span>{value.toUpperCase()}</span>
                </div>
              </label>
            ))}
          </div>
        </div>


        <div className="website-customization-actions-bar">
          <button
            className="button button-secondary restaurant-compact-action"
            type="button"
            disabled={loading || saving}
            onClick={() => {
              setWebsiteTheme((current) => ({
                ...current,
                colors: {
                  ...defaultRestaurant.theme.colors,
                  header: defaultRestaurant.theme.colors.header ?? defaultRestaurant.theme.colors.background,
                  footer: defaultRestaurant.theme.colors.footer ?? defaultRestaurant.theme.colors.background,
                  hero: defaultRestaurant.theme.colors.hero ?? defaultRestaurant.theme.colors.surface,
                  productCard: defaultRestaurant.theme.colors.productCard ?? defaultRestaurant.theme.colors.surface,
                },
              }));
              setMessage('');
              setError('');
            }}
          >
            Back to Default
          </button>
          <button className="button button-primary restaurant-compact-action" type="submit" disabled={loading || saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>

      {showSaveConfirmation ? (
        <div className="website-customization-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="website-customization-confirm-title">
          <div className="website-customization-confirm-modal">
            <h2 id="website-customization-confirm-title">Save Customizations?</h2>
            <p>Are you sure you want to save these customer-facing website changes?</p>
            <div className="website-customization-confirm-actions">
              <button type="button" className="button button-secondary" disabled={saving} onClick={() => setShowSaveConfirmation(false)}>Cancel</button>
              <button type="button" className="button button-primary" disabled={saving} onClick={() => { setShowSaveConfirmation(false); void saveCustomization(); }}>{saving ? 'Saving…' : 'Confirm Save'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
