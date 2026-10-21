import { useState, type ChangeEvent } from 'react';
import { supabase } from '../services/supabaseClient';

type Props = {
  restaurantId: string;
  faviconUrl?: string;
  disabled?: boolean;
  onChange: (url: string) => void;
};

export function RestaurantFaviconSettings({ restaurantId, faviconUrl, disabled = false, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    const supportedTypes: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    const extension = supportedTypes[file.type];
    if (!extension) {
      setError('Favicon must be a PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > 512 * 1024) {
      setError('Favicon must be 512 KB or smaller.');
      return;
    }

    setUploading(true);
    setError('');
    try {
      const path = `${restaurantId}/favicon.${extension}`;
      const { error: uploadError } = await supabase.storage.from('restaurant-logos').upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: '3600',
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('restaurant-logos').getPublicUrl(path);
      onChange(`${data.publicUrl}?v=${Date.now()}`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload the favicon.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="website-customization-upload-row">
        <div className="website-customization-logo-preview" aria-label="Favicon preview">
          {faviconUrl ? <img src={faviconUrl} alt="Restaurant favicon preview" /> : <span>Default icon</span>}
        </div>
        <label className="button button-secondary website-customization-logo-button restaurant-compact-action">
          {uploading ? 'Uploading…' : 'Choose favicon'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void handleFileChange(event)}
            disabled={disabled || uploading}
          />
        </label>
      {error ? <p className="tenant-onboarding-error" role="alert">{error}</p> : null}
    </div>
  );
}
