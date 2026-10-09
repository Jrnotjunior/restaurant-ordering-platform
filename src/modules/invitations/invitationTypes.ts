export type InvitationType = 'tenant_owner' | 'employee_staff';

export type InvitationMetadata = {
  invitation_type?: string | null;
  tenant_invitation_id?: string | null;
  restaurant_id?: string | null;
  role?: string | null;
  name?: string | null;
  mobile_number?: string | null;
};

export function isInvitationType(value: unknown): value is InvitationType {
  return value === 'tenant_owner' || value === 'employee_staff';
}
