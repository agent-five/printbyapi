import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import { supabase } from '../lib/db.js';
import type { Env } from '../types/index.js';

const webhooks = new Hono<Env>();

webhooks.put('/', async (c) => {
  const accountId = c.get('account_id');
  const body = await c.req.json<{ url: string }>();

  if (!body.url) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'url is required',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Validate URL is HTTPS
  try {
    const parsed = new URL(body.url);
    if (parsed.protocol !== 'https:') {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Webhook URL must use HTTPS',
            request_id: c.get('request_id'),
          },
        },
        400
      );
    }
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid URL',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  const secret = randomBytes(32).toString('hex');

  // Check if a webhook already exists for this account
  const { data: existing } = await supabase
    .from('webhooks')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .single();

  let webhook;

  if (existing) {
    // Update existing webhook
    const { data, error } = await supabase
      .from('webhooks')
      .update({ url: body.url, secret, is_active: true })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('[webhooks] update error:', error);
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Failed to update webhook',
            request_id: c.get('request_id'),
          },
        },
        500
      );
    }

    webhook = data;
  } else {
    // Create new webhook
    const { data, error } = await supabase
      .from('webhooks')
      .insert({
        account_id: accountId,
        url: body.url,
        secret,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('[webhooks] insert error:', error);
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Failed to create webhook',
            request_id: c.get('request_id'),
          },
        },
        500
      );
    }

    webhook = data;
  }

  return c.json({
    webhook_id: webhook.id,
    url: webhook.url,
    secret: webhook.secret,
  });
});

webhooks.get('/', async (c) => {
  const accountId = c.get('account_id');

  const { data } = await supabase
    .from('webhooks')
    .select('id, url, is_active, created_at')
    .eq('account_id', accountId)
    .eq('is_active', true);

  return c.json({
    webhooks: (data || []).map((w) => ({
      webhook_id: w.id,
      url: w.url,
      is_active: w.is_active,
      created_at: w.created_at,
    })),
  });
});

export default webhooks;
