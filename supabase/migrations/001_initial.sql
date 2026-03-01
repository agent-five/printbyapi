-- PrintByAPI Initial Schema

-- Accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  tier TEXT DEFAULT 'free',  -- free | growth | scale | enterprise
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_account_id ON api_keys(account_id);

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

CREATE INDEX idx_files_account_id ON files(account_id);

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

CREATE INDEX idx_quotes_account_id ON quotes(account_id);
CREATE INDEX idx_quotes_file_id ON quotes(file_id);

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

CREATE INDEX idx_orders_account_id ON orders(account_id);
CREATE INDEX idx_orders_quote_id ON orders(quote_id);
CREATE INDEX idx_orders_idempotency_key ON orders(idempotency_key);

-- Order Events (status history)
CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_events_order_id ON order_events(order_id);

-- Webhooks
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,  -- for HMAC signing
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhooks_account_id ON webhooks(account_id);
