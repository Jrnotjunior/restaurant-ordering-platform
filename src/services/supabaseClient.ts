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
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T[]>;
}
