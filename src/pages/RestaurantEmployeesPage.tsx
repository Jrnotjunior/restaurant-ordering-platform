import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseGet } from '../services/supabaseClient';

type StaffRole = 'cashier' | 'kitchen' | 'dispatcher' | 'rider';

type RiderAccount = {
  id: string;
  name: string;
  mobileNumber: string;
  email: string;
  isActive: boolean;
};

type StaffAccount = {
  id: string;
  name: string;
  preferredName: string;
  mobileNumber: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
};

type StaffRow = {
  id: string;
  name: string;
  preferred_name: string | null;
  mobile_number: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
};

type RiderRow = {
  id: string;
  name: string;
  mobile_number: string;
  email: string | null;
  is_active: boolean;
};

const roleLabels: Record<StaffRole, string> = {
  cashier: 'Cashier',
  kitchen: 'Kitchen',
  dispatcher: 'Dispatcher',
  rider: 'Rider',
};

export function RestaurantEmployeesPage({ restaurantId }: { restaurantId: string }) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');

  async function loadStaff() {
    setLoading(true);
    setError('');
    try {
      const rows = await supabaseGet<StaffRow>('restaurant_staff', {
        select: 'id,name,preferred_name,mobile_number,email,role,is_active',
        restaurant_id: `eq.${restaurantId}`,
        order: 'created_at.asc',
      });
      setStaff(rows.map((row) => ({
        id: row.id,
        name: row.name,
        preferredName: row.preferred_name || row.name,
        mobileNumber: row.mobile_number,
        email: row.email,
        role: row.role,
        isActive: row.is_active,
      })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load employees.');
    } finally {
      setLoading(false);
    }
  }

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') || '').trim();
    const preferredName = String(form.get('preferredName') || '').trim();
    const mobileNumber = String(form.get('mobileNumber') || '').trim();
    const email = String(form.get('email') || '').trim();
    const role = String(form.get('role') || 'cashier') as StaffRole;

    setSaving(true);
    setError('');

    try {
      const { data, error: functionError } = await supabase.functions.invoke('create-staff', {
        body: { restaurantId, name, preferredName, mobileNumber, email, role },
      });

      if (functionError) {
        let message = functionError.message || 'Unable to create employee account.';
        if (functionError.context instanceof Response) {
          try {
            const payload = await functionError.context.clone().json();
            if (payload?.error) message = payload.error;
          } catch {}
        }
        throw new Error(message);
      }

      if (!data?.staff?.auth_user_id) throw new Error('Employee was created, but the Auth account was not linked.');

      formElement.reset();
      setShowForm(false);
      await loadStaff();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add employee.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editingStaff) return;

    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const mobileNumber = String(form.get('mobileNumber') || '').trim();
    const preferredName = String(form.get('preferredName') || '').trim();

    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('restaurant_staff')
        .update({ name, preferred_name: preferredName, mobile_number: mobileNumber })
        .eq('id', editingStaff.id)
        .eq('restaurant_id', restaurantId);

      if (updateError) throw updateError;

      if (editingStaff.role === 'rider') {
        const { error: riderUpdateError } = await supabase
          .from('restaurant_riders')
          .update({ name, mobile_number: mobileNumber })
          .eq('restaurant_id', restaurantId)
          .ilike('email', editingStaff.email);
        if (riderUpdateError) throw riderUpdateError;
      }

      setEditingStaff(null);
      await loadStaff();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update employee.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(employee: StaffAccount) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('restaurant_staff')
        .update({ is_active: !employee.isActive })
        .eq('id', employee.id)
        .eq('restaurant_id', restaurantId);

      if (updateError) throw updateError;

      if (employee.role === 'rider') {
        const { error: riderUpdateError } = await supabase
          .from('restaurant_riders')
          .update({ is_active: !employee.isActive })
          .eq('restaurant_id', restaurantId)
          .ilike('email', employee.email);
        if (riderUpdateError) throw riderUpdateError;
      }

      await loadStaff();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update employee status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="restaurant-employees-page">
      <div className="restaurant-employees-card">
        <div className="restaurant-employees-card-header">
          <div>
            <h1>Employees</h1>
            <p>Manage your restaurant employees and their access to the management system.</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => setShowForm((current) => !current)}>
            {showForm ? 'Close' : 'Add Employee'}
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

        {showForm ? (
          <form className="restaurant-employee-form" onSubmit={(event) => void handleSubmit(event)}>
            <div className="restaurant-employee-form-heading">
              <div><p className="eyebrow">New employee</p><h2>Add employee</h2></div>
              <p>Kitchen and Dispatcher are shared accounts. Rider accounts are also created through this employee invitation flow.</p>
            </div>
            <div className="restaurant-employee-form-grid">
              <label>Full name<input name="name" type="text" placeholder="e.g. Juan Dela Cruz" required /></label>
              <label>Preferred name<input name="preferredName" type="text" placeholder="e.g. Juan" required /></label>
              <label>Mobile number<input name="mobileNumber" type="tel" placeholder="09XX XXX XXXX" required /></label>
              <label>Login email<input name="email" type="email" placeholder="employee@example.com" required /></label>
              <label>Role<select name="role" defaultValue="cashier"><option value="cashier">Cashier</option><option value="kitchen">Kitchen</option><option value="dispatcher">Dispatcher</option><option value="rider">Rider</option></select></label>
            </div>
            <p className="restaurant-employee-form-help">A Supabase Auth account is created automatically and an invitation email is sent so the employee can set a password.</p>
            <div className="restaurant-employee-form-actions">
              <button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Add Employee'}</button>
            </div>
          </form>
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
                  <button className="button button-secondary" type="button" onClick={() => setEditingStaff(employee)} disabled={saving}>Edit</button>
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
                <label>Mobile number<input name="mobileNumber" type="tel" defaultValue={editingStaff.mobileNumber} required /></label>
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
