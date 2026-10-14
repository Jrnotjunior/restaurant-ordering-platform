import { supabase } from './supabaseClient';

const BUCKET = 'support-attachments';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']);

export async function uploadRestaurantSupportAttachments(ticketId: string, files: File[], messageId: string | null): Promise<void> {
  if (!supabase || files.length === 0) return;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Your session has expired. Please sign in again.');

  const uploadedPaths: string[] = [];
  try {
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) throw new Error(`File type not allowed: ${file.name}`);
      if (file.size <= 0 || file.size > MAX_BYTES) throw new Error(`${file.name} must be 10 MB or smaller.`);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'attachment';
      const path = `${ticketId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      const { error: metadataError } = await supabase.from('support_ticket_attachments').insert({
        ticket_id: ticketId, message_id: messageId, uploaded_by: user.id,
        storage_path: path, file_name: file.name.slice(0, 255), content_type: file.type,
        file_size: file.size, visibility: 'public',
      });
      if (metadataError) throw metadataError;
    }
  } catch (error) {
    if (uploadedPaths.length) {
      // Remove metadata first so a failed multi-file upload cannot leave orphaned rows.
      await supabase.from('support_ticket_attachments').delete().in('storage_path', uploadedPaths);
      await supabase.storage.from(BUCKET).remove(uploadedPaths);
    }
    throw error;
  }
}
