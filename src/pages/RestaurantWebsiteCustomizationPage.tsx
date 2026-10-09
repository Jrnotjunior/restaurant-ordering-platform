import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { defaultRestaurant } from '../config/defaultRestaurant';
import { supabase } from '../services/supabaseClient';
import { RestaurantFaviconSettings } from '../components/RestaurantFaviconSettings';
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
      setStorefront({
        ...defaultRestaurant.storefront,
        ...(customStorefront ?? {}),
        hero: { ...defaultRestaurant.storefront.hero, ...(customStorefront?.hero ?? {}) },
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load website customization.');
    } finally {
      setLoading(false);
    }
  }

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
        .website-customization-live-footer{padding:14px;border-top:1px solid;text-align:center;font-size:10px}
        .website-customization-live-footer-powered-by{display:inline-flex;align-items:center;justify-content:center;gap:5px;margin-top:8px;color:inherit;text-decoration:none;font-size:9px;opacity:.8}
        .website-customization-live-footer-powered-logo{display:inline-flex;align-items:center;gap:4px;font-weight:800}
        .website-customization-live-footer-powered-mark{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:4px;font-size:8px;font-weight:900}
        .website-customization-phone-toolbar{height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 6px 0 9px;box-sizing:border-box;color:#fff;font-size:11px;font-weight:800}
        .website-customization-phone-toolbar>div{display:flex;gap:4px}
        .website-customization-phone-toolbar button{border:1px solid rgba(255,255,255,.2);background:#1f2937;color:#fff;border-radius:5px;padding:3px 7px;font:inherit;font-size:10px;cursor:pointer}
        .website-customization-phone-toolbar button:last-child{font-size:15px;line-height:1;padding:1px 7px}
        .website-customization-card h2{margin:0 0 8px}
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

      {error ? <div className="restaurant-shipping-message is-error" role="alert">{error}</div> : null}
      {message ? <div className="restaurant-shipping-message is-success" role="status">{message}</div> : null}

      <form className="website-customization-form" onSubmit={(event: FormEvent) => { event.preventDefault(); setShowSaveConfirmation(true); }}>
        <div className="website-customization-header">
          <p className="eyebrow">Customer-facing website</p>
          <h1 style={{ margin: 0 }}>Customize</h1>
          <p className="website-customization-help" style={{ marginTop: 8 }}>Customize your restaurant's branding, homepage content, and visible customer-facing sections. These settings affect this restaurant only.</p>
        </div>

        <div className="website-customization-card website-customization-preview-launch-card">
          <div>
            <h2>Website Preview</h2>
            <p className="website-customization-help">Open a draggable mobile preview to see the customer website while you customize it.</p>
          </div>
          <button type="button" className="button button-primary" onClick={openLivePreview}>
            See Live Preview
          </button>
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
              <div className="website-customization-live-nav" style={{ borderBottomColor: websiteTheme.colors.border }}>
                <div className="website-customization-live-brand">
                  {logoUrl ? <img src={logoUrl} alt="" /> : <span className="website-customization-live-logo-fallback" style={{ background: websiteTheme.colors.primary, color: websiteTheme.colors.primaryText }}>🍴</span>}
                  <strong style={{ fontFamily: websiteTheme.fontHeading }}>{restaurantName}</strong>
                </div>
                <span style={{ color: websiteTheme.colors.muted }}>Menu</span>
              </div>
<div
                  className="website-customization-live-hero"
                  style={{
                    backgroundColor: websiteTheme.colors.surface,
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

              <div className="website-customization-live-section"><strong>Menu</strong><span style={{ color: websiteTheme.colors.muted }}>Restaurant menu and categories</span></div>

              <div className="website-customization-live-footer" style={{ borderTopColor: websiteTheme.colors.border, color: websiteTheme.colors.muted }}>
                <div>{`© ${new Date().getFullYear()} All rights reserved.`}</div>
                <a className="website-customization-live-footer-powered-by" href="https://web2table.com" target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                  <span>Powered by</span>
                  <img src="https://raw.githubusercontent.com/Jrnotjunior/restaurant-ordering-platform/main/web2table.png" alt="Web2Table" className="website-customization-live-footer-powered-logo" />
                </a>
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
                <label className="button button-secondary website-customization-logo-button">
                  {logoUploading ? 'Uploading…' : 'Choose logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleLogoChange(event)} disabled={loading || saving || logoUploading} />
                </label>
              </div>
            </div>
            <label className="website-customization-field">
              <span>Brand color</span>
              <div className="website-customization-color-control">
                <input type="color" value={websiteTheme.colors.primary} disabled={loading || saving} onChange={(event) => {
                  const value = event.target.value;
                  setWebsiteTheme((current) => ({ ...current, colors: { ...current.colors, primary: value, primaryHover: value } }));
                  setMessage('');
                  setError('');
                }} />
                <span>{websiteTheme.colors.primary.toUpperCase()}</span>
              </div>
              <small className="website-customization-field-hint">Used for buttons and important accents.</small>
            </label>
          </div>
        </div>

        <div className="website-customization-card">
          <h2>Website style</h2>
          <p className="website-customization-help">Choose a ready-made style for your website.</p>
          <div className="website-customization-style-grid">
            {([
              ['classic', 'Classic', 'Clean and familiar'],
              ['modern', 'Modern', 'Simple and contemporary'],
              ['elegant', 'Elegant', 'Refined and premium'],
              ['warm', 'Warm', 'Friendly and welcoming']
            ] as const).map(([key, label, description]) => (
              <button
                type="button"
                key={key}
                className={"website-customization-style-card" + (websiteStyle === key ? ' is-selected' : '')}
                onClick={() => {
                  setWebsiteStyle(key);
                  setWebsiteTheme(WEBSITE_STYLE_PRESETS[key]);
                  setMessage('');
                  setError('');
                }}
                disabled={loading || saving}
              >
                <span className={"website-customization-style-sample website-customization-style-sample-" + key} />
                <strong>{label}</strong>
                <small>{description}</small>
              </button>
            ))}
          </div>
        </div>



        <div className="website-customization-actions-bar">
          <button className="button button-primary" type="submit" disabled={loading || saving}>{saving ? 'Saving…' : 'Save Customizations'}</button>
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
