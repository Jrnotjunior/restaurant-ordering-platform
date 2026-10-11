# Web2Table invitation email templates

## Owner and staff invitations

Supabase Auth uses one hosted **Invite user** template for all calls to `inviteUserByEmail()`. This template uses the Auth user's metadata to render the appropriate copy:

- `invitation_type = tenant_owner`: System Admin → restaurant owner invitation.
- `invitation_type = employee_staff`: restaurant owner → staff invitation.

The current server functions already set these values in Auth user metadata:
- `supabase/functions/system-admin-invite-tenant/index.ts`
- `supabase/functions/create-staff/index.ts`

The HTML source of truth is `supabase/templates/invite.html`.

## Hosted Supabase setup

Hosted projects do not automatically load this repository file. To activate it, copy the full contents of `supabase/templates/invite.html` into **Supabase Dashboard → Authentication → Email Templates → Invite user → Source**, then set the Subject to the following Go template:

```gotemplate
{{ if eq .Data.invitation_type "tenant_owner" }}You're Invited to Join Web2Table{{ else }}Your Restaurant Has Invited You to Join Web2Table{{ end }}
```

Save the template. Supabase supports Go-template conditionals and `.Data` exposes Auth user metadata. The body preserves the application's existing invitation callback parameters:
`/?invitation=1&token_hash={{ .TokenHash }}&type=invite`.

## Testing checklist

1. Send a tenant-owner invitation from System Admin. Confirm the subject and body say restaurant owner.
2. Send a staff invitation from a restaurant owner's staff-management page. Confirm the subject and body say restaurant team/staff.
3. Confirm both messages have the expected logo and links.
4. Test each invitation link end to end. The owner should reach tenant onboarding; staff should reach staff invitation acceptance.
5. Confirm passwordless email-code sign-in and required TOTP MFA still work for each role.

Do not consider the hosted template updated until it has been pasted into the Supabase dashboard and saved. Repository changes alone do not update hosted Auth templates.
