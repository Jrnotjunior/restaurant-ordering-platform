import { supabase, supabaseGet } from '../../services/supabaseClient';

export type StaffRole = 'cashier' | 'kitchen' | 'dispatcher' | 'rider';

export type StaffAccount = {
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

export const roleLabels: Record<StaffRole, string> = {
  cashier: 'Cashier',
  kitchen: 'Kitchen',
  dispatcher: 'Dispatcher',
  rider: 'Rider',
};

export function validatePhilippineMobileNumber(value: string) {
  return /^09\d{9}$/.test(value);
}

export async function getEmployees(restaurantId: string): Promise<StaffAccount[]> {
  const rows = await supabaseGet<StaffRow>('restaurant_staff', {
    select: 'id,name,preferred_name,mobile_number,email,role,is_active',
    restaurant_id: `eq.${restaurantId}`,
    order: 'created_at.asc',
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    preferredName: row.preferred_name || row.name,
    mobileNumber: row.mobile_number,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
  }));
}

export async function createEmployee(
  restaurantId: string,
  values: { name: string; preferredName: string; mobileNumber: string; email: string; role: StaffRole },
) {
  if (!validatePhilippineMobileNumber(values.mobileNumber)) throw new Error('Mobile number must start with 09 and contain exactly 11 digits.');
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error: functionError } = await supabase.functions.invoke('create-staff', {
    body: { restaurantId, ...values },
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

  if (!data?.staff?.auth_user_id) {
    throw new Error('Employee was created, but the Auth account was not linked.');
  }
}

export async function updateEmployee(
  restaurantId: string,
  employeeId: string,
  values: { name: string; preferredName: string; mobileNumber: string },
) {
  if (!validatePhilippineMobileNumber(values.mobileNumber)) throw new Error('Mobile number must start with 09 and contain exactly 11 digits.');
  if (!supabase) throw new Error('Supabase is not configured.');

  const { error } = await supabase
    .from('restaurant_staff')
    .update({
      name: values.name,
      preferred_name: values.preferredName,
      mobile_number: values.mobileNumber,
    })
    .eq('id', employeeId)
    .eq('restaurant_id', restaurantId);

  if (error) throw error;
}

export async function setEmployeeActive(
  restaurantId: string,
  employee: StaffAccount,
  isActive: boolean,
) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { error } = await supabase
    .from('restaurant_staff')
    .update({ is_active: isActive })
    .eq('id', employee.id)
    .eq('restaurant_id', restaurantId);

  if (error) throw error;
}
