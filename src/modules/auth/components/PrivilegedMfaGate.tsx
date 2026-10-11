import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRestaurantOwnerAuth } from '../../../components/RestaurantOwnerAuthProvider';
import { supabase } from '../../../services/supabaseClient';
import { getPrivilegedMfaState, verifyPrivilegedMfaCode } from '../mfaService';

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
      if (user && appRole !== 'system_admin' && accountType === null) {
        // Wait for the provider to resolve owner/staff/customer status. Never
        // briefly render protected pages while a privileged role lookup is pending.
        setGate({ kind: 'loading' });
        return;
      }
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
        const result = await getPrivilegedMfaState(supabase);
        if (!cancelled) setGate(result);
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
      await verifyPrivilegedMfaCode(supabase, factorId, code);
      setCode('');
      setGate({ kind: 'ready' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The verification code could not be accepted.');
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || gate.kind === 'loading') {
    if (!user && !authLoading) return <>{children}</>;
    if (user && accountType === 'customer' && gate.kind === 'loading' && !authLoading) return <>{children}</>;
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
