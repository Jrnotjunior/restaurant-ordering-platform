import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { defaultRestaurant } from '../config/defaultRestaurant';
import { supabase } from '../services/supabaseClient';
import type { RestaurantStorefront, RestaurantTheme } from '../types/restaurant';

type Props = { restaurantId: string };

export function RestaurantWebsiteCustomizationPage({ restaurantId }: Props) {
  const [logoUrl, setLogoUrl] = useState('');
  const [restaurantName, setRestaurantName] = useState(defaultRestaurant.name);
  const [restaurantTagline, setRestaurantTagline] = useState(defaultRestaurant.tagline);
  const [websiteTheme, setWebsiteTheme] = useState<RestaurantTheme>(defaultRestaurant.theme);
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

      const customStorefront = customization?.storefront as Partial<RestaurantStorefront> | null;
      setStorefront({
        ...defaultRestaurant.storefront,
        ...(customStorefront ?? {}),
        hero: { ...defaultRestaurant.storefront.hero, ...(customStorefront?.hero ?? {}) },
        sections: { ...defaultRestaurant.storefront.sections, ...(customStorefront?.sections ?? {}) },
        footer: { ...defaultRestaurant.storefront.footer, ...(customStorefront?.footer ?? {}) }
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
      setPreviewPosition({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY
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

  function startPreviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button, input, select, a')) return;
    const stage = previewStageRef.current;
    if (!stage) return;
    previewDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewPosition.x,
      originY: previewPosition.y
    };
    setPreviewDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function resetPreviewPosition() {
    setPreviewPosition({ x: 0, y: 0 });
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
        .website-customization-preview-launch-card{display:flex;align-items:center;justify-content:space-between;gap:20px}
        .website-customization-preview-launch-card h2{margin:0 0 6px}
        .website-customization-preview-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}
        .website-customization-preview-modal-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.62);backdrop-filter:blur(3px)}
        .website-customization-preview-modal-panel{position:relative;z-index:1;width:min(1100px,calc(100vw - 40px));height:min(900px,calc(100vh - 40px));display:flex;flex-direction:column;overflow:hidden;border:1px solid #dbe2ea;border-radius:18px;background:#fff;box-shadow:0 28px 90px rgba(15,23,42,.35)}
        .website-customization-preview-modal-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#fff}
        .website-customization-preview-modal-header h2{margin:0 0 3px;color:#0f172a;font-size:18px}
        .website-customization-preview-modal-header p{margin:0;color:#64748b;font-size:13px}
        .website-customization-preview-modal-actions{display:flex;align-items:center;gap:8px}
        .website-customization-preview-reset,.website-customization-preview-close{position:static;border:1px solid #dbe2ea;background:#fff;color:#334155;border-radius:8px;padding:8px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
        .website-customization-preview-close{width:36px;height:36px;padding:0;font-size:24px;line-height:1}
        .website-customization-preview-stage{position:relative;flex:1;min-height:0;overflow:hidden;background:radial-gradient(circle at center,#f8fafc 0,#eef2f7 58%,#e2e8f0 100%);touch-action:none;display:flex;align-items:center;justify-content:center}
        .website-customization-preview-stage::before{content:'Drag the phone anywhere';position:absolute;top:14px;left:50%;transform:translateX(-50%);font-size:12px;font-weight:700;color:#94a3b8;white-space:nowrap;pointer-events:none}
        .website-customization-phone{position:absolute;width:375px;height:760px;box-sizing:border-box;padding:9px;border:8px solid #111827;border-radius:38px;background:#111827;box-shadow:0 24px 55px rgba(15,23,42,.28);cursor:grab;user-select:none;touch-action:none}
        .website-customization-phone.is-dragging{cursor:grabbing;box-shadow:0 30px 70px rgba(15,23,42,.34)}
        .website-customization-phone-screen{width:100%;height:100%;box-sizing:border-box;overflow:auto;border-radius:25px;scrollbar-width:none}
        .website-customization-phone-screen::-webkit-scrollbar{display:none}
        .website-customization-live-nav{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid}
        .website-customization-live-brand{display:flex;align-items:center;gap:8px;min-width:0}
        .website-customization-live-brand strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
        .website-customization-live-brand img,.website-customization-live-logo-fallback{width:30px;height:30px;object-fit:contain;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
        .website-customization-live-hero{margin:12px;padding:20px 16px;min-height:230px;box-sizing:border-box;border:1px solid;background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:center}
        .website-customization-live-eyebrow{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
        .website-customization-live-hero h3{font-size:25px;line-height:1.08;margin:7px 0 8px}
        .website-customization-live-hero p{margin:0;font-size:13px;line-height:1.5}
        .website-customization-live-buttons{display:flex;gap:7px;flex-wrap:wrap;margin-top:16px}
        .website-customization-live-buttons span{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border:1px solid;border-radius:var(--radius-sm);font-size:11px;font-weight:800}
        .website-customization-live-disabled{margin:12px;padding:22px;text-align:center;border:1px dashed;font-size:12px}
        .website-customization-live-section{margin:12px;padding:12px;border:1px solid;border-color:inherit;border-radius:9px;display:flex;justify-content:space-between;gap:8px;font-size:12px}
        .website-customization-live-section-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px}
        .website-customization-live-section-grid>div{display:grid;gap:3px;padding:11px;border:1px solid;border-color:inherit;border-radius:9px;font-size:11px}
        .website-customization-live-footer{padding:14px;border-top:1px solid;text-align:center;font-size:10px}
        @media(max-width:700px){.website-customization-grid,.website-customization-toggle-grid,.website-customization-live-section-grid{grid-template-columns:1fr}.website-customization-preview-launch-card{align-items:flex-start;flex-direction:column}.website-customization-preview-modal{padding:8px}.website-customization-preview-modal-panel{width:100%;height:calc(100vh - 16px);border-radius:14px}.website-customization-preview-modal-header{padding:12px}.website-customization-preview-modal-header p{display:none}.website-customization-phone{transform:scale(.82);transform-origin:center}.website-customization-live-hero h3{font-size:24px}.website-customization-actions-bar .button{width:100%}}
        @media(max-width:480px){.website-customization-confirm-actions{flex-direction:column-reverse}.website-customization-confirm-actions .button{width:100%}}
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
          <button type="button" className="button button-primary" onClick={() => { resetPreviewPosition(); setShowLivePreview(true); }}>
            See Live Preview
          </button>
        </div>


          {showLivePreview ? (
        <div className="website-customization-preview-modal" role="dialog" aria-modal="true" aria-label="Live website preview">
          <div className="website-customization-preview-modal-backdrop" onPointerDown={() => setShowLivePreview(false)} />
          <div className="website-customization-preview-modal-panel">
            <div className="website-customization-preview-modal-header">
              <div>
                <h2>Live Preview</h2>
                <p>Drag the phone anywhere in this preview.</p>
              </div>
              <div className="website-customization-preview-modal-actions">
                <button type="button" className="website-customization-preview-reset" onClick={resetPreviewPosition}>Reset</button>
                <button type="button" className="website-customization-preview-close" onClick={() => setShowLivePreview(false)} aria-label="Close preview">×</button>
              </div>
            </div>
            <div>
              <h2>Live Preview</h2>
              <p className="website-customization-help">See how the customer website changes as you customize it. Preview updates are local until you save.</p>
            </div>
            <span className="website-customization-preview-badge">Live</span>
          </div>
          <div ref={previewStageRef} className="website-customization-preview-stage">
            <button type="button" className="website-customization-preview-reset" onPointerDown={(event) => event.stopPropagation()} onClick={resetPreviewPosition}>Reset</button>
            <div
              className={`website-customization-phone${previewDragging ? ' is-dragging' : ''}`}
              onPointerDown={startPreviewDrag}
              style={{
                transform: `translate(${previewPosition.x}px, ${previewPosition.y}px)`,
              }}
            >
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
            {storefront.hero.enabled ? (
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
                <h3 style={{ fontFamily: websiteTheme.fontHeading }}>{storefront.hero.title || restaurantName}</h3>
                {storefront.hero.description ? <p>{storefront.hero.description}</p> : null}
                <div className="website-customization-live-buttons">
                  {storefront.hero.primaryButtonLabel ? <span style={{ background: websiteTheme.buttonStyle === 'soft' ? websiteTheme.colors.secondary : websiteTheme.buttonStyle === 'outline' ? 'transparent' : websiteTheme.colors.primary, color: websiteTheme.buttonStyle === 'soft' ? websiteTheme.colors.secondaryText : websiteTheme.buttonStyle === 'outline' ? websiteTheme.colors.primary : websiteTheme.colors.primaryText, borderColor: websiteTheme.colors.primary }}>{storefront.hero.primaryButtonLabel}</span> : null}
                  {storefront.hero.secondaryButtonLabel ? <span style={{ background: 'transparent', color: storefront.hero.imageUrl ? '#fff' : websiteTheme.colors.text, borderColor: storefront.hero.imageUrl ? '#fff' : websiteTheme.colors.border }}>{storefront.hero.secondaryButtonLabel}</span> : null}
                </div>
              </div>
            ) : (
              <div className="website-customization-live-disabled" style={{ background: websiteTheme.colors.surface, borderColor: websiteTheme.colors.border, color: websiteTheme.colors.muted }}>Homepage hero is hidden.</div>
            )}
            {storefront.sections.categories ? <div className="website-customization-live-section"><strong>Menu categories</strong><span style={{ color: websiteTheme.colors.muted }}>Featured menu categories</span></div> : null}
            <div className="website-customization-live-section-grid">
              {storefront.sections.about ? <div><strong>About</strong><span style={{ color: websiteTheme.colors.muted }}>About your restaurant</span></div> : null}
              {storefront.sections.location ? <div><strong>Location</strong><span style={{ color: websiteTheme.colors.muted }}>Restaurant location</span></div> : null}
              {storefront.sections.hours ? <div><strong>Hours</strong><span style={{ color: websiteTheme.colors.muted }}>Operating hours</span></div> : null}
              {storefront.sections.contact ? <div><strong>Contact</strong><span style={{ color: websiteTheme.colors.muted }}>Contact information</span></div> : null}
              {storefront.sections.social ? <div><strong>Social</strong><span style={{ color: websiteTheme.colors.muted }}>Social links</span></div> : null}
            </div>
                {storefront.footer.enabled ? (
                  <div className="website-customization-live-footer" style={{ borderTopColor: websiteTheme.colors.border, color: websiteTheme.colors.muted }}>
                    {storefront.footer.text || `© ${new Date().getFullYear()} ${restaurantName}. All rights reserved.`}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        <div className="website-customization-card">
          <h2>Branding</h2>
          <p className="website-customization-help">Upload the logo customers will see on the restaurant website. PNG, JPG, or WebP up to 2 MB.</p>
          <div className="website-customization-logo-row">
            <div className="website-customization-logo-preview">{logoUrl ? <img src={logoUrl} alt="Restaurant logo" /> : <span>No logo</span>}</div>
            <label className="button button-secondary website-customization-logo-button">
              {logoUploading ? 'Uploading…' : 'Choose logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleLogoChange(event)} disabled={loading || saving || logoUploading} />
            </label>
          </div>
        </div>

        <div className="website-customization-card">
          <h2>Colors &amp; typography</h2>
          <p className="website-customization-help">Set the visual language used across the customer storefront.</p>
          <div className="website-customization-grid">
            {([
              ['primary', 'Primary color'], ['primaryHover', 'Primary hover'], ['primaryText', 'Primary button text'],
              ['secondary', 'Secondary color'], ['secondaryText', 'Secondary text'], ['background', 'Website background'],
              ['surface', 'Card surface'], ['text', 'Main text'], ['muted', 'Muted text'], ['border', 'Border color'],
            ] as const).map(([key, label]) => (
              <label className="website-customization-field" key={key}>
                <span>{label}</span>
                <input type="color" value={websiteTheme.colors[key]} disabled={loading || saving} onChange={(event) => {
                  const value = event.target.value;
                  setWebsiteTheme((current) => ({ ...current, colors: { ...current.colors, [key]: value } }));
                  setMessage(''); setError('');
                }} />
              </label>
            ))}
            <label className="website-customization-field"><span>Heading font</span><select value={websiteTheme.fontHeading} disabled={loading || saving} onChange={(event) => setWebsiteTheme((current) => ({ ...current, fontHeading: event.target.value }))}><option value="Manrope">Manrope</option><option value="Inter">Inter</option></select></label>
            <label className="website-customization-field"><span>Body &amp; UI font</span><select value={websiteTheme.fontBody} disabled={loading || saving} onChange={(event) => setWebsiteTheme((current) => ({ ...current, fontBody: event.target.value, fontUi: event.target.value }))}><option value="Inter">Inter</option><option value="Manrope">Manrope</option></select></label>
            <label className="website-customization-field"><span>Corner style</span><select value={websiteTheme.borderRadius ?? 'medium'} disabled={loading || saving} onChange={(event) => setWebsiteTheme((current) => ({ ...current, borderRadius: event.target.value as RestaurantTheme['borderRadius'] }))}><option value="small">Small / sharp</option><option value="medium">Medium</option><option value="large">Large / soft</option></select></label>
            <label className="website-customization-field"><span>Button style</span><select value={websiteTheme.buttonStyle ?? 'filled'} disabled={loading || saving} onChange={(event) => setWebsiteTheme((current) => ({ ...current, buttonStyle: event.target.value as RestaurantTheme['buttonStyle'] }))}><option value="filled">Filled</option><option value="outline">Outline</option><option value="soft">Soft</option></select></label>
          </div>
          <div className="website-customization-preview">
            <div className="website-customization-preview-bar"><div className="website-customization-brand"><span className="website-customization-dot" /><span>Customer website preview</span></div><span style={{ color: websiteTheme.colors.muted, fontSize: 13 }}>Preview</span></div>
            <div style={{ marginTop: 18 }}>
              <h3 style={{ margin: 0, fontFamily: websiteTheme.fontHeading, color: websiteTheme.colors.text }}>Make your restaurant feel like your brand.</h3>
              <p style={{ color: websiteTheme.colors.muted, lineHeight: 1.5 }}>Colors, typography and controls are applied to the customer-facing storefront.</p>
              <div className="website-customization-actions">
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 42, padding: '0 18px', borderRadius: websiteTheme.borderRadius === 'large' ? 16 : websiteTheme.borderRadius === 'small' ? 8 : 12, background: websiteTheme.buttonStyle === 'outline' ? 'transparent' : websiteTheme.buttonStyle === 'soft' ? websiteTheme.colors.secondary : websiteTheme.colors.primary, color: websiteTheme.buttonStyle === 'outline' ? websiteTheme.colors.primary : websiteTheme.buttonStyle === 'soft' ? websiteTheme.colors.secondaryText : websiteTheme.colors.primaryText, border: '1px solid ' + (websiteTheme.buttonStyle === 'outline' ? websiteTheme.colors.primary : websiteTheme.buttonStyle === 'soft' ? websiteTheme.colors.secondary : websiteTheme.colors.primary), fontWeight: 700 }}>Order now</span>
                <span className="website-customization-swatch" style={{ flex: 1, background: websiteTheme.colors.surface }} />
              </div>
            </div>
          </div>
        </div>

        <div className="website-customization-card">
          <h2>Homepage hero</h2>
          <p className="website-customization-help">Control the main message customers see when they open the restaurant website.</p>
          <div className="website-customization-grid">
            <label className="website-customization-field"><span>Hero eyebrow</span><input type="text" value={storefront.hero.eyebrow} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, eyebrow: event.target.value } }))} /></label>
            <label className="website-customization-field"><span>Hero title</span><input type="text" value={storefront.hero.title} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, title: event.target.value } }))} /></label>
            <label className="website-customization-field" style={{ gridColumn: '1 / -1' }}><span>Hero description</span><input type="text" value={storefront.hero.description} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, description: event.target.value } }))} /></label>
            <label className="website-customization-field"><span>Hero image URL</span><input type="text" placeholder="https://..." value={storefront.hero.imageUrl ?? ''} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, imageUrl: event.target.value } }))} /></label>
            <label className="website-customization-field"><span>Primary button label</span><input type="text" value={storefront.hero.primaryButtonLabel} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, primaryButtonLabel: event.target.value } }))} /></label>
            <label className="website-customization-field"><span>Primary button link</span><input type="text" value={storefront.hero.primaryButtonHref} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, primaryButtonHref: event.target.value } }))} /></label>
            <label className="website-customization-field"><span>Secondary button label</span><input type="text" value={storefront.hero.secondaryButtonLabel ?? ''} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, secondaryButtonLabel: event.target.value } }))} /></label>
            <label className="website-customization-field"><span>Secondary button link</span><input type="text" value={storefront.hero.secondaryButtonHref ?? ''} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, secondaryButtonHref: event.target.value } }))} /></label>
          </div>
          <label className="website-customization-switch-row"><span>Show homepage hero</span><span className="website-customization-switch"><input type="checkbox" checked={storefront.hero.enabled} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, hero: { ...current.hero, enabled: event.target.checked } }))} /><span className="website-customization-switch-track"><span className="website-customization-switch-thumb" /></span></span></label>
        </div>

        <div className="website-customization-card">
          <h2>Homepage sections</h2>
          <p className="website-customization-help">Choose which supporting sections appear on the customer website.</p>
          <div className="website-customization-toggle-grid">
            {([
              ['categories', 'Show menu categories'], ['about', 'Show about section'], ['location', 'Show location'],
              ['hours', 'Show operating hours'], ['contact', 'Show contact information'], ['social', 'Show social links'],
            ] as const).map(([key, label]) => (
              <label className="website-customization-toggle" key={key}><input type="checkbox" checked={storefront.sections[key]} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, sections: { ...current.sections, [key]: event.target.checked } }))} />{label}</label>
            ))}
          </div>
        </div>

        <div className="website-customization-card">
          <h2>Footer</h2>
          <p className="website-customization-help">Control the customer-facing footer.</p>
          <label className="website-customization-field" style={{ marginTop: 18 }}><span>Footer text</span><input type="text" placeholder="Optional custom footer message" value={storefront.footer.text ?? ''} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, footer: { ...current.footer, text: event.target.value } }))} /></label>
          <label className="website-customization-switch-row"><span>Show footer</span><span className="website-customization-switch"><input type="checkbox" checked={storefront.footer.enabled} disabled={loading || saving} onChange={(event) => setStorefront((current) => ({ ...current, footer: { ...current.footer, enabled: event.target.checked } }))} /><span className="website-customization-switch-track"><span className="website-customization-switch-thumb" /></span></span></label>
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
