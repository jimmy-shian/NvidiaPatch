# NVIDIA NIM LLM Gateway API Documentation

## Authentication

All `/api/*` endpoints (except `/api/health` and `/api/auth/login`) require Bearer Token authentication.

### Login

```
POST /api/auth/login
Authorization: Bearer <admin_token>
```

Response: `200 OK`
```json
{ "success": true }
```

Error: `401 Unauthorized`
```json
{ "error": "Unauthorized", "message": "..." }
```

### Token Setup

On first startup, a random admin token is generated and stored in the database `metadata` table (key: `ADMIN_TOKEN`).
The frontend should store this token in `localStorage` and pass it via `Authorization: Bearer <token>` header.

For SSE connections (`/api/events`), use the `?token=<admin_token>` query parameter since `EventSource` doesn't support custom headers.

---

## Gateway Proxy Endpoints (No Admin Auth)

### `GET /`
Returns gateway status.

### `GET /v1`
Returns gateway status.

### `GET /v1/models`
Returns OpenAI-compatible model list for the requesting client's model group.

**Headers:**
- `Authorization: Bearer <nvidia_key_or_group_id>` (1/2/3 to select group)

**Response:**
```json
{
  "object": "list",
  "data": [{ "id": "...", "object": "model", "created": 1718925400, "owned_by": "gateway-group-1" }],
  "gateway_model_group": 1
}
```

### `POST /v1/chat/completions`
OpenAI-compatible chat completions proxy. Supports streaming and non-streaming.

**Headers:**
- `Authorization: Bearer <nvidia_api_key>` (used for group selection if 1/2/3)

**Request Body:**
```json
{
  "model": "patcher-main",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```

**Response:** OpenAI-compatible response (streaming SSE or JSON).

---

## Admin API Endpoints (Require Auth)

### Health Check (No Auth)

#### `GET /api/health`
```json
{
  "status": "running",
  "uptime": 12345.67,
  "timestamp": "2025-01-01T12:00:00+08:00",
  "keys": { "total": 3, "active": 2 },
  "models": { "active": 5 },
  "memoryUsage": { "rss": 123456, "heapTotal": 98765, "heapUsed": 54321 }
}
```

### SSE Events

#### `GET /api/events?token=<admin_token>`
SSE endpoint for realtime updates. Events:

| Event | Data | Description |
|-------|------|-------------|
| `connected` | `{ timestamp }` | Connection established |
| `logs` | `{ type, message, timestamp }` | New log entry |
| `stats` | `{ hourly, keysCount, activeKeysCount, modelsCount }` | Stats update |
| `keys` | `{ action, id? }` | Key state change |
| `models` | `{ action, activeGroup? }` | Model config change |
| `rules` | `{ action, id? }` | Rule change |
| `settings` | `{ ...settings }` | Settings change |
| `token-usage` | `{ action }` | Token usage update |

---

### Logs

#### `GET /api/logs`
Returns last 100 log entries.

**Response:**
```json
[
  { "timestamp": "2025-01-01T12:00:00+08:00", "type": "info", "message": "..." }
]
```

### Settings

#### `GET /api/settings`
Returns current settings (time values in seconds).

**Response:**
```json
{
  "ROUND_DELAY_MS": 15,
  "REQUEST_TIMEOUT_MS": 120,
  "STREAM_READ_TIMEOUT_MS": 120,
  "NVIDIA_API_URL": "https://integrate.api.nvidia.com/v1",
  "PORT": 4000,
  "MAX_ROUNDS_PER_MODEL": 2,
  "TEST_TIMEOUT_MS": 60,
  "PRICE_PER_MILLION_PROMPT_TOKENS": 0.30,
  "PRICE_PER_MILLION_COMPLETION_TOKENS": 0.60,
  "CURRENCY_SYMBOL": "USD",
  "REF_PRICE_PER_MILLION_PROMPT_TOKENS": 5.00,
  "REF_PRICE_PER_MILLION_COMPLETION_TOKENS": 15.00
}
```

