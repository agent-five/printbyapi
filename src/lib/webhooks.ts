import { createHmac } from 'crypto';
import { supabase } from './db.js';

interface WebhookPayload {
  event: string;
  order_id: string;
  status: string;
  timestamp: string;
}

/**
 * Dispatch a webhook event to all active webhooks for the given account.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s).
 * Runs async — does not block the main response.
 */
export function dispatchWebhook(accountId: string, payload: WebhookPayload): void {
  // Fire and forget — don't block the response
  dispatchAsync(accountId, payload).catch((err) => {
    console.error('[webhook] dispatch failed:', err);
  });
}

async function dispatchAsync(accountId: string, payload: WebhookPayload): Promise<void> {
  const { data: webhooks } = await supabase
    .from('webhooks')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true);

  if (!webhooks || webhooks.length === 0) return;

  const body = JSON.stringify(payload);

  for (const webhook of webhooks) {
    const signature = sign(body, webhook.secret);
    await deliverWithRetry(webhook.url, body, signature);
  }
}

function sign(body: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  return 'sha256=' + hmac.digest('hex');
}

async function deliverWithRetry(url: string, body: string, signature: string): Promise<void> {
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PrintByAPI-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        console.log(`[webhook] delivered to ${url} (attempt ${attempt + 1})`);
        return;
      }

      console.warn(`[webhook] ${url} returned ${res.status} (attempt ${attempt + 1})`);
    } catch (err) {
      console.warn(`[webhook] ${url} failed (attempt ${attempt + 1}):`, err);
    }

    if (attempt < 3) {
      await sleep(delays[attempt]);
    }
  }

  console.error(`[webhook] gave up delivering to ${url} after 4 attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
