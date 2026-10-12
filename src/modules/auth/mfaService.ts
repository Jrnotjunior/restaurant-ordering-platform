import type { SupabaseClient } from '@supabase/supabase-js';

export type MfaGateResult =
  | { kind: 'ready' }
  | { kind: 'enroll'; factorId: string; qrCode: string; uri: string }
  | { kind: 'challenge'; factorId: string };

export async function getPrivilegedMfaState(client: SupabaseClient): Promise<MfaGateResult> {
  const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] =
    await Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
    ]);

  if (assuranceError) throw assuranceError;
  if (factorsError) throw factorsError;
  if (assurance.currentLevel === 'aal2') return { kind: 'ready' };

  const verifiedFactor = factors.totp.find((factor) => factor.status === 'verified');
  if (verifiedFactor) return { kind: 'challenge', factorId: verifiedFactor.id };

  // A pending factor can remain after a user closes the browser mid-enrollment.
  // Remove that incomplete factor before restarting setup, rather than trying to
  // challenge a factor that has not yet been verified.
  const pendingFactors = factors.totp.filter((factor) => factor.status !== 'verified');
  for (const factor of pendingFactors) {
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw error;
  }

  // Supabase requires authenticator friendly names to be unique per user.
  // A previous interrupted enrollment may leave the name reserved briefly,
  // even after an unverified factor is removed. Use a unique label so setup
  // can recover instead of trapping the user on the security-error screen.
  // Timestamp-only names can collide when the MFA gate retries or remounts
  // within the same second. Add a random suffix so every enrollment attempt
  // has a distinct name, including retries after an interrupted setup.
  const enrollmentSuffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  const friendlyName = `Web2Table authenticator ${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)} ${enrollmentSuffix}`;
  const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (enrollmentError) throw enrollmentError;

  return {
    kind: 'enroll',
    factorId: enrollment.id,
    qrCode: enrollment.totp.qr_code,
    uri: enrollment.totp.uri,
  };
}

export async function verifyPrivilegedMfaCode(
  client: SupabaseClient,
  factorId: string,
  code: string,
): Promise<void> {
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
  if (challengeError) throw challengeError;

  const { error: verifyError } = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });
  if (verifyError) throw verifyError;

  const { data: assurance, error: assuranceError } =
    await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  if (assurance.currentLevel !== 'aal2') {
    throw new Error(
      'The code was accepted, but this session has not reached the required security level. Please try again.',
    );
  }
}