#### `POST /api/settings`
Save settings. Time values in seconds. Returns updated settings.

**Validation:**
- `PORT`: 1-65535 integer
- `MAX_ROUNDS_PER_MODEL`: 1-10 integer
- All timeouts: >= 1 second
- All prices: >= 0

**Error Response** (`400`):
```json
{ "error": "Validation failed", "details": ["PORT must be 1-65535", "Max rounds must be 1-10"] }
```

### API Keys

#### `GET /api/keys`
Returns all keys with **masked** key values.

**Response:**
```json
[
  {
    "id": 1,
    "masked_key": "nvapi-****...abcd1234",
    "key_suffix": "abcd1234",
    "status": "active",
    "cooldown_until": null,
    "consecutive_failures": 0,
    "total_errors": 0,
    "last_used_at": "2025-01-01T12:00:00+08:00",
    "last_error_message": null
  }
]
```

#### `POST /api/keys`
Add a new API key.

**Request:** `{ "key": "nvapi-..." }`
**Response:** `{ "success": true }` or `{ "error": "..." }`

#### `DELETE /api/keys/:id`
Delete an API key.

#### `POST /api/keys/test`
Test all API keys. Returns per-key results.

### Models

#### `GET /api/models?groupId=1`
Get configured models for a group.

#### `POST /api/models`
Save model priority list.

**Request:** `{ "models": ["model/a", "model/b"], "groupId": 1 }`

#### `GET /api/models/groups`
Get all 3 model groups with their configurations.

#### `POST /api/models/groups/active`
Set active model group.

**Request:** `{ "groupId": 2 }`

#### `GET /api/models/available`
Get all available models from NVIDIA Build sync.

#### `POST /api/models/sync`
Trigger NVIDIA Build Free Endpoint model sync.

### Rules

#### `GET /api/rules`
Get all rules (presets + custom).

#### `POST /api/rules`
Add custom rule.

**Request:** `{ "title": "...", "content": "..." }`

#### `PUT /api/rules/:id`
Update custom rule (presets cannot be edited).

**Request:** `{ "title": "...", "content": "..." }`

#### `DELETE /api/rules/:id`
Delete custom rule (presets cannot be deleted).

### Stats

#### `GET /api/stats`
```json
{
  "hourly": [{ "hour": "2025-01-01 12:00", "request_count": 10, "success_count": 9, "error_count": 1 }],
  "keysCount": 3,
  "activeKeysCount": 2,
  "modelsCount": 5
}
```

### Token Usage

#### `GET /api/token-usage`
Returns per-model stats, recent logs, and pricing.

**Response:**
```json
{
  "stats": [{ "model_id": "...", "total_prompt_tokens": 1000, "total_completion_tokens": 500, "total_total_tokens": 1500, "request_count": 5 }],
  "logs": [{ "id": 1, "request_id": "1", "timestamp": "...", "model_id": "...", "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150, "request_body": "..." }],
  "pricing": { "pricePerMillionPromptTokens": 0.30, "pricePerMillionCompletionTokens": 0.60, "currencySymbol": "USD" }
}
```

Note: `request_body` only contains metadata (model, temperature, message_count, etc.), not full messages.

#### `GET /api/token-usage/:id`
Get single token usage record detail.

#### `POST /api/token-usage/clear`
Clear all token usage data.

### Gateway Operations

#### `POST /api/gateway/reset-cooldowns`
Reset all model-level failure cooldowns.

#### `POST /api/test/chat`
Test chat with a specific model (bypasses gateway dispatch).

---

## Error Format

All errors follow this format:
```json
{ "error": "Error type or message", "message": "Detailed description" }
```

For validation errors:
```json
{ "error": "Validation failed", "details": ["Field X must be...", "Field Y is invalid"] }
```

---

## Network Binding

Production mode binds to `127.0.0.1` only. The server is not exposed to external networks by default.