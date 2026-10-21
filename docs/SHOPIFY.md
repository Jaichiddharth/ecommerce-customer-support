# Shopify integration

Connect one Shopify store per workspace, search and share products in conversations, and show the orders of a contact's linked Shopify customer. Products, variants and orders are always fetched from Shopify on demand; nothing is synced.

## Setup

1. In the Shopify Partner dashboard (or Dev Dashboard), create an app.
   - **App URL**: `https://<your app domain>`
   - **Allowed redirection URL**: `https://<your app domain>/api/integrations/shopify/callback`
   - **Protected customer data access**: request access to customer **name, email and phone**. Without it, customer search and orders return `ACCESS_DENIED`.
2. Add to the backend environment:

   ```env
   SHOPIFY_API_KEY=<client id>
   SHOPIFY_API_SECRET=<client secret>
   SHOPIFY_APP_URL=https://<your app domain>    # must match the redirect URL above
   # optional
   SHOPIFY_API_VERSION=2026-07                  # Admin API version
   SHOPIFY_SCOPES=read_all_orders               # extra scopes, added to the required ones
   ```

   `TOKEN_ENCRYPTION_KEY` (already used for WhatsApp tokens) also encrypts Shopify tokens.
3. Run the migration: `npm run db:migrate` (applies `0002_shopify_integration.sql`).

## Scopes

| Scope | Used for |
| --- | --- |
| `read_products` | Product search, details, variants |
| `read_customers` | Find a Shopify customer by email/phone to link to a contact |
| `read_orders` | Orders of a linked customer. Shopify only returns the last 60 days unless `read_all_orders` is also granted (needs Shopify approval). |

The integration only reads data. It never writes to the store.

## Data model

```
organizations 1─* shopify_stores 1─* shopify_customer_links *─1 customers
```

- `shopify_stores`: one row per (organization, shop domain). The access token is encrypted. A partial unique index allows only one store per organization that isn't `disconnected`. Disconnecting keeps the row with its token cleared, so reconnecting the same shop brings back its links.
- `shopify_customer_links`: a link an agent confirmed between a contact and a Shopify customer GID. Each contact has at most one link per store, and each Shopify customer is linked to at most one contact per store.
- A shared product is stored as a normal `messages` row. `metadata.shopifyProduct` records the store, product and variant GIDs, the price and the options.

`customers.shopify_customer_id` (from the initial schema) is not used by this integration.

## Flows

- **Connect** (admins only): `POST /api/integrations/shopify/install` returns the authorize URL and sets an httpOnly nonce cookie. Shopify then redirects to `/callback`. The callback checks the Shopify HMAC, our signed `state` (org, user, shop, expiry) and the nonce cookie. Only then does it exchange the code, check the granted scopes and store the token. Afterwards it redirects to `/?tab=store&shopify=connected|error`.
- **Token problems**: when Shopify answers 401/403, the store is marked `reauth_required` and the UI offers Reconnect. Expiring offline tokens (if Shopify returns a `refresh_token`) are refreshed automatically.
- **Rate limits**: when a GraphQL call is `THROTTLED`, it is retried up to twice. The wait is based on the cost and restore rate that Shopify reports.
- **Share**: `POST /api/integrations/shopify/share` loads the variant from Shopify again, rejects inactive products, builds the message, and sends it through `whatsAppService.sendMessage`. A product with an image goes as image + caption; one without goes as text. Channels that can't send yet offer "Insert as text" instead.

## API

| Method | Path | |
| --- | --- | --- |
| GET / DELETE | `/api/integrations/shopify` | Connection status / disconnect (admin) |
| POST | `/api/integrations/shopify/install` | Start OAuth (admin) |
| GET | `/api/integrations/shopify/callback` | OAuth redirect |
| GET | `/api/integrations/shopify/products?q=&after=` | Search active products (title, SKU, barcode) |
| GET | `/api/integrations/shopify/products/:id` | Product detail with options and variants |
| GET | `/api/integrations/shopify/customers?email=&phone=` | Shopify customer search |
| PUT / DELETE | `/api/integrations/shopify/contacts/:customerId/link` | Link / unlink a contact |
| GET | `/api/integrations/shopify/contacts/:customerId/orders?after=` | Link, Shopify customer and orders |
| POST | `/api/integrations/shopify/share` | Send a product variant in a conversation |

Out of scope for now: catalog/inventory sync, webhooks (including `app/uninstalled`; an uninstall shows up as `reauth_required` on the next call), creating customers, and editing orders.
