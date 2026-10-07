import { useMemo } from 'react';

export function TenantInviteLandingPage() {
  const confirmationUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('confirmation_url') ?? '';
  }, []);

  function acceptInvitation() {
    if (!confirmationUrl) return;
    window.location.assign(confirmationUrl);
  }

  return (
    <section className="restaurant-owner-auth-no-restaurant">
      <div className="restaurant-owner-auth-no-restaurant-card" style={{ maxWidth: 620, width: '100%' }}>
        <p className="eyebrow">Tenant invitation</p>
        <h1>Accept your restaurant invitation.</h1>
        <p>
          Your invitation is ready. Click the button below to securely accept it and continue
          to your restaurant setup.
        </p>

        {!confirmationUrl ? (
          <div className="error-banner">
            This invitation link is incomplete. Please use the latest invitation email from the
            Web2Table System Administrator.
          </div>
        ) : (
          <div className="modal-actions">
            <button type="button" onClick={acceptInvitation}>
              Accept invitation
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
