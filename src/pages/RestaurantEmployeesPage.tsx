import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createEmployee,
  getEmployees,
  roleLabels,
  setEmployeeActive,
  updateEmployee,
  type StaffAccount,
  type StaffRole,
} from '../modules/employees/employeeService';
import { useOwnerUnsavedChanges } from '../contexts/OwnerUnsavedChangesContext';
import { useOwnerUnsavedChangesTracking } from '../hooks/useOwnerUnsavedChangesTracking';

export function RestaurantEmployeesPage({ restaurantId }: { restaurantId: string }) {
  const { setUnsavedChanges } = useOwnerUnsavedChanges();
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');

  async function loadStaff() {
    setLoading(true);
    setError('');
    try {
      setStaff(await getEmployees(restaurantId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load employees.');
    } finally {
      setLoading(false);
    }
  }

  useOwnerUnsavedChangesTracking('.restaurant-employees-page');

  useEffect(() => { void loadStaff(); }, [restaurantId]);

  const filteredStaff = useMemo(() => {
    const query = searchEmployee.trim().toLowerCase();
    if (!query) return staff;
    return staff.filter((employee) =>
      employee.name.toLowerCase().includes(query)
      || employee.preferredName.toLowerCase().includes(query)
      || employee.mobileNumber.toLowerCase().includes(query)
      || employee.email.toLowerCase().includes(query)
      || roleLabels[employee.role].toLowerCase().includes(query)
    );
  }, [staff, searchEmployee]);

  function normalizeMobileNumber(value: string) {
    return value.replace(/\D/g, '').slice(0, 11);
  }

  function validateMobileNumber(value: string) {
    return /^09\d{9}$/.test(value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') || '').trim();
    const preferredName = String(form.get('preferredName') || '').trim();
    const mobileNumber = normalizeMobileNumber(String(form.get('mobileNumber') || ''));
    const email = String(form.get('email') || '').trim();
    const role = String(form.get('role') || 'cashier') as StaffRole;

    if (!validateMobileNumber(mobileNumber)) {
      setError('Mobile number must start with 09 and contain exactly 11 digits.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await createEmployee(restaurantId, { name, preferredName, mobileNumber, email, role });
      setUnsavedChanges(false);
      formElement.reset();
      setShowForm(false);
      await loadStaff();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add employee.');
    } finally {
      setSaving(false);
    }
  }

  function openEmployeeEditor(employee: StaffAccount) {
    setEditingStaff(employee);
    setError('');
    setConfirmation('');
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStaff) return;

    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const mobileNumber = String(form.get('mobileNumber') || '').trim();
    const preferredName = String(form.get('preferredName') || '').trim();

    setSaving(true);
    setError('');
    try {
      await updateEmployee(restaurantId, editingStaff.id, { name, preferredName, mobileNumber });
      setUnsavedChanges(false);
      setEditingStaff(null);
      await loadStaff();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update employee.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(employee: StaffAccount) {
    setSaving(true);
    setError('');
    try {
      await setEmployeeActive(restaurantId, employee, !employee.isActive);
      await loadStaff();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update employee status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="restaurant-page restaurant-employees-page">
      <div className="restaurant-employees-card">
        <div className="restaurant-employees-card-header">
          <div>
            <h1>Employees</h1>
            <p>Manage your restaurant employees and their access to the management system.</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => setShowForm(true)}>
            Add Employee
          </button>
        </div>

        <div className="restaurant-employees-search">
          <label htmlFor="restaurant-employee-search">Search employees</label>
          <div className="restaurant-employees-search-input-wrap">
            <input
              id="restaurant-employee-search"
              type="search"
              value={searchEmployee}
              onChange={(event) => setSearchEmployee(event.target.value)}
              placeholder="Search by name, mobile, email, or role"
            />
            {searchEmployee && (
              <button
                type="button"
                className="restaurant-employees-search-clear"
                onClick={() => setSearchEmployee('')}
                aria-label="Clear employee search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="restaurant-employees-count">
          {staff.length} {staff.length === 1 ? 'employee' : 'employees'}
        </div>

        {error ? <div className="restaurant-employees-error" role="alert">{error}</div> : null}
        {confirmation ? <div className="restaurant-employees-success" role="status" aria-live="polite">{confirmation}</div> : null}

        {showForm ? (
          <div
            className="restaurant-employee-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !saving) setShowForm(false);
            }}
          >
          <form className="restaurant-employee-modal restaurant-employee-edit-modal restaurant-employee-form" onSubmit={(event) => void handleSubmit(event)}>
            <div className="restaurant-employee-modal-header">
              <div><p className="eyebrow">New employee</p><h2>Add employee</h2></div>
              <button className="restaurant-employee-modal-close" type="button" onClick={() => setShowForm(false)} disabled={saving} aria-label="Close">×</button>
            </div>
            <div className="restaurant-employee-form-grid">
              <label>Full name<input name="name" type="text"  required /></label>
              <label>Preferred name<input name="preferredName" type="text"  required /></label>
              <label>Role<select name="role" defaultValue="cashier"><option value="cashier">Cashier</option><option value="kitchen">Kitchen</option><option value="dispatcher">Dispatcher</option><option value="rider">Rider</option></select></label>
              <label>Mobile number<input name="mobileNumber" type="tel" inputMode="numeric"  maxLength={11} pattern="^09[0-9]{9}$" onInput={(event) => { event.currentTarget.value = normalizeMobileNumber(event.currentTarget.value); }} required /></label>
              <label className="restaurant-employee-email-field">Login email<input name="email" type="email"  required /></label>
            </div>
            <div className="restaurant-employee-form-actions">
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Add Employee'}</button>
            </div>
          </form>
          </div>
        ) : null}

        <div className="restaurant-employees-list">
          {loading ? <div className="restaurant-employees-empty">Loading employees…</div> : staff.length === 0 ? <div className="restaurant-employees-empty">No employees have been added yet.</div> : filteredStaff.length === 0 ? <div className="restaurant-employees-empty">No employees found for “{searchEmployee}”.</div> : (
            filteredStaff.map((employee) => (
              <article className={`restaurant-employee-card${employee.isActive ? '' : ' is-inactive'}`} key={employee.id}>
                <div className="restaurant-employee-avatar" aria-hidden="true">{employee.name.charAt(0).toUpperCase()}</div>
                <div className="restaurant-employee-details">
                  <div className="restaurant-employee-name-row"><h2>{employee.preferredName}</h2><span className="restaurant-employee-role">{roleLabels[employee.role]}</span></div>
                  <p>{employee.mobileNumber}</p>
                  <p>{employee.email}</p>
                  {!employee.isActive ? <p className="restaurant-employee-status">Inactive</p> : null}
                </div>
                <div className="restaurant-employee-actions">
                  <button className="button button-secondary" type="button" onClick={() => openEmployeeEditor(employee)} disabled={saving}>Edit</button>
                  <button className="button button-secondary" type="button" onClick={() => void toggleActive(employee)} disabled={saving}>
                    {employee.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        {editingStaff ? (
          <div className="restaurant-employee-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setEditingStaff(null);
          }}>
            <form className="restaurant-employee-modal restaurant-employee-edit-modal" onSubmit={(event) => void handleEdit(event)}>
              <div className="restaurant-employee-modal-header"><div><p className="eyebrow">Edit employee</p><h2>Update employee details</h2></div><button className="restaurant-employee-modal-close" type="button" onClick={() => setEditingStaff(null)} disabled={saving} aria-label="Close">×</button></div>
              <div className="restaurant-employee-form-grid">
                <label>Full name<input name="name" type="text" defaultValue={editingStaff.name} required /></label>
                <label>Preferred name<input name="preferredName" type="text" defaultValue={editingStaff.preferredName} required /></label>
                <label>Mobile number<input name="mobileNumber" type="tel" inputMode="numeric" defaultValue={editingStaff.mobileNumber} maxLength={11} pattern="^09[0-9]{9}$" onInput={(event) => { event.currentTarget.value = normalizeMobileNumber(event.currentTarget.value); }} required /></label>
                <label>Role<input value={roleLabels[editingStaff.role]} readOnly /></label>
                <label>Login email<input value={editingStaff.email} readOnly /></label>

              </div>
              <div className="restaurant-employee-modal-actions"><button className="button button-secondary" type="button" onClick={() => setEditingStaff(null)} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button></div>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}
