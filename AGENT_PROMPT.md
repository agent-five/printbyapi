Build the MVP backend for PrintByAPI — an API-first 3D print fulfillment service for autonomous AI agents.

## Stack
- TypeScript + Hono (web framework)
- Supabase (PostgreSQL + auth)
- Cloudflare R2 (file storage, but use local filesystem for now)
- Stripe (payments, stub it out with TODO comments)
- Deployed to Railway (configure later)

## Project Structure
```
printbyapi/
  src/
    index.ts          # Hono app entry point
    routes/
      files.ts        # POST /v1/files
      quotes.ts       # POST /v1/quotes, GET /v1/quotes/:id
      orders.ts       # POST /v1/orders, GET /v1/orders, GET /v1/orders/:id
      webhooks.ts     # PUT /v1/webhooks, GET /v1/webhooks
      keys.ts         # POST /v1/keys, DELETE /v1/keys/:id (API key management)
    middleware/
      auth.ts         # API key authentication
      rateLimit.ts    # Per-key rate limiting (in-memory for MVP)
    lib/
      db.ts           # Supabase client
      pricing.ts      # Quote pricing formula (volume-based)
      geometry.ts     # STL file parser — extract volume/bounding box
      webhooks.ts     # Webhook dispatcher with retry
      stripe.ts       # Stripe stub (TODOs)
    types/
      index.ts        # Shared TypeScript types
  supabase/
    migrations/
      001_initial.sql # Full schema
  package.json
  tsconfig.json
  .env.example
  README.md
```

## Database Schema (Supabase/PostgreSQL)

```sql
-- API Keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,  -- bcrypt hash
  key_prefix TEXT NOT NULL,       -- first 8 chars for display
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT,
  is_test BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  tier TEXT DEFAULT 'free',  -- free | growth | scale | enterprise
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Files (uploaded 3D models)
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,  -- R2/S3 key
  size_bytes BIGINT,
  format TEXT,  -- stl | obj | 3mf
  volume_cm3 FLOAT,  -- extracted from geometry
  bounding_box JSONB,  -- {x, y, z} in mm
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quotes
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  file_id UUID NOT NULL REFERENCES files(id),
  material TEXT DEFAULT 'pla',
  color TEXT DEFAULT 'white',
  quality TEXT DEFAULT 'standard',
  quantity INTEGER DEFAULT 1,
  ship_to JSONB NOT NULL,  -- {name, address, city, state, zip, country}
  print_price_usd NUMERIC(10,2),
  shipping_price_usd NUMERIC(10,2),
  order_fee_usd NUMERIC(10,2) DEFAULT 1.00,
  total_usd NUMERIC(10,2),
  estimated_days INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  quote_id UUID NOT NULL REFERENCES quotes(id),
  idempotency_key TEXT UNIQUE,
  status TEXT DEFAULT 'confirmed',  -- confirmed | queued | printing | quality_check | shipped | delivered | failed | cancelled
  tracking_number TEXT,
  tracking_url TEXT,
  stripe_payment_intent_id TEXT,
  vendor_order_id TEXT,  -- Shapeways order ID (when available)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order Events (status history)
CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhooks
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,  -- for HMAC signing
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## API Endpoints to Implement

### Authentication
Every request must have: `Authorization: Bearer <api_key>`
- Strip the "Bearer " prefix
- Look up the key by hashing it and comparing to key_hash
- Attach account_id to the request context
- Return 401 if invalid/revoked

### POST /v1/files
- Accept multipart/form-data with field "file"
- OR accept JSON body: { file_url: string }
- Validate format (.stl, .obj, .3mf only)
- Store file (local disk for now, TODO: R2)
- Parse STL geometry to extract volume_cm3 and bounding_box
- Return: { file_id, original_name, format, volume_cm3, bounding_box, created_at }

### POST /v1/quotes
Body: { file_id, ship_to: {name, address, city, state, zip, country}, material?, quantity? }
- Validate file_id belongs to this account
- Run pricing formula (see below)
- Set expires_at = now + 15 minutes
- Return: { quote_id, expires_at, print_price_usd, shipping_price_usd, order_fee_usd, total_usd, estimated_days, material, quantity }

### POST /v1/orders
Body: { quote_id, idempotency_key? }
- Validate quote hasn't expired
- Check idempotency_key (return existing order if duplicate)
- Create order with status "confirmed"
- TODO: Stripe payment intent
- Add order_event: confirmed
- Dispatch webhook: order.confirmed
- Return: { order_id, status, created_at, estimated_ship_date }

### GET /v1/orders/:id
- Return full order with events array
- { order_id, status, tracking_number, tracking_url, created_at, updated_at, events: [{status, note, created_at}] }

### GET /v1/orders
- List orders for account
- Query params: limit (default 20, max 100), cursor (order id for pagination), status
- Return: { orders: [...], next_cursor }

### PUT /v1/webhooks
Body: { url }
- Validate URL is https://
- Generate a random secret (32 bytes hex)
- Upsert webhook for account (one webhook per account for MVP)
- Return: { webhook_id, url, secret }

## Pricing Formula (src/lib/pricing.ts)

```
Base material cost per cm3:
  pla: $0.08/cm3
  petg: $0.12/cm3
  abs: $0.10/cm3
  resin: $0.25/cm3

