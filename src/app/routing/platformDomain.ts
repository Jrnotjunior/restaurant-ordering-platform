export const PARENT_SAAS_HOSTNAME = 'app.web2table.io';

export function isParentSaaSDomain(hostname: string): boolean {
  return hostname.trim().toLowerCase() === PARENT_SAAS_HOSTNAME;
}
