import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRestaurantOwnerAuth } from './RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';

type Factor = { id: string; status?: string; friendly_name?: string };

type GateState =
  | { kind: 'loading' }
  | { kind: 'enroll'; factorId: string; qrCode: string; uri: string }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

export function PrivilegedMfaGate({ children }: { children: ReactNode }) {
  const { user, accountType, loading: authLoading, signOut } = useRestaurantOwnerAuth();
  const [gate, setGate] = useState<GateState>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const appRole = user?.app_metadata?.role;
  const isPrivileged = Boolean(
    user && (appRole === 'system_admin' || accountType === 'owner' || accountType === 'staff'),
  );

  useEffect(() => {
    let cancelled = false;
    async function checkMfa() {
      if (authLoading) return;
      if (!user || !isPrivileged) {
        setGate({ kind: 'ready' });
        setCode('');
        setMessage('');
        return;
      }
      if (!supabase) {
        setGate({ kind: 'error', message: 'Security verification is unavailable because Supabase is not configured.' });
        return;
      }

      setGate({ kind: 'loading' });
      try {
        const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] = await Promise.all([
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
          supabase.auth.mfa.listFactors(),
        ]);
        if (assuranceError) throw assuranceError;
        if (factorsError) throw factorsError;
        if (cancelled) return;

        if (assurance.currentLevel === 'aal2') {
          setGate({ kind: 'ready' });
          return;
        }

        const verified = factors.totp.find((factor) => factor.status === 'verified');
        if (verified) {
          setGate({ kind: 'challenge', factorId: verified.id });
          return;
        }

        const pending = factors.totp.find((factor) => factor.status !== 'verified');
        if (pending) {
          // Supabase can retain an unverified enrollment after an interrupted setup.
          // Ask for its code rather than creating duplicate factors.
          setGate({ kind: 'challenge', factorId: pending.id });
          return;
        }

        const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'Web2Table authenticator',
        });
        if (enrollmentError) throw enrollmentError;
        if (!cancelled) {
          setGate({
            kind: 'enroll',
            factorId: enrollment.id,
            qrCode: enrollment.totp.qr_code,
            uri: enrollment.totp.uri,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setGate({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Unable to check multi-factor authentication.',
          });
        }
      }
    }
    void checkMfa();
    return () => { cancelled = true; };
  }, [user?.id, accountType, appRole, authLoading, isPrivileged]);

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || (gate.kind !== 'enroll' && gate.kind !== 'challenge')) return;
    const factorId = gate.factorId;
    setBusy(true);
    setMessage('');
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;

      const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== 'aal2') {
        throw new Error('The code was accepted, but this session has not reached the required security level. Please try again.');
      }
      setCode('');
      setGate({ kind: 'ready' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The verification code could not be accepted.');
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || gate.kind === 'loading') {
    if (!isPrivileged && !authLoading) return <>{children}</>;
    return <main className="restaurant-owner-auth-page"><section className="restaurant-owner-auth-card"><p>Checking account security…</p></section></main>;
  }

  if (!user || !isPrivileged || gate.kind === 'ready') return <>{children}</>;

  if (gate.kind === 'error') {
    return (
      <main className="restaurant-owner-auth-page">
        <section className="restaurant-owner-auth-card" role="alert">
          <p className="eyebrow">Account security</p>
          <h1>Security check unavailable</h1>
          <p>{gate.message}</p>
          <p>Your privileged workspace stays locked until multi-factor authentication can be verified.</p>
          <button className="button button-primary" type="button" onClick={() => window.location.reload()}>Try again</button>
          <button className="button" type="button" onClick={() => void signOut()}>Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card" aria-labelledby="privileged-mfa-title">
        <p className="eyebrow">Required account security</p>
        <h1 id="privileged-mfa-title">{gate.kind === 'enroll' ? 'Set up two-factor authentication' : 'Verify it’s you'}</h1>
        {gate.kind === 'enroll' ? (
          <>
            <p>Web2Table requires an authenticator code for System Admin, Restaurant Owner, and Restaurant Staff accounts. Customer accounts are not affected.</p>
            <ol>
              <li>Open an authenticator app such as Google Authenticator, Microsoft Authenticator, or 1Password.</li>
              <li>Scan the QR code below. If scanning is unavailable, manually add the setup key using the URI shown below.</li>
              <li>Enter the six-digit code from the app to finish setup.</li>
            </ol>
            {gate.qrCode ? <div className="privileged-mfa-qr" aria-label="Authenticator setup QR code" dangerouslySetInnerHTML={{ __html: gate.qrCode }} /> : null}
            <details>
              <summary>Can’t scan the QR code?</summary>
              <p>Copy this setup URI into an authenticator app that supports manual setup:</p>
              <code className="privileged-mfa-uri">{gate.uri}</code>
            </details>
          </>
        ) : (
          <p>Enter the current six-digit code from your authenticator app to continue to your workspace.</p>
        )}
        <form className="restaurant-owner-auth-form" onSubmit={verifyCode}>
          <label htmlFor="privileged-mfa-code">Authenticator code</label>
          <input
            id="privileged-mfa-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            aria-describedby={message ? 'privileged-mfa-message' : undefined}
          />
          {message ? <p id="privileged-mfa-message" role="alert">{message}</p> : null}
          <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : gate.kind === 'enroll' ? 'Verify and enable 2FA' : 'Verify and continue'}
          </button>
        </form>
        <button className="button" type="button" onClick={() => void signOut()}>Sign out</button>
      </section>
    </main>
  );
}
