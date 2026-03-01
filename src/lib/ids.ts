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
  if (UUID_RE.test(displayOrUuid)) {
    return displayOrUuid;
  }

  const match = displayOrUuid.match(DISPLAY_ID_RE);
  if (!match) return null;
  const suffix = match[1].toLowerCase();

  // PostgREST doesn't support casts in filter column names, so fetch
  // IDs for this account and match suffix in JS. Fine for MVP scale.
  let query = (supabase as any).from(table).select('id');
  if (accountId) {
    query = query.eq('account_id', accountId);
  }

  const { data } = await query;
  if (!data) return null;

  const row = (data as Array<{ id: string }>).find((r) =>
    r.id.replace(/-/g, '').endsWith(suffix)
  );
  return row?.id ?? null;
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
