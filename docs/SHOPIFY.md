# Shopify integration

Connect one or more Shopify stores per workspace, choose which store each channel works with, search and share products in conversations, and show the orders of a contact's Shopify customer. The customer is matched by phone number or email when a conversation is opened, or linked by an agent. Products, variants and orders are always fetched from Shopify on demand; nothing is synced.

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
   SHOPIFY_APP_DISTRIBUTION=public              # set once the app is published with Public distribution (default: private)
   ```

   `SHOPIFY_APP_DISTRIBUTION` only changes what the Shopify page says: "Private app" (only stores in the app's own Shopify organization can connect, orders limited to 60 days) or "Public app" (any store can connect).

   `TOKEN_ENCRYPTION_KEY` (already used for WhatsApp tokens) also encrypts Shopify tokens.
3. Run the migrations: `npm run db:migrate` (`0002_shopify_integration.sql`, `0003_shopify_multi_store.sql`, `0005_customer_identities.sql`, `0009_store_channel_connections.sql`).

## Scopes

| Scope | Used for |
| --- | --- |
| `read_products` | Product search, details, variants |
| `read_customers` | Find a Shopify customer by email/phone to link to a contact |
| `read_orders` | Orders of a linked customer. Shopify only returns the last 60 days unless `read_all_orders` is also granted (needs Shopify approval). |

The integration only reads data. It never writes to the store.

## Data model

```
organizations 1─* shopify_stores 1─* shopify_store_channels *─1 channels      (one store per channel)
                  shopify_stores 1─* shopify_customer_links *─1 customers     (primary contact of a profile)
                  shopify_stores 1─* shopify_order_links    *─1 customers     (+ channel it was linked through)
