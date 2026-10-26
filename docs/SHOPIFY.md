# Shopify integration

Connect one Shopify store per workspace, search and share products in conversations, and show the orders of a contact's Shopify customer. The customer is matched by phone number or email when a conversation is opened, or linked by an agent. Products, variants and orders are always fetched from Shopify on demand; nothing is synced.

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
3. Run the migrations: `npm run db:migrate` (`0002_shopify_integration.sql`, `0003_shopify_multi_store.sql`, `0005_customer_identities.sql`).

## Scopes

| Scope | Used for |
| --- | --- |
| `read_products` | Product search, details, variants |
| `read_customers` | Find a Shopify customer by email/phone to link to a contact |
| `read_orders` | Orders of a linked customer. Shopify only returns the last 60 days unless `read_all_orders` is also granted (needs Shopify approval). |

The integration only reads data. It never writes to the store.

## Data model

```
organizations 1─* shopify_stores 1─* shopify_customer_links *─1 customers (primary contact of a profile)
customers.primary_customer_id ─> customers.id   (other channel identities of the same person)
```

- `shopify_stores`: one row per (organization, shop domain). The access token is encrypted. A partial unique index allows only one store per organization that isn't `disconnected`. Disconnecting keeps the row with its token cleared, so reconnecting the same shop brings back its links.
- **Contact profiles**: a person can reach the workspace on several channels (WhatsApp numbers, Instagram, Messenger, ...), and each channel has its own `customers` row. An agent can link those rows into one profile. The oldest contact stays the primary contact (`primary_customer_id IS NULL`), and the others point at it. Profiles are never nested: when two profiles are linked, every contact of one moves to the other.
- `shopify_customer_links`: the link between a profile (always its primary contact's id) and a Shopify customer GID. Every channel identity of the profile shares it. Each profile has at most one row per store, and each Shopify customer is linked to at most one profile per store. `source` is `auto` (phone or email match) or `manual` (picked by an agent). A row with `shopify_customer_id` NULL means an agent unlinked the profile, so it isn't matched automatically again.
- A shared product is stored as a normal `messages` row. `metadata.shopifyProduct` records the store, product and variant GIDs, the price and the options.

`customers.shopify_customer_id` (from the initial schema) is not used by this integration.

## Flows

- **Connect** (admins only): `POST /api/integrations/shopify/install` returns the authorize URL and sets an httpOnly nonce cookie. Shopify then redirects to `/callback`. The callback checks the Shopify HMAC, our signed `state` (org, user, shop, expiry) and the nonce cookie. Only then does it exchange the code, check the granted scopes and store the token. Afterwards it redirects to `/?tab=store&shopify=connected|error`.
- **Token problems**: when Shopify answers 401/403, the store is marked `reauth_required` and the UI offers Reconnect. Expiring offline tokens (if Shopify returns a `refresh_token`) are refreshed automatically.
- **Rate limits**: when a GraphQL call is `THROTTLED`, it is retried up to twice. The wait is based on the cost and restore rate that Shopify reports.
- **Customer matching**: when an unlinked contact is opened, the phone numbers and emails of every identity in its profile are searched in Shopify. Only exact matches count. If exactly one customer matches and no other profile has claimed it, the link is saved as `auto`, and later conversations load it directly. If several match, or the one match belongs to another profile, they're listed for the agent to choose. If nothing matches, the agent can search by name, email, phone or order number. The Shopify customer may use different details than the chat.
- **Linking channels**: linking two contacts merges their profiles and moves the Shopify link to the remaining primary contact. If both profiles are linked to different Shopify customers in the same store, the request is rejected (`CONTACT_IDENTITY_CONFLICT`) until one is unlinked. If the primary contact is unlinked from its profile, its oldest identity becomes the primary contact and keeps the Shopify link.
- **Share**: `POST /api/integrations/shopify/share` loads the variant from Shopify again, rejects inactive products, builds the message, and sends it through `whatsAppService.sendMessage`. A product with an image goes as image + caption; one without goes as text. Channels that can't send yet offer "Insert as text" instead.

## API

| Method | Path | |
| --- | --- | --- |
| GET / DELETE | `/api/integrations/shopify` | Connection status / disconnect (admin) |
| POST | `/api/integrations/shopify/install` | Start OAuth (admin) |
| GET | `/api/integrations/shopify/callback` | OAuth redirect |
| GET | `/api/integrations/shopify/products?q=&after=` | Search active products (title, SKU, barcode) |
| GET | `/api/integrations/shopify/products/:id` | Product detail with options and variants |
| GET | `/api/integrations/shopify/customers?q=&email=&phone=` | Shopify customer search (`q`: name, email or phone) |
| GET | `/api/integrations/shopify/orders?q=` | Order search by number or email, with each order's customer |
| PUT / DELETE | `/api/integrations/shopify/contacts/:customerId/link` | Link / unlink the contact's profile |
| GET | `/api/integrations/shopify/contacts/:customerId/orders?after=` | Link, Shopify customer and orders. Matches unlinked contacts first (`autoMatch`) |
| GET | `/api/customer/:id/identities[?q=]` | The profile's channel identities, or contacts that could be linked |
| PUT / DELETE | `/api/customer/:id/identities` | Link another contact `{ contactId }` / unlink one `?contactId=` |
| POST | `/api/integrations/shopify/share` | Send a product variant in a conversation |

Out of scope for now: catalog/inventory sync, webhooks (including `app/uninstalled`; an uninstall shows up as `reauth_required` on the next call), creating customers, and editing orders.
