const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export async function supabaseGet<T>(path: string, params: Record<string, string>): Promise<T[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const searchParams = new URLSearchParams(params);
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}?${searchParams.toString()}`, {
    headers: {
      // Supabase publishable keys belong in the apikey header.
      // Do not send the publishable key as a Bearer token.
      apikey: supabaseAnonKey,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const detail = errorBody.trim() ? ` ${errorBody.trim()}` : '';
    throw new Error(`Supabase request failed with status ${response.status}.${detail}`);
  }

  return response.json() as Promise<T[]>;
}
