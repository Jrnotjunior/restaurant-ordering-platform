import { useEffect, useRef, useState } from 'react';
import '../styles/delivery-navigation.css';

type DeliveryNavigationProps = {
  address: string;
};

function buildGoogleMapsUrl(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

function buildWazeUrl(address: string) {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

export function DeliveryNavigation({ address }: DeliveryNavigationProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const trimmedAddress = address.trim();

  if (!trimmedAddress) return null;

  return (
    <>
      <button
        type="button"
        className="delivery-navigation-address"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="delivery-navigation-pin" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 10.5c0 5.2-8 10-8 10s-8-4.8-8-10a8 8 0 1 1 16 0Z" />
            <circle cx="12" cy="10.5" r="2.5" />
          </svg>
        </span>
        <span className="delivery-navigation-address-text">
          <strong>Delivery address</strong>
          <span>{trimmedAddress}</span>
        </span>
        <span className="delivery-navigation-arrow" aria-hidden="true">›</span>
      </button>

      {open ? (
        <div
          className="delivery-navigation-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="delivery-navigation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delivery-navigation-title"
            tabIndex={-1}
          >
            <div className="delivery-navigation-dialog-header">
              <div>
                <p className="eyebrow">Navigate to customer</p>
                <h2 id="delivery-navigation-title">Open navigation</h2>
              </div>
              <button
                type="button"
                className="delivery-navigation-close"
                onClick={() => setOpen(false)}
                aria-label="Close navigation options"
              >
                ×
              </button>
            </div>

            <div className="delivery-navigation-destination">
              <span className="delivery-navigation-pin" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10.5c0 5.2-8 10-8 10s-8-4.8-8-10a8 8 0 1 1 16 0Z" />
                  <circle cx="12" cy="10.5" r="2.5" />
                </svg>
              </span>
              <span>{trimmedAddress}</span>
            </div>

            <div className="delivery-navigation-options">
              <a
                className="delivery-navigation-option"
                href={buildGoogleMapsUrl(trimmedAddress)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <span className="delivery-navigation-option-icon delivery-navigation-google" aria-hidden="true">
                  G
                </span>
                <span>
                  <strong>Google Maps</strong>
                  <small>Open route in Google Maps</small>
                </span>
                <span className="delivery-navigation-option-arrow" aria-hidden="true">↗</span>
              </a>

              <a
                className="delivery-navigation-option"
                href={buildWazeUrl(trimmedAddress)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <span className="delivery-navigation-option-icon delivery-navigation-waze" aria-hidden="true">
                  W
                </span>
                <span>
                  <strong>Waze</strong>
                  <small>Open route in Waze</small>
                </span>
                <span className="delivery-navigation-option-arrow" aria-hidden="true">↗</span>
              </a>
            </div>

            <p className="delivery-navigation-note">
              DATIHAN.PH does not use a maps API. Your navigation app handles the route.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
