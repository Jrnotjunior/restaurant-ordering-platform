import { useEffect, useState } from 'react';
import { deleteMyCustomerAddress, getMyCustomerAddresses, saveMyCustomerAddress, setMyCustomerAddressDefault, updateMyCustomerAddress, type CustomerSavedAddress } from '../modules/customer/customerAccountService';
import { useRestaurant } from '../components/RestaurantProvider';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import '../styles/saved-address.css';

export function SavedAddressPage() {
  const restaurant = useRestaurant();
  const { user } = useRestaurantOwnerAuth();
  const [addresses, setAddresses] = useState<CustomerSavedAddress[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [city, setCity] = useState('');
  const [barangay, setBarangay] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAddressId, setBusyAddressId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleteAddressId, setDeleteAddressId] = useState<string | null>(null);

  function closeForm() {
    setShowForm(false);
    setEditingAddressId(null);
    setError('');
  }

  async function loadAddresses() {
    if (!user || !restaurant.id) {
      setError('Please sign in to manage your saved addresses.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const savedAddresses = await getMyCustomerAddresses(restaurant.id);
      setAddresses(savedAddresses);
    } catch (loadError) {
      console.error('Unable to load saved addresses.', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load your saved addresses.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAddresses(); }, [restaurant.id, user?.id]);


  function openEditForm(item: CustomerSavedAddress) {
    setEditingAddressId(item.id);
    setLabel(item.label);
    setCity(item.city);
    setBarangay(item.barangay);
    setAddress(item.address);
    setMessage('');
    setError('');
    setShowForm(true);
  }

  function openAddForm() {
    setEditingAddressId(null);
    setLabel('');
    setCity('');
    setBarangay('');
    setAddress('');
    setMessage('');
    setError('');
    setShowForm(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    const trimmedLabel = label.trim() || 'Address';
    const trimmedCity = city.trim();
    const trimmedBarangay = barangay.trim();
    const trimmedAddress = address.trim();

    if (!trimmedCity || !trimmedBarangay || !trimmedAddress) {
      setError('Please complete your city, barangay, and unit/building/street address.');
      return;
    }
    setSaving(true);
    try {
      if (editingAddressId) {
        await updateMyCustomerAddress(restaurant.id!, editingAddressId, trimmedLabel, trimmedCity, trimmedBarangay, trimmedAddress);
      } else {
        await saveMyCustomerAddress(restaurant.id!, trimmedLabel, trimmedCity, trimmedBarangay, trimmedAddress, addresses.length === 0);
      }
      setShowForm(false);
      setEditingAddressId(null);
      setMessage(editingAddressId ? 'Address updated.' : (addresses.length === 0 ? 'Address saved and set as your default.' : 'Address saved.'));
      await loadAddresses();
    } catch (saveError) {
      console.error('Unable to save address.', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save your address.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(addressId: string) {
    setBusyAddressId(addressId);
    setMessage('');
    setError('');
    try {
      await setMyCustomerAddressDefault(restaurant.id!, addressId);
      setMessage('Default address updated.');
      await loadAddresses();
    } catch (defaultError) {
      console.error('Unable to set default address.', defaultError);
      setError(defaultError instanceof Error ? defaultError.message : 'Unable to set the default address.');
    } finally {
      setBusyAddressId(null);
    }
  }

  function openDeleteConfirmation(addressId: string) {
    setDeleteAddressId(addressId);
  }

  async function handleDelete() {
    if (!deleteAddressId) return;
    const addressId = deleteAddressId;
    setDeleteAddressId(null);
    setBusyAddressId(addressId);
    setMessage('');
    setError('');
    try {
      await deleteMyCustomerAddress(restaurant.id!, addressId);
      setMessage('Address deleted.');
      await loadAddresses();
    } catch (deleteError) {
      console.error('Unable to delete address.', deleteError);
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete the address.');
    } finally {
      setBusyAddressId(null);
    }
  }

  return (
    <section className="saved-address-page">
      <div className="saved-address-card">
        <a className="saved-address-back" href={import.meta.env.BASE_URL}>← Back to menu</a>
        <p className="eyebrow">Customer account</p>
        <h1>Saved addresses</h1>
        <p className="saved-address-intro">Save multiple delivery addresses and choose which one checkout should use by default.</p>

        {loading ? <div className="saved-address-loading">Loading your saved addresses…</div> : <>
          {addresses.map((item) => (
            <article className={`saved-address-item${item.isDefault ? ' is-default' : ''}`} key={item.id}>
              <div className="saved-address-item-header">
                <div className="saved-address-title"><strong>{item.label}</strong>{item.isDefault ? <span className="saved-address-default-badge">Default</span> : null}</div>
                <div className="saved-address-item-actions"><button className="saved-address-edit" type="button" onClick={() => openEditForm(item)} disabled={busyAddressId === item.id}>Edit</button><button className="saved-address-delete" type="button" onClick={() => openDeleteConfirmation(item.id)} disabled={busyAddressId === item.id}>Delete</button></div>
              </div>
              <p>{item.address}</p>
              <span>{item.barangay}, {item.city}</span>
              {!item.isDefault ? <button className="saved-address-default-button" type="button" onClick={() => void handleSetDefault(item.id)} disabled={busyAddressId === item.id}>{busyAddressId === item.id ? 'Updating…' : 'Set as default'}</button> : null}
            </article>
          ))}

          {addresses.length === 0 ? <p className="saved-address-empty">You don't have any saved addresses yet.</p> : null}
          {addresses.length >= 2 && !showForm ? <p className="saved-address-limit">You can save up to 2 addresses.</p> : null}
          {error ? <p className="saved-address-error" role="alert">{error}</p> : null}
          {message ? <p className="saved-address-success" role="status">{message}</p> : null}

          {!showForm ? <button className="button button-primary saved-address-add-button" type="button" onClick={openAddForm} disabled={addresses.length >= 2}>+ Add address</button> : (
            <div className="saved-address-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}><form className="saved-address-form saved-address-modal" onSubmit={handleSave}>
              <div className="saved-address-form-heading"><h2>{editingAddressId ? 'Edit address' : 'Add address'}</h2><button type="button" className="saved-address-cancel" onClick={closeForm}>Cancel</button></div>
              <label><span>Address name</span><input type="text" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Home, Work, School" /></label>
              <label><span>City</span><input type="text" value={city} onChange={(event) => { setCity(event.target.value); setBarangay(''); setMessage(''); setError(''); }} autoComplete="address-level2" required /></label>
              <label><span>Barangay</span><input type="text" value={barangay} onChange={(event) => { setBarangay(event.target.value); setMessage(''); setError(''); }} autoComplete="address-level3" required /></label>
              <label><span>Unit/Bldg./Street Address</span><textarea value={address} onChange={(event) => { setAddress(event.target.value); setMessage(''); setError(''); }} placeholder="Enter your unit, building, house number, and street" rows={4} required /></label>
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editingAddressId ? 'Save Changes' : 'Save Address'}</button>
            </form></div>
          )}
        </>}

        {deleteAddressId ? (
          <div
            className="saved-address-confirm-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDeleteAddressId(null);
            }}
          >
            <div
              className="saved-address-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-address-title"
            >
              <div className="saved-address-confirm-icon" aria-hidden="true">!</div>
              <h2 id="delete-address-title">Delete saved address?</h2>
              <p>This address will be permanently removed from your saved addresses.</p>
              <div className="saved-address-confirm-actions">
                <button
                  type="button"
                  className="saved-address-confirm-cancel"
                  onClick={() => setDeleteAddressId(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="saved-address-confirm-delete"
                  onClick={() => void handleDelete()}
                  disabled={busyAddressId === deleteAddressId}
                >
                  {busyAddressId === deleteAddressId ? 'Deleting…' : 'Delete address'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
