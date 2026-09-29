type CustomerContactActionsProps = {
  mobileNumber: string;
};

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('09')) return `+63${trimmed.slice(1)}`;
  if (trimmed.startsWith('9')) return `+63${trimmed}`;
  return trimmed;
}

export function CustomerContactActions({ mobileNumber }: CustomerContactActionsProps) {
  const phoneNumber = normalizePhoneNumber(mobileNumber);

  if (!phoneNumber) return null;

  return (
    <div className="customer-contact-actions" aria-label="Contact customer">
      <a className="customer-contact-action" href={`tel:${phoneNumber}`}>
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4h3l2 5-2 2c1.7 3.1 4 5.4 7.1 7.1l2-2 5 2v3c0 1.1-.9 2-2 2C11.3 21 3 12.7 3 3c0-1.1.9-2 2-2Z" transform="scale(.86) translate(2 2)" />
          </svg>
        </span>
        <span>Call</span>
      </a>

      <a className="customer-contact-action" href={`sms:${phoneNumber}`}>
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h4l4 3 4-3h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z" />
            <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01" />
          </svg>
        </span>
        <span>Text</span>
      </a>
    </div>
  );
}