Minimum print cost: $3.00
Support factor: 1.15 (15% added for support structures)
Our margin: 1.30 (30% markup)
Order fee: $1.00

Print price = max(volume_cm3 * material_rate * support_factor * margin, $3.00)
Shipping price = $5.99 (flat rate domestic for MVP)
Total = print_price + shipping + order_fee

Estimated days = 5 (flat estimate for MVP)
```

## STL Parser (src/lib/geometry.ts)
Parse binary STL files to extract:
- Volume (cm3) using divergence theorem
- Bounding box (mm)

Use a simple TypeScript implementation — no external dependencies needed for basic STL parsing.

## Webhook Dispatcher (src/lib/webhooks.ts)
- Find all active webhooks for the account
- Build payload: { event, order_id, status, timestamp }
- Sign with HMAC-SHA256: X-PrintByAPI-Signature: sha256=<hex>
- POST to webhook URL
- If it fails, retry up to 3 times with exponential backoff (1s, 2s, 4s)
- Log failures but don't block the main response

## Error Format
All errors return:
```json
{
  "error": {
    "code": "QUOTE_EXPIRED",
    "message": "This quote expired at 2026-03-01T12:00:00Z",
    "request_id": "req_abc123"
  }
}
```

Error codes: UNAUTHORIZED, INVALID_REQUEST, NOT_FOUND, QUOTE_EXPIRED, FILE_TOO_LARGE, UNSUPPORTED_FORMAT, IDEMPOTENCY_CONFLICT, RATE_LIMITED

## Rate Limiting (middleware/rateLimit.ts)
In-memory per account_id:
- free tier: 10 req/min
- growth: 60 req/min
- scale: 300 req/min

## .env.example
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
FILE_STORAGE_PATH=./uploads
PORT=3000
```

## README.md
Write a clear README with:
- What PrintByAPI is (one paragraph)
- Quick start (curl examples for the main happy path: upload file -> quote -> order -> check status)
- Environment setup
- Running locally

## package.json dependencies
- hono
- @hono/node-server
- @supabase/supabase-js
- bcrypt + @types/bcrypt
- stripe
- dotenv

## Important notes
- Use Hono's built-in validator for request validation
- Add request IDs to all responses (X-Request-ID header)
- All timestamps in ISO 8601 UTC
- UUID for all IDs, prefixed in responses: file_xxx, quote_xxx, order_xxx (format: prefix + last 8 chars of uuid, e.g. "file_a1b2c3d4")
- Comments on all TODOs so we know what to implement in Phase 2

When done, run: openclaw system event --text "Done: PrintByAPI MVP scaffold complete — Hono API, schema, pricing engine, STL parser, webhook dispatcher all built" --mode now
