import { Hono } from 'hono';
import { supabase } from '../lib/db.js';
import { calculateQuote } from '../lib/pricing.js';
import { formatId, resolveFileId, resolveQuoteId } from '../lib/ids.js';
import type { Env, Material, ShipTo } from '../types/index.js';

const VALID_MATERIALS: Material[] = ['pla', 'petg', 'abs', 'resin'];
const QUOTE_TTL_MINUTES = 15;

const quotes = new Hono<Env>();

quotes.post('/', async (c) => {
  const accountId = c.get('account_id');
  const body = await c.req.json<{
    file_id: string;
    ship_to: ShipTo;
    material?: Material;
    color?: string;
    quality?: string;
    quantity?: number;
  }>();

  // Validate required fields
  if (!body.file_id) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'file_id is required',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  if (!body.ship_to || !body.ship_to.name || !body.ship_to.address || !body.ship_to.city || !body.ship_to.state || !body.ship_to.zip || !body.ship_to.country) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'ship_to must include name, address, city, state, zip, and country',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  const material = body.material || 'pla';
  if (!VALID_MATERIALS.includes(material)) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: `Invalid material "${material}". Supported: ${VALID_MATERIALS.join(', ')}`,
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  const quantity = body.quantity || 1;
  if (quantity < 1 || quantity > 100) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Quantity must be between 1 and 100',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Resolve file_id (accept display ID or full UUID)
  const fileId = await resolveFileId(body.file_id, accountId);
  if (!fileId) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'File not found or does not belong to this account',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  // Look up file — verify it belongs to this account
  const { data: file } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .eq('account_id', accountId)
    .single();

  if (!file) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'File not found or does not belong to this account',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  if (!file.volume_cm3) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'File has no volume data. Only STL files with valid geometry can be quoted.',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Calculate pricing
  const pricing = calculateQuote(file.volume_cm3, material, quantity);

  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60 * 1000).toISOString();

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      account_id: accountId,
      file_id: file.id,
      material,
      color: body.color || 'white',
      quality: body.quality || 'standard',
      quantity,
      ship_to: body.ship_to,
      print_price_usd: pricing.print_price_usd,
      shipping_price_usd: pricing.shipping_price_usd,
      order_fee_usd: pricing.order_fee_usd,
      total_usd: pricing.total_usd,
      estimated_days: pricing.estimated_days,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    console.error('[quotes] insert error:', error);
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Failed to create quote',
          request_id: c.get('request_id'),
        },
      },
      500
    );
  }

  return c.json(
    {
      quote_id: formatId(quote.id, 'quote'),
      file_id: formatId(file.id, 'file'),
      material: quote.material,
      color: quote.color,
      quality: quote.quality,
      quantity: quote.quantity,
      print_price_usd: Number(quote.print_price_usd),
      shipping_price_usd: Number(quote.shipping_price_usd),
      order_fee_usd: Number(quote.order_fee_usd),
      total_usd: Number(quote.total_usd),
      estimated_days: quote.estimated_days,
      expires_at: quote.expires_at,
      created_at: quote.created_at,
    },
    201
  );
});

quotes.get('/:id', async (c) => {
  const accountId = c.get('account_id');
  const quoteId = await resolveQuoteId(c.req.param('id'), accountId);

  if (!quoteId) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Quote not found',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  const { data: quote } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('account_id', accountId)
    .single();

  if (!quote) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Quote not found',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  const expired = new Date(quote.expires_at) < new Date();

  return c.json({
    quote_id: formatId(quote.id, 'quote'),
    file_id: formatId(quote.file_id, 'file'),
    material: quote.material,
    color: quote.color,
    quality: quote.quality,
    quantity: quote.quantity,
    ship_to: quote.ship_to,
    print_price_usd: Number(quote.print_price_usd),
    shipping_price_usd: Number(quote.shipping_price_usd),
    order_fee_usd: Number(quote.order_fee_usd),
    total_usd: Number(quote.total_usd),
    estimated_days: quote.estimated_days,
    expires_at: quote.expires_at,
    expired,
    created_at: quote.created_at,
  });
});

export default quotes;
