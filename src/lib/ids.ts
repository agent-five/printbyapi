import { supabase } from './db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPLAY_ID_RE = /^[a-z]+_([0-9a-f]{8})$/i;

export function formatId(uuid: string, prefix: string): string {
  return prefix + '_' + uuid.replace(/-/g, '').slice(-8);
}

async function resolveId(
  displayOrUuid: string,
  table: string,
  accountId?: string
): Promise<string | null> {
  // Full UUID — use as-is
  if (UUID_RE.test(displayOrUuid)) {
    return displayOrUuid;
  }

  // Display ID — extract suffix and look up
  const match = displayOrUuid.match(DISPLAY_ID_RE);
  if (!match) return null;

  const suffix = match[1].toLowerCase();

  let query = supabase
    .from(table)
    .select('id')
    .filter('id::text', 'ilike', `%${suffix}`);

  if (accountId) {
    query = query.eq('account_id', accountId);
  }

  const { data } = await query.limit(1).single();
  return data?.id ?? null;
}

export async function resolveFileId(
  displayOrUuid: string,
  accountId: string
): Promise<string | null> {
  return resolveId(displayOrUuid, 'files', accountId);
}

export async function resolveQuoteId(
  displayOrUuid: string,
  accountId: string
): Promise<string | null> {
  return resolveId(displayOrUuid, 'quotes', accountId);
}

export async function resolveOrderId(
  displayOrUuid: string,
  accountId?: string
): Promise<string | null> {
  return resolveId(displayOrUuid, 'orders', accountId);
}
