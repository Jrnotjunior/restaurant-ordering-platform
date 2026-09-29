import { FormEvent, useMemo, useState } from 'react';

type RiderStatus = 'Available' | 'Delivering' | 'Offline';

type RiderAccount = {
  id: string;
  name: string;
  mobileNumber: string;
  email: string;
  status: RiderStatus;
  scopes: string[];
};

const sampleRiders: RiderAccount[] = [
  {
    id: 'rider-1',
    name: 'John Santos',
    mobileNumber: '0917 123 4567',
    email: 'john.santos@example.com',
    status: 'Available',
    scopes: ['Dalandanan', 'Malinta', 'Arkong Bato'],
  },
  {
    id: 'rider-2',
    name: 'Mark Dela Cruz',
    mobileNumber: '0918 234 5678',
    email: 'mark.delacruz@example.com',
    status: 'Delivering',
    scopes: ['Gen. T. de Leon', 'Karuhatan', 'Paso de Blas'],
  },
];

export function RestaurantRidersPage() {
  const [riders, setRiders] = useState<RiderAccount[]>(sampleRiders);
  const [showForm, setShowForm] = useState(false);

  const availableCount = useMemo(
    () => riders.filter((rider) => rider.status === 'Available').length,
    [riders],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopeText = String(form.get('scope') || '');
    const scopes = scopeText
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    const rider: RiderAccount = {
      id: `preview-${Date.now()}`,
      name: String(form.get('name') || 'New Rider'),
      mobileNumber: String(form.get('mobileNumber') || ''),
      email: String(form.get('email') || ''),
      status: 'Available',
      scopes,
    };

    setRiders((current) => [...current, rider]);
    event.currentTarget.reset();
    setShowForm(false);
  }

  function toggleRiderStatus(id: string) {
    setRiders((current) => current.map((rider) => {
      if (rider.id !== id) return rider;
      return { ...rider, status: rider.status === 'Offline' ? 'Available' : 'Offline' };
    }));
  }

  return (
    <section className="restaurant-riders-page">
      <div className="restaurant-riders-header">
        <div>
          <p className="eyebrow">Delivery team</p>
          <h1>Riders</h1>
          <p>Manage the in-house riders who deliver this restaurant's orders.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setShowForm((current) => !current)}>
          {showForm ? 'Close' : 'Add Rider'}
        </button>
      </div>

      <div className="restaurant-riders-summary" aria-label="Rider summary">
        <div>
          <strong>{availableCount}</strong>
          <span>Available now</span>
        </div>
        <div>
          <strong>{riders.length}</strong>
          <span>Total riders</span>
        </div>
      </div>

      <div className="restaurant-riders-preview-note" role="note">
        <strong>Preview mode</strong>
        <span>This page is ready for the rider workflow. Rider records will be connected to Supabase after the rider tables and authentication are added.</span>
      </div>

      {showForm ? (
        <form className="restaurant-rider-form" onSubmit={handleSubmit}>
          <div className="restaurant-rider-form-heading">
            <div>
              <p className="eyebrow">New rider</p>
              <h2>Add rider</h2>
            </div>
            <p>The restaurant owner creates the rider account and assigns the delivery scope.</p>
          </div>

          <div className="restaurant-rider-form-grid">
            <label>
              Rider name
              <input name="name" type="text" placeholder="e.g. Juan Dela Cruz" required />
            </label>
            <label>
              Mobile number
              <input name="mobileNumber" type="tel" placeholder="09XX XXX XXXX" required />
            </label>
            <label>
              Login email
              <input name="email" type="email" placeholder="rider@example.com" required />
            </label>
            <label>
              Delivery scope
              <input name="scope" type="text" placeholder="Dalandanan, Malinta, Arkong Bato" />
            </label>
          </div>

          <p className="restaurant-rider-form-help">Separate multiple delivery areas with commas. Login credentials will be handled by Supabase Auth, not stored in this form.</p>

          <div className="restaurant-rider-form-actions">
            <button className="button button-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="button button-primary" type="submit">Add Rider</button>
          </div>
        </form>
      ) : null}

      <div className="restaurant-riders-list">
        {riders.map((rider) => (
          <article className="restaurant-rider-card" key={rider.id}>
            <div className="restaurant-rider-avatar" aria-hidden="true">{rider.name.charAt(0).toUpperCase()}</div>
            <div className="restaurant-rider-details">
              <div className="restaurant-rider-name-row">
                <h2>{rider.name}</h2>
                <span className={`restaurant-rider-status restaurant-rider-status-${rider.status.toLowerCase()}`}>
                  {rider.status}
                </span>
              </div>
              <p>{rider.mobileNumber}</p>
              <p>{rider.email}</p>
              <div className="restaurant-rider-scope">
                <span>Delivery scope</span>
                <strong>{rider.scopes.length ? rider.scopes.join(' · ') : 'Not assigned'}</strong>
              </div>
            </div>
            <div className="restaurant-rider-actions">
              <button className="button button-secondary" type="button">Edit</button>
              <button className="button button-secondary" type="button" onClick={() => toggleRiderStatus(rider.id)}>
                {rider.status === 'Offline' ? 'Activate' : 'Set Offline'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
