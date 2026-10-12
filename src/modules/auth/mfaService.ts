import type { SupabaseClient } from '@supabase/supabase-js';

export type MfaGateResult =
  | { kind: 'ready' }
  | { kind: 'enroll'; factorId: string; qrCode: string; uri: string }
  | { kind: 'challenge'; factorId: string };

type EnrollmentResult = Extract<MfaGateResult, { kind: 'enroll' }>;

type CachedEnrollment = {
  factorId: string;
  result: EnrollmentResult;
};

// React StrictMode, remounts, or auth-state changes can ask for MFA state more
// than once at nearly the same time. Share one state-resolution request per
// Supabase client so concurrent calls cannot create competing enrollments.
const inFlightMfaState = new WeakMap<SupabaseClient, Promise<MfaGateResult>>();

// A pending TOTP factor's secret/QR is only returned by enroll(). Keep that
// response in memory so a remount can reuse the same QR instead of deleting the
// factor and immediately creating another one. Never persist the secret.
const cachedEnrollment = new WeakMap<SupabaseClient, CachedEnrollment>();

export function getPrivilegedMfaState(client: SupabaseClient): Promise<MfaGateResult> {
  const inFlight = inFlightMfaState.get(client);
  if (inFlight) return inFlight;

  let request: Promise<MfaGateResult>;
  request = resolvePrivilegedMfaState(client).finally(() => {
    if (inFlightMfaState.get(client) === request) {
      inFlightMfaState.delete(client);
    }
  });
  inFlightMfaState.set(client, request);
  return request;
}

async function resolvePrivilegedMfaState(client: SupabaseClient): Promise<MfaGateResult> {
  const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] =
    await Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
    ]);

  if (assuranceError) throw assuranceError;
  if (factorsError) throw factorsError;

  if (assurance.currentLevel === 'aal2') {
    cachedEnrollment.delete(client);
    return { kind: 'ready' };
  }

  const verifiedFactor = factors.totp.find((factor) => factor.status === 'verified');
  if (verifiedFactor) {
    cachedEnrollment.delete(client);
    return { kind: 'challenge', factorId: verifiedFactor.id };
  }

  const pendingFactors = factors.totp.filter((factor) => factor.status !== 'verified');
  const cached = cachedEnrollment.get(client);
  if (cached && pendingFactors.some((factor) => factor.id === cached.factorId)) {
    // Preserve the factor whose QR code was already shown. Remove only other
    // incomplete factors, which cannot be resumed without their original secret.
    for (const factor of pendingFactors) {
      if (factor.id === cached.factorId) continue;
      const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
    }
    return cached.result;
  }

  // An unverified factor without a matching in-memory enrollment response is
  // an abandoned setup (for example, from another tab or an earlier browser
  // session). Its secret cannot be recovered through listFactors, so remove
  // only these unverified factors before offering a fresh setup. Never remove
  // a verified factor.
  cachedEnrollment.delete(client);
  for (const factor of pendingFactors) {
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw error;
  }

  // Friendly names must be unique per user. Keep a random suffix as a
  // collision safeguard, but do not rely on naming alone for idempotency.
  let enrollment: Awaited<ReturnType<typeof client.auth.mfa.enroll>>['data'] = null;
  let enrollmentError: Awaited<ReturnType<typeof client.auth.mfa.enroll>>['error'] = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const enrollmentSuffix =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    const friendlyName = `Web2Table authenticator ${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)} ${enrollmentSuffix}`;

    const result = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName,
    });
    enrollment = result.data;
    enrollmentError = result.error;

    if (!enrollmentError) break;
    if (!/friendly name.*already exists|already exists.*friendly name/i.test(enrollmentError.message)) {
      throw enrollmentError;
    }
  }

  if (enrollmentError) {
    throw new Error(
      'Authenticator setup could not be started because the factor name already exists. Please try again; your verified authenticator has not been removed.',
    );
  }
  if (!enrollment) throw new Error('Authenticator setup did not return an enrollment factor. Please try again.');

  const result: EnrollmentResult = {
    kind: 'enroll',
    factorId: enrollment.id,
    qrCode: enrollment.totp.qr_code,
    uri: enrollment.totp.uri,
  };
  cachedEnrollment.set(client, { factorId: enrollment.id, result });
  return result;
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

  cachedEnrollment.delete(client);
}
