import { FormEvent, useState } from 'react';

type RiderAccount = {
  id: string;
  name: string;
  mobileNumber: string;
  email: string;
  status: 'Active' | 'Inactive';
};

const sampleRiders: RiderAccount[] = [
  { id: 'rider-1', name: 'John Santos', mobileNumber: '0917 123 4567', email: 'john.santos@example.com', status: 'Active' },
  { id: 'rider-2', name: 'Mark Dela Cruz', mobileNumber: '0918 234 5678', email: 'mark.delacruz@example.com', status: 'Active' },
];

export function RestaurantRidersPage() {
  const [riders, setRiders] = useState<RiderAccount[]>(sampleRiders);
  const [showForm, setShowForm] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rider: RiderAccount = {
      id: 'preview-' + Date.now(),
      name: String(form.get('name') || 'New Rider'),
      mobileNumber: String(form.get('mobileNumber') || ''),
      email: String(form.get('email') || ''),
      status: 'Active',
    };
    setRiders((current) => [...current, rider]);
    event.currentTarget.reset();
    setShowForm(false);
  }

  return (
    <section className="restaurant-riders-page">
      <div className="restaurant-riders-header">
        <div>
          <p className="eyebrow">Delivery team</p>
          <h1>Riders</h1>
          <p>Create and manage the riders who deliver orders for this restaurant.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setShowForm((current) => !current)}>
          {showForm ? 'Close' : 'Add Rider'}
        </button>
      </div>

      <div className="restaurant-riders-preview-note" role="note">
        <strong>UI preview</strong>
        <span>Rider accounts are not connected to Supabase yet. Adding a rider here only updates this page temporarily.</span>
      </div>

      {showForm ? (
        <form className="restaurant-rider-form" onSubmit={handleSubmit}>
          <div className="restaurant-rider-form-heading">
            <div>
              <p className="eyebrow">New rider</p>
              <h2>Create rider account</h2>
            </div>
            <p>The restaurant owner creates the account. Riders do not register themselves.</p>
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
              Temporary password
              <input name="password" type="password" placeholder="Temporary password" required minLength={8} />
            </label>
          </div>

          <div className="restaurant-rider-form-actions">
            <button className="button button-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="button button-primary" type="submit">Create Rider</button>
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
                <span className="restaurant-rider-status">{rider.status}</span>
              </div>
              <p>{rider.email}</p>
              <p>{rider.mobileNumber}</p>
            </div>
            <div className="restaurant-rider-actions">
              <button className="button button-secondary" type="button">Edit</button>
              <button className="button button-secondary" type="button">Deactivate</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
