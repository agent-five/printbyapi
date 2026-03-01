# PrintByAPI

An API-first 3D print fulfillment service designed for autonomous AI agents. Upload an STL file, get an instant quote, place an order, and track it — all through a simple REST API. No dashboards, no browser required.

## Quick Start

### 1. Upload a file

```bash
curl -X POST https://api.printbyapi.com/v1/files \
  -H "Authorization: Bearer pbapi_your_key_here" \
  -F "file=@benchy.stl"
```

Response:
```json
{
  "file_id": "file_a1b2c3d4",
  "original_name": "benchy.stl",
  "format": "stl",
  "volume_cm3": 15.42,
  "bounding_box": { "x": 60.0, "y": 31.0, "z": 48.0 },
  "created_at": "2026-02-28T12:00:00.000Z"
}
```

### 2. Get a quote

```bash
curl -X POST https://api.printbyapi.com/v1/quotes \
  -H "Authorization: Bearer pbapi_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "<uuid from step 1>",
    "material": "pla",
    "quantity": 1,
    "ship_to": {
      "name": "Jane Smith",
      "address": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94102",
      "country": "US"
    }
  }'
```

Response:
```json
{
  "quote_id": "quote_e5f6g7h8",
  "print_price_usd": 3.00,
  "shipping_price_usd": 5.99,
  "order_fee_usd": 1.00,
  "total_usd": 9.99,
  "estimated_days": 5,
  "expires_at": "2026-02-28T12:15:00.000Z"
}
```

### 3. Place an order

```bash
curl -X POST https://api.printbyapi.com/v1/orders \
  -H "Authorization: Bearer pbapi_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "quote_id": "<uuid from step 2>",
    "idempotency_key": "my-unique-key-123"
  }'
```

### 4. Check order status

```bash
curl https://api.printbyapi.com/v1/orders/<order_uuid> \
  -H "Authorization: Bearer pbapi_your_key_here"
```

## Environment Setup

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Fill in the values:
   - `SUPABASE_URL` — Your Supabase project URL
   - `SUPABASE_SERVICE_KEY` — Supabase service role key
   - `STRIPE_SECRET_KEY` — Stripe secret key (optional for MVP)
   - `FILE_STORAGE_PATH` — Local directory for file uploads (default: `./uploads`)
   - `PORT` — Server port (default: `3000`)

3. Run the database migration in your Supabase SQL editor:
   ```
   supabase/migrations/001_initial.sql
   ```

## Running Locally

```bash
npm install
npm run dev
```

The server starts at `http://localhost:3000`. Check health:

```bash
curl http://localhost:3000/health
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/files` | Upload a 3D model (STL/OBJ/3MF) |
| `POST` | `/v1/quotes` | Get an instant print quote |
| `GET` | `/v1/quotes/:id` | Retrieve a quote |
| `POST` | `/v1/orders` | Place an order from a quote |
| `GET` | `/v1/orders` | List orders (paginated) |
| `GET` | `/v1/orders/:id` | Get order details + events |
| `PUT` | `/v1/webhooks` | Register/update a webhook URL |
| `GET` | `/v1/webhooks` | List active webhooks |
| `POST` | `/v1/keys` | Create a new API key |
| `DELETE` | `/v1/keys/:id` | Revoke an API key |

## Authentication

All `/v1/*` endpoints require an API key:

```
Authorization: Bearer pbapi_your_key_here
```

## Rate Limits

| Tier | Requests/min |
|------|-------------|
| free | 10 |
| growth | 60 |
| scale | 300 |

Rate limit headers are included in every response:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

## Error Format

```json
{
  "error": {
    "code": "QUOTE_EXPIRED",
    "message": "This quote expired at 2026-03-01T12:00:00Z",
    "request_id": "req_abc123def456"
  }
}
```

## Webhooks

Register a webhook to receive order status updates:

```bash
curl -X PUT https://api.printbyapi.com/v1/webhooks \
  -H "Authorization: Bearer pbapi_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.com/webhook"}'
```

Webhook payloads are signed with HMAC-SHA256. Verify the `X-PrintByAPI-Signature` header against the secret returned during registration.
