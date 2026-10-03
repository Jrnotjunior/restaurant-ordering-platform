import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export async function createPayMongoCheckout(orderId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const { data, error } = await supabase.functions.invoke('create-paymongo-checkout', {
    body: { orderId },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const responseBody = await error.context.clone().json().catch(() => null);
      if (responseBody && typeof responseBody.error === 'string') {
        const debug = responseBody.debug;
        if (
          debug &&
          typeof debug.lineItemTotal === 'number' &&
          typeof debug.expectedTotal === 'number'
        ) {
          throw new Error(
            responseBody.error +
            ' (lineItemTotal: ' +
            debug.lineItemTotal +
            ', expectedTotal: ' +
            debug.expectedTotal +
            ')',
          );
        }
        throw new Error(responseBody.error);
      }
    }

    throw new Error(error.message || 'Unable to start online payment.');
  }

  const checkoutUrl = typeof data?.checkoutUrl === 'string' ? data.checkoutUrl : '';
  if (!checkoutUrl) {
    throw new Error(data?.error || 'Unable to start online payment.');
  }

  return checkoutUrl;
}
