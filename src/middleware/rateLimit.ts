import { createMiddleware } from 'hono/factory';
import { supabase } from '../lib/db.js';
import type { Env } from '../types/index.js';

const TIER_LIMITS: Record<string, number> = {
  free: 10,
  growth: 60,
  scale: 300,
  enterprise: 1000,
};

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory rate limit store (per account_id)
const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000; // 1 minute

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      store.delete(key);
    }
  }
}, 300_000);

export const rateLimit = createMiddleware<Env>(async (c, next) => {
  const accountId = c.get('account_id');
  if (!accountId) {
    await next();
    return;
  }

  // Look up account tier
  const { data: account } = await supabase
    .from('accounts')
    .select('tier')
    .eq('id', accountId)
    .single();

  const tier = account?.tier || 'free';
  const limit = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const now = Date.now();

  let entry = store.get(accountId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    store.set(accountId, entry);
  }

  entry.count++;

  // Set rate limit headers
  c.header('X-RateLimit-Limit', String(limit));
  c.header('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
  c.header('X-RateLimit-Reset', String(Math.ceil((entry.windowStart + WINDOW_MS) / 1000)));

  if (entry.count > limit) {
    return c.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. ${tier} tier allows ${limit} requests per minute.`,
          request_id: c.get('request_id'),
        },
      },
      429
    );
  }

  await next();
});
