import { supabase } from './supabaseClient';

export async function createPayMongoCheckout(orderId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const { data, error } = await supabase.functions.invoke('create-paymongo-checkout', {
    body: { orderId },
  });

  if (error) {
    throw new Error(error.message || 'Unable to start online payment.');
  }

  const checkoutUrl = typeof data?.checkoutUrl === 'string' ? data.checkoutUrl : '';
  if (!checkoutUrl) {
    throw new Error(data?.error || 'Unable to start online payment.');
  }

  return checkoutUrl;
}
