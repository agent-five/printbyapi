import { createMiddleware } from 'hono/factory';
import bcrypt from 'bcrypt';
import { supabase } from '../lib/db.js';
import type { Env } from '../types/index.js';

export const auth = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header. Expected: Bearer <api_key>',
          request_id: c.get('request_id'),
        },
      },
      401
    );
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key is empty',
          request_id: c.get('request_id'),
        },
      },
      401
    );
  }

  const prefix = apiKey.slice(0, 8);

  // Find candidate keys by prefix to avoid hashing against every key
  const { data: candidates } = await supabase
    .from('api_keys')
    .select('id, key_hash, account_id, revoked_at')
    .eq('key_prefix', prefix)
    .is('revoked_at', null);

  if (!candidates || candidates.length === 0) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
          request_id: c.get('request_id'),
        },
      },
      401
    );
  }

  // Check each candidate's hash
  let matchedKey: (typeof candidates)[0] | null = null;
  for (const candidate of candidates) {
    const valid = await bcrypt.compare(apiKey, candidate.key_hash);
    if (valid) {
      matchedKey = candidate;
      break;
    }
  }

  if (!matchedKey) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
          request_id: c.get('request_id'),
        },
      },
      401
    );
  }

  // Update last_used_at (fire and forget)
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matchedKey.id)
    .then();

  c.set('account_id', matchedKey.account_id);
  await next();
});
