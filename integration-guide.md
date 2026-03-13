# Flight Price Tracker API — Integration Guide

> **Schemas & endpoint details:** `openapi/flights-api.yaml`  
> **OAuth provisioning steps:** `../secret-config.md`

Covers what the OpenAPI spec cannot express: the C3 token handshake,
platform serialization quirks, and error recovery.

---

## 1. Authentication

OAuth 2.0 Client Credentials (RFC 6749 §4.4). Token endpoint:

```
POST /{env}/flightpricetrackerapi/oauth/token
```

**C3 platform requirement:** the token request must include **both**
HTTP Basic Auth **and** the credentials in the form body:

| Basic Auth header | Form body credentials | Result |
|---|---|---|
| absent | present | `302` redirect to IdP |
| present | absent | `{"error": "Bad request"}` |
| **present** | **present** | **`access_token` returned** |

Standard OAuth libraries that send credentials in *either* the header or
the body (per RFC 6749 §2.3) will fail. You must send both.

### Wire format

```http
POST /{env}/flightpricetrackerapi/oauth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64({client_id}:{client_secret})

grant_type=client_credentials&client_id={client_id}&client_secret={client_secret}
```

### Response

```json
{ "type": "OAuthAccessTokenResponse", "access_token": "<JWT>", "token_type": "bearer" }
```

No `expires_in` is returned. Default to a 55-minute TTL with a 60-second
refresh buffer, or decode the JWT `exp` claim.

### curl example

```bash
TOKEN=$(curl -sf -X POST "${BASE_URL}/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

Then use `Authorization: Bearer ${TOKEN}` on all subsequent requests.

---

## 2. Request Flow

```
Consumer                           C3 Platform (API App)
   │                                       │
   │  1. POST /oauth/token                 │
   │     Authorization: Basic b64(id:sec)  │
   │     Body: grant_type=...&...          │
   │ ─────────────────────────────────────>│
   │  200 { access_token: "<JWT>" }        │
   │ <─────────────────────────────────────│
   │                                       │
   │  2. GET /flights/searches             │
   │     Authorization: Bearer <JWT>       │
   │ ─────────────────────────────────────>│
   │  200 [ {FlightSearch}, ... ]          │
   │ <─────────────────────────────────────│
   │                                       │
   │  3–N. Reuse token until near expiry   │
   │  Then re-acquire (step 1)             │
```

---

## 3. C3 Serialization Quirks

### `type` field — single vs. collection

Single-entity responses (get, create, update) include
`"type": "FlightSearch"` at the top level. Collection responses (list,
prices) omit it. Ignore this field during deserialization.

### Null fields are omitted

C3 omits null fields rather than including `"field": null`. Treat absent
fields as null.

### Foreign keys are ID stubs

Related entities serialize as `{"id": "..."}`, never expanded.

### `meta` is opaque

Every entity includes a `meta` block. Only `created` and `updated` are
useful for consumers.

### Dates

All datetime fields use ISO 8601 UTC: `2026-04-04T00:00:00Z`.

---

## 4. Error Recovery

| Status | Meaning | Action |
|---|---|---|
| `302` | Redirect to IdP (no/expired auth) | Re-acquire token, retry once |
| `401` | Invalid Bearer token | Re-acquire token, retry once |
| `400` | Bad request | Do not retry — fix the request |
| `404` | Resource not found | — |
| `500` | Server error | Retry with backoff (max 3) |

Empty response from the token endpoint means the `Authorization: Basic`
header is missing.

---

## 5. Quick Reference

```
Token:  POST /oauth/token  (Basic + form body)  →  Bearer JWT

┌─────────┬──────────────────────┬───────────────────┐
│ Method  │ Path                 │ Returns           │
├─────────┼──────────────────────┼───────────────────┤
│ GET     │ /searches            │ FlightSearch[]    │
│ POST    │ /searches            │ FlightSearch      │
│ GET     │ /searches/:id        │ FlightSearch      │
│ PATCH   │ /searches/:id        │ FlightSearch      │
│ DELETE  │ /searches/:id        │ (empty)           │
│ GET     │ /searches/:id/alert  │ AlertResult       │
│ GET     │ /searches/:id/prices │ PriceSnapshot[]   │
│ GET     │ .../latest-price     │ PriceSnapshot?    │
│ POST    │ /searches/:id/fetch  │ PriceSnapshot[]   │
└─────────┴──────────────────────┴───────────────────┘

Schemas & examples: openapi/flights-api.yaml
OAuth setup: ../secret-config.md
```