customers.primary_customer_id ─> customers.id   (other channel identities of the same person)
```

- `shopify_stores`: one row per (organization, shop domain). The access token is encrypted. A workspace can connect several stores. There is **no default store**: a number only uses the store it's connected to (`shopify_store_channels`), and a number without one shows no Shopify data in the inbox. (`is_default` is a legacy column that nothing reads.) Disconnecting keeps the row with its token cleared, so reconnecting the same shop brings back its links and channel mappings.
- `shopify_store_channels`: which store a channel (number) uses. A workspace can connect any number of stores, and a store can have many numbers (e.g. one for sales, one for service). A number belongs to **one** store only (`uq_shopify_store_channels_channel`). To use a number with another store, disconnect it from its current store first (`DELETE /channel-mappings/:id`), then connect it to the new one. There is no one-step move: connecting a number that's already on another store returns `409 SHOPIFY_CHANNEL_ALREADY_MAPPED`, naming that store.
- `shopify_order_links`: an order associated with a profile (always its primary contact's id), with the channel it was associated through. Each order belongs to at most one profile per store. Only the GID and the order name are stored; details are read from Shopify. Links move with the profile when contacts are linked or unlinked.
- **Isolation**: every row carries `organization_id`, and rows that point at a store or channel use a composite `(organization_id, id)` foreign key (`uq_shopify_stores_org_id`, `uq_channels_org_id`), so the database rejects any row tying one workspace's data to another workspace's store or channel.
- **Contact profiles**: a person can reach the workspace on several channels (WhatsApp numbers, Instagram, Messenger, ...), and each channel has its own `customers` row. An agent can link those rows into one profile. The oldest contact stays the primary contact (`primary_customer_id IS NULL`), and the others point at it. Profiles are never nested: when two profiles are linked, every contact of one moves to the other.
- `shopify_customer_links`: the link between a profile (always its primary contact's id) and a Shopify customer GID. Every channel identity of the profile shares it. Each profile has at most one row per store, and each Shopify customer is linked to at most one profile per store. `source` is `auto` (phone or email match) or `manual` (picked by an agent). A row with `shopify_customer_id` NULL means an agent unlinked the profile, so it isn't matched automatically again.
- A shared product is stored as a normal `messages` row. `metadata.shopifyProduct` records the store, product and variant GIDs, the price and the options.

`customers.shopify_customer_id` (from the initial schema) is not used by this integration.

## Which store a request uses

Every Shopify call resolves its store in this order (`shopifyStoreConnectionService.resolveStore`):

1. `storeId`, when given. It must be an active store of the workspace. If the channel in scope is mapped to another store, the request is rejected (`SHOPIFY_STORE_CHANNEL_MISMATCH`).
2. The store mapped to `channelId`, or to the channel of `customerId` (the contact).

There is no default store. If the channel isn't connected to a store, or its store is disconnected, the request has **no** store (`SHOPIFY_NOT_CONNECTED`; the contact orders endpoint returns `connected: false`). It never falls back to another store's data.

Members limited to some stores (`users.stores`: shop domains, empty or `All` = every store) get `SHOPIFY_STORE_ACCESS_DENIED` for other stores. Owners and admins are never limited.

**Inbox**: when a conversation opens, the inbox asks `GET /channel-store?channelId=` which store the conversation's own number uses. Products, the contact's Shopify customer and orders only show when it has one, and every call passes that `storeId` (with `customerId`). Connecting a number to a store happens in Settings → Channels → the number → Shopify store → Sync store.

## Flows

- **Connect** (admins only): `POST /api/integrations/shopify/install` returns the authorize URL and sets an httpOnly nonce cookie. Shopify then redirects to `/callback`. The callback checks the Shopify HMAC, our signed `state` (org, user, shop, expiry) and the nonce cookie. Only then does it exchange the code, check the granted scopes and store the token. Afterwards it redirects to `/?tab=store&shopify=connected|error`.
- **Token problems**: when Shopify answers 401/403, the store is marked `reauth_required` and the UI offers Reconnect. Expiring offline tokens (if Shopify returns a `refresh_token`) are refreshed automatically.
- **Rate limits**: when a GraphQL call is `THROTTLED`, it is retried up to twice. The wait is based on the cost and restore rate that Shopify reports.
- **Customer matching**: when an unlinked contact is opened, the phone numbers and emails of every identity in its profile are searched in Shopify. Only exact matches count. If exactly one customer matches and no other profile has claimed it, the link is saved as `auto`, and later conversations load it directly. If several match, or the one match belongs to another profile, they're listed for the agent to choose. If nothing matches, the agent can search by name, email, phone or order number. The Shopify customer may use different details than the chat.
- **Linking channels**: linking two contacts merges their profiles and moves the Shopify link to the remaining primary contact. If both profiles are linked to different Shopify customers in the same store, the request is rejected (`CONTACT_IDENTITY_CONFLICT`) until one is unlinked. If the primary contact is unlinked from its profile, its oldest identity becomes the primary contact and keeps the Shopify link.
- **Share**: `POST /api/integrations/shopify/share` loads the variant from Shopify again, rejects inactive products, builds the message, and sends it through `whatsAppService.sendMessage`. A product with an image goes as image + caption; one without goes as text. Channels that can't send yet offer "Insert as text" instead.

## API

`scope` = optional `storeId`, `channelId`, `customerId` (see above). Admin = `integrations` page permission plus `manage_billing_and_integrations`.

| Method | Path | |
| --- | --- | --- |
| GET / DELETE | `/api/integrations/shopify` | Connection status / disconnect `?storeId=` (admin) |
| POST | `/api/integrations/shopify/install` | Start OAuth (admin) |
| GET | `/api/integrations/shopify/callback` | OAuth redirect |
| GET | `/api/integrations/shopify/stores` | Stores with their mapped channels (admin) |
| GET / DELETE | `/api/integrations/shopify/stores/:storeId` | One store / disconnect (admin) |
| GET | `/api/integrations/shopify/channel-store?channelId=` | The store a number is connected to, or `store: null` (any member; used by the inbox) |
| GET / POST | `/api/integrations/shopify/channel-mappings?storeId=&channelId=` | Mappings plus the store every live channel uses (`via`: mapping or none) / connect `{ storeId, channelId }`. 409 if the number is on another store (admin) |
| GET / DELETE | `/api/integrations/shopify/channel-mappings/:mappingId` | One mapping / disconnect the number from its store (it then has no store). DELETE also removes that store's contact ↔ customer links and order links of the number's contacts (contacts that also use another number of the same store keep theirs) and returns `removed: { contactLinks, orderLinks }` (admin) |
| GET | `/api/integrations/shopify/channel-mappings/:mappingId/impact` | What that DELETE would remove (`linkedContacts`, `manuallyLinkedContacts`, `linkedOrders`), for the confirmation in Settings; changes nothing (admin) |
| GET | `/api/integrations/shopify/products?q=&after=&scope` | Search active products (title, SKU, barcode) |
| GET | `/api/integrations/shopify/products/:id?scope` | Product detail with options and variants |
| GET | `/api/integrations/shopify/customers?q=&email=&phone=&scope` | Shopify customer search (`q`: name, email or phone) |
| GET | `/api/integrations/shopify/orders?q=&scope` | Order search by number or email, with each order's customer |
| PUT / DELETE | `/api/integrations/shopify/contacts/:customerId/link` | Link `{ shopifyCustomerId, storeId? }` / unlink `?storeId=` the contact's profile |
| GET | `/api/integrations/shopify/contacts/:customerId/orders?after=&storeId=` | Store, link, Shopify customer and orders. Matches unlinked contacts first (`autoMatch`) |
| GET / POST | `/api/integrations/shopify/contacts/:customerId/order-links` | Orders associated with the profile `?storeId=` / associate `{ orderId, channelId?, storeId? }` (checked in Shopify) |
| DELETE | `/api/integrations/shopify/contacts/:customerId/order-links/:linkId` | Remove an order association |
| GET | `/api/customer/:id/identities[?q=]` | The profile's channel identities, or contacts that could be linked |
| PUT / DELETE | `/api/customer/:id/identities` | Link another contact `{ contactId }` / unlink one `?contactId=` |
| POST | `/api/integrations/shopify/share` | Send a product variant in a conversation |

Out of scope for now: automation and billing on top of store connections (the mappings, `source` columns and per-store/per-channel order links are where they'd plug in), catalog/inventory sync, webhooks (including `app/uninstalled`; an uninstall shows up as `reauth_required` on the next call), creating customers, and editing orders.
