import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { supabase } from '../lib/db.js';
import type { Env } from '../types/index.js';

const keys = new Hono<Env>();

keys.post('/', async (c) => {
  const accountId = c.get('account_id');
  const body = await c.req.json<{ name?: string; is_test?: boolean }>();

  // Generate a raw API key: pbapi_ + 40 random hex chars
  const rawKey = 'pbapi_' + randomBytes(20).toString('hex');
  const prefix = rawKey.slice(0, 8);
  const hash = await bcrypt.hash(rawKey, 10);

  const { data: key, error } = await supabase
    .from('api_keys')
    .insert({
      key_hash: hash,
      key_prefix: prefix,
      account_id: accountId,
      name: body.name || null,
      is_test: body.is_test || false,
    })
    .select('id, key_prefix, name, is_test, created_at')
    .single();

  if (error) {
    console.error('[keys] insert error:', error);
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Failed to create API key',
          request_id: c.get('request_id'),
        },
      },
      500
    );
  }

  // Return the raw key only on creation — it won't be shown again
  return c.json(
    {
      key_id: key.id,
      key: rawKey,
      key_prefix: key.key_prefix,
      name: key.name,
      is_test: key.is_test,
      created_at: key.created_at,
    },
    201
  );
});

keys.delete('/:id', async (c) => {
  const accountId = c.get('account_id');
  const keyId = c.req.param('id');

  const { data, error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('account_id', accountId)
    .is('revoked_at', null)
    .select('id')
    .single();

  if (!data) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found or already revoked',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  return c.json({ deleted: true, key_id: data.id });
});

export default keys;
