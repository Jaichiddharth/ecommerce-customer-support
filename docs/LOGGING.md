# Logging & Error Handling Guide

This guide explains how the application records what it is doing (**logging**) and how it deals with things that go wrong (**error handling**). It is written so that anyone on the team can follow it, whether you write code every day or only need to trace a problem a customer reported.

The server logger **is [pino](https://getpino.io)**, the most widely used fast logger for Node.js, and **pino-pretty** prints it in a readable way. pino does the real work: log levels, readable and JSON output, hiding secrets and printing errors. The project adds only three small things, using pino's own settings: the request id on every line, the file and line that wrote the log (during development), and turning every error into an `AppError` before it is printed. You only ever call `createLogger(...)`; [section 14](#14-how-the-logger-is-built-for-maintainers) explains the setup for whoever maintains it.

**What you will learn**

- How to read a log line and an error report
- How to write logs in server code
- How to raise errors so the user sees a clear message and developers see the real cause
- How the browser (UI) shows errors
- How to trace a problem a user reported, step by step

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [Key terms](#2-key-terms)
3. [How to read the logs](#3-how-to-read-the-logs)
4. [Writing logs in server code](#4-writing-logs-in-server-code)
5. [Raising errors in server code](#5-raising-errors-in-server-code)
6. [Writing API routes](#6-writing-api-routes)
7. [What is logged automatically](#7-what-is-logged-automatically)
8. [Handling errors in the browser (UI)](#8-handling-errors-in-the-browser-ui)
9. [Configuration](#9-configuration)
10. [Privacy and security](#10-privacy-and-security)
11. [Tracing a problem a user reported](#11-tracing-a-problem-a-user-reported)
12. [Quick recipes](#12-quick-recipes)
13. [Frequently asked questions](#13-frequently-asked-questions)
14. [How the logger is built (for maintainers)](#14-how-the-logger-is-built-for-maintainers)
15. [Where everything lives](#15-where-everything-lives)

---

## 1. The big picture

Every time something fails, the same few steps happen. Nobody has to remember to do them; they are built in.

```
  Something fails                 (Meta rejects a message, the database is down, a field is missing…)
        │
        ▼
  It becomes an AppError          one standard error type: a code, a friendly message, and the original cause
        │
        ▼
  The route wrapper catches it    (withAuth / apiHandler)
        ├──► writes ONE detailed log entry on the server   → for developers
        └──► sends ONE standard JSON reply to the browser  → for the user
                    │
                    ▼
  The browser (apiClient) receives it
        ├──► writes a short entry in the browser console    → for developers
        └──► the screen shows a toast or an error panel     → for the user
                (with a "Ref" number linking it to the server log)
```

**Two audiences, two messages:**

| Who | What they see | Example |
|-----|---------------|---------|
| The user | A short, plain explanation of what to do | *"It's been more than 24 hours since this customer last messaged you, so only an approved template message can be sent."* |
| The developer | Everything needed to fix it: file, line, function, the external service's raw reply, the cause chain | `metaApi.service.ts:304 sendWhatsAppTextMessage()`, Meta code `131047`, `fbtrace_id`, … |

The **Ref** number (for example `req_7a047aaa0e31`) connects the two. If a user reports an error and gives you the Ref, you can find the exact server log entry for it.

---

## 2. Key terms

| Term | Meaning in plain words |
|------|------------------------|
| **Log** | A line of text the server writes to record what happened, like an entry in a diary. |
| **Log level** | How important the entry is: `error`, `warn`, `info`, `http` or `debug`. See [section 4](#which-level-should-i-use). |
| **Request id / Ref** | A unique label (e.g. `req_7a047aaa0e31`) given to every request. Every log line from that request carries it, and the user sees it in error messages. |
| **Scope** | The name of the part of the code that wrote the log, e.g. `[WhatsAppService]`. |
| **Origin** | The exact place (file, line, function) where the error first happened. In a log entry, it is the first `src/…` line of the stack. |
| **Stack** | The path the code took to reach the error, listed from the deepest call outwards, e.g. Meta API call → service → route. |
| **AppError** | The single error type used everywhere on the server. It carries a code, a user-friendly message and the original cause. |
| **Error code** | A fixed name for the kind of problem, e.g. `MESSAGE_WINDOW_EXPIRED`. The UI and logs use it to tell errors apart. |
| **Source** | The area the error came from: `whatsapp`, `meta`, `database`, `firebase`, `upload`, `validation`… |
| **Provider** | The external system involved (Meta, Shopify, Firebase, Postgres) and what it reported. |
| **Retryable** | Whether trying again might work (e.g. a temporary outage) or not (e.g. a wrong phone number). |
| **Expected error** | A normal, foreseeable failure (wrong password, invalid input). Logged as a warning, not an error. |

---

## 3. How to read the logs

### 3.1 A normal log line

```
[2026-10-08 11:09:24.365] INFO: [req_db1239fa821c] [WhatsAppService] src/lib/services/channels/whatsapp.service.ts:320 WhatsAppService.sendMessage() › Dispatching WhatsApp message {"channelId":3,"to":"919876543210","type":"text"}
```

Read it left to right:

| Part | Example | Meaning |
|------|---------|---------|
| Time | `[2026-10-08 11:09:24.365]` | When it happened (server's local time, to the millisecond) |
| Level | `INFO:` | How important it is |
| Request id | `[req_db1239fa821c]` | Which request it belongs to (missing for background tasks) |
| Scope | `[WhatsAppService]` | Which module wrote it |
| Location | `whatsapp.service.ts:320 WhatsAppService.sendMessage()` | File, line and function that wrote it (development only) |
| Message | `Dispatching WhatsApp message` | What happened |
| Context | `{"channelId":3,"to":"…","type":"text"}` | Extra facts that help understanding |

### 3.2 A request summary line

Every API request writes one summary line when it finishes:

```
[2026-10-08 11:09:24.369] HTTP: [req_db1239fa821c] [api] POST /api/webhooks/whatsapp › 200 · 214ms
```

This says: the request `POST /api/webhooks/whatsapp` finished with status `200` (success) in `214ms`.

### 3.3 An error report

When something fails, the log line is followed by an `err` block. This is pino-pretty's standard way of printing an error; JSON logs contain the same fields.

```
[2026-10-08 11:19:11.149] WARN: [req_9e82ea11c4e0] [api] POST /api/channels/whatsapp/send › 422 MESSAGE_WINDOW_EXPIRED · 312ms
    err: {
      "type": "AppError",
      "message": "It's been more than 24 hours since this customer last messaged you, so only an approved template message can be sent.: Request failed with status code 400",
      "stack":
          AppError: It's been more than 24 hours since this customer last messaged you, so only an approved template message can be sent.
              at sendWhatsAppTextMessage (src/lib/meta/whatsapp/metaApi.service.ts:304:20)
              at WhatsAppService.sendMessage (src/lib/services/channels/whatsapp.service.ts:399:24)
              at src/app/(backend)/api/channels/whatsapp/send/route.ts:74:18
          caused by: AxiosError: Request failed with status code 400
      "code": "MESSAGE_WINDOW_EXPIRED",
      "title": "24-Hour Messaging Window Expired",
      "status": 422,
      "source": "whatsapp",
      "retryable": false,
      "details": {
        "metaCode": 131047,
        "solution": "Send an approved WhatsApp template message instead of a free-form message.",
        "channelId": 3,
        "phoneNumberId": "1098…",
        "to": "919876543210",
        "type": "text"
      },
      "provider": {
        "name": "meta",
        "method": "POST",
        "url": "https://graph.facebook.com/v21.0/1098…/messages",
        "operation": "whatsapp.send_text",
        "durationMs": 298,
        "httpStatus": 400,
        "code": 131047,
        "type": "OAuthException",
        "message": "(#131047) Re-engagement message",
        "traceId": "AbaGRHzZ…",
        "extra": {
          "title": "24-Hour Messaging Window Expired",
          "description": "More than 24 hours have passed since the customer last replied to the business.",
          "solution": "Send an approved WhatsApp template message instead of a free-form message."
        }
      },
      "expected": false
    }
```

| Part | What it tells you |
|------|-------------------|
| **Header line** | Which request failed (`POST /api/channels/whatsapp/send`), the status sent to the browser (`422`), the error code, and how long it took. |
| `type`, `code`, `status`, `source` | What kind of error it is and which area it came from. |
| `message` | The message the user saw, followed by the message of the error underneath it (`: Request failed with status code 400`). |
| `title` | The short heading the user saw. |
| `stack` | **Where it happened. Start your investigation here.** The first `src/…` line is where it failed; the lines below show how the code got there. `caused by:` starts the original, lower-level error. Library code is left out. |
| `details` | The facts we attached: Meta's code and suggested solution, which channel, which phone number. |
| `provider` | What the external service said: which call, its own error code, its raw message, its trace id (`traceId`; quote it when contacting Meta support) and, for Meta errors, a title, description and solution from the catalogue. |
| `retryable`, `expected` | Whether trying again can help, and whether this is a normal, foreseeable failure. |

> **Tip:** The level in the header tells you how worried to be. `WARN` means "failed, but in a normal and understood way" (bad input, an expired session, Meta refusing a message). `ERROR` means "something is broken and needs attention".

---

## 4. Writing logs in server code

### 4.1 Set up a logger once per file

```ts
import { createLogger } from "@/lib/logger";

const log = createLogger("OrderService");   // this name appears on every line as [OrderService]
```

Use a short, recognisable name, usually the class or module name. `createLogger` returns a normal pino logger, so you never need to import pino yourself, and anything in pino's documentation works on it too.

### 4.2 Write log entries

```ts
log.info("Order synced", { orderId: 42, customerId: 7 });
log.warn("Shopify answered slowly", { durationMs: 4100 });
log.error("Could not save order", { err, orderId: 42 });
log.debug("Payload received", { items: 3 });
```

Each method takes:

1. **A message**: a short sentence saying what happened. Keep it constant, and put the changing values in the context object.
2. **A context object** (optional): the facts that help someone understand the event, such as ids, counts and durations.

pino's own order, `log.info({ orderId: 42 }, "Order synced")`, works as well. This guide puts the message first because it reads more naturally.

| Good | Avoid |
|------|-------|
| `log.info("Order synced", { orderId })` | `log.info("Order " + orderId + " synced")` |
| `log.warn("Customer not found for phone", { phone })` | `log.warn("error!!")` |

### 4.3 Logging an error

Pass the error as `err`. It is printed in full automatically: code, message, provider details, causes and the stack (see [3.3](#33-an-error-report)):

```ts
log.error("Could not save order", { err, orderId: 42 });

// Shorthand when there is no extra context:
log.error("Could not save order", err);
```

### Which level should I use?

| Level | Use it when… | Example |
|-------|--------------|---------|
| `error` | Something is **broken** and someone must fix it. | Database unreachable; message delivered but not saved |
| `warn` | Something **failed in a known way** and the system coped. | Meta rejected a message; a webhook had a bad signature |
| `info` | An **important business event** happened. | Message sent; WhatsApp channel connected |
| `http` | Request and integration call summaries. **Written automatically.** | `POST /api/messages › 200 · 34ms` |
| `debug` | Fine detail for local investigation. **Hidden in production.** | The payload about to be sent to Meta |

### 4.4 Child loggers (optional)

To attach the same context to many lines, use pino's `child`:

```ts
const syncLog = log.child({ storeId });   // storeId is added to every line written by syncLog
syncLog.info("Sync started");
```

For a sub-part of a module that deserves its own name, create a second logger: `createLogger("OrderService:sync")`.

### 4.5 The rules

| Do | Don't |
|----|-------|
| Use `log.*` in all server code. | Use `console.log` / `console.error` (no time, no request id, no location). |
| Put ids and numbers in the context object. | Put tokens, passwords or full message texts in logs. |
| Log an error **where you handle it and carry on**. | Log an error **and then throw it** (it would be logged twice). |
| Keep messages short and constant. | Build messages by joining strings. |

**When to log an error yourself.** Only when you **catch it and continue** because the step was optional:

```ts
try {
  await metaApi.subscribeAppToWaba(wabaId, token);
} catch (err) {
  // Optional step: the channel still works without it, so warn and keep going
  log.warn("Could not subscribe app to WABA", { err, wabaId });
}
```

If the failure should stop the request, **don't log it. Throw it** (next section), and it is logged for you once.

---

## 5. Raising errors in server code

### 5.1 Always throw an `AppError`

```ts
import { AppError } from "@/lib/errors";
```

| Situation | Code to write | Result for the user |
|-----------|---------------|---------------------|
| A required field is missing or wrong | `throw AppError.validation("Customer name is required.", "name");` | 400 + your message |
| A record doesn't exist | `throw AppError.notFound("Customer not found.");` | 404 + your message |
| A known situation with a standard message | `throw new AppError("WHATSAPP_NOT_CONNECTED");` | The default message from the catalogue |
| A known situation with your own message and facts | `throw new AppError("FILE_TOO_LARGE", { message: "Images can be at most 5 MB.", details: { size } });` | Your message; `details` go to the log and the response |

**Options you can pass to `new AppError(code, { … })`:**

| Option | Purpose |
|--------|---------|
| `message` | The user-facing text (replaces the default). Write it for a non-technical reader. |
| `title` | A short heading for the toast, e.g. "Upload failed". |
| `details` | Facts that are safe to show: ids, field names, limits. |
| `cause` | The original error. Logged in full, **never** sent to the browser. |
| `expected` | `true` if this is a normal, foreseeable failure. It is logged as a warning instead of an error. |
| `retryable` | Override whether "try again" makes sense. |

### 5.2 Add context to an error from deeper code

When you call something that may fail (for example the Meta API) and want to add *what you were doing*, use `AppError.wrap`:

```ts
try {
  await metaApi.sendWhatsAppTextMessage(phoneNumberId, token, to, text);
} catch (err) {
  throw AppError.wrap(err, "MESSAGE_SEND_FAILED", { details: { customerId, to } });
}
```

`wrap` is smart:

- If the deeper error is already **specific** (e.g. `MESSAGE_WINDOW_EXPIRED`), it **keeps** that code and message and only adds your details.
- If the deeper error is **generic** (e.g. an unknown Meta error or a plain JavaScript error), it becomes the code you passed (`MESSAGE_SEND_FAILED`).

Either way, the original cause and its location are kept for the log.

### 5.3 Errors you don't need to convert

These are recognised and converted automatically, with their details kept:

| Where it comes from | Recognised as |
|---------------------|---------------|
| Meta Graph API (via `graphHttp`) | The matching `META_*`, `MESSAGE_*`, `WHATSAPP_*` or `FILE_*` code, with Meta's title and message from the catalogue |
| Firebase Admin (token checks) | `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID`, `FIREBASE_UNAVAILABLE`… |
| PostgreSQL / Drizzle | `DB_UNAVAILABLE`, `DB_CONSTRAINT_VIOLATION`, `DB_INVALID_DATA`, `DB_QUERY_FAILED` |
| Shopify (any `*.myshopify.com` call) | `SHOPIFY_AUTH_FAILED`, `SHOPIFY_RATE_LIMITED`, `SHOPIFY_UNAVAILABLE`, `SHOPIFY_API_ERROR` |
| Anything else | `INTERNAL_ERROR`. The user sees a generic message, and the real error is in the log. |

So in a repository or service, just let database or API errors pass through. Don't catch them only to re-throw.

### 5.4 Error codes at a glance

The full list, with default messages, is in `src/lib/errors/codes.ts`.

| Area | Codes (HTTP status) |
|------|---------------------|
| Input | `VALIDATION_ERROR` (400), `INVALID_JSON` (400), `NOT_FOUND` (404), `CONFLICT` (409) |
| Sign-in | `AUTH_TOKEN_MISSING` (401), `AUTH_TOKEN_EXPIRED` (401), `AUTH_TOKEN_INVALID` (401), `AUTH_USER_NOT_FOUND` (401), `AUTH_USER_DISABLED` (403), `FORBIDDEN` (403), `FIREBASE_UNAVAILABLE` (503) |
| Meta API | `META_API_ERROR` (502), `META_INVALID_REQUEST` (422), `META_PERMISSION_DENIED` (422), `META_RATE_LIMITED` (429), `META_UNAVAILABLE` (503) |
| WhatsApp channel | `WHATSAPP_NOT_CONNECTED` (422), `WHATSAPP_CHANNEL_NOT_FOUND` (404), `WHATSAPP_CHANNEL_MISCONFIGURED` (422), `WHATSAPP_REAUTH_REQUIRED` (422), `WHATSAPP_CONNECT_FAILED` (502) |
| Messages | `MESSAGE_SEND_FAILED` (502/422), `MESSAGE_WINDOW_EXPIRED` (422), `MESSAGE_RECIPIENT_INVALID` (422), `MESSAGE_TEMPLATE_INVALID` (422) |
| Files | `FILE_TOO_LARGE` (413), `FILE_TYPE_UNSUPPORTED` (415), `FILE_UPLOAD_FAILED` (502), `MEDIA_NOT_FOUND` (404) |
| Webhooks | `WEBHOOK_VERIFICATION_FAILED` (403), `WEBHOOK_SIGNATURE_INVALID` (401), `WEBHOOK_MISCONFIGURED` (500), `WEBHOOK_PROCESSING_FAILED` (500) |
| Shopify | `SHOPIFY_API_ERROR` (502), `SHOPIFY_AUTH_FAILED` (422), `SHOPIFY_RATE_LIMITED` (429), `SHOPIFY_UNAVAILABLE` (503) |
| Database | `DB_UNAVAILABLE` (503), `DB_CONSTRAINT_VIOLATION` (409), `DB_INVALID_DATA` (400), `DB_QUERY_FAILED` (500) |
| General | `RATE_LIMITED` (429), `UPSTREAM_TIMEOUT` (504), `NETWORK_ERROR` (browser only), `INTERNAL_ERROR` (500) |

> **Note:** A `401` always means *the user's own session* has a problem. Problems with the WhatsApp connection use `422`, so the UI never confuses "your login expired" with "the WhatsApp token expired".

### 5.5 Meta (WhatsApp) error codes

Meta's own error codes (e.g. `131047`, `190`) are listed in `src/lib/errors/meta-error-catalog.ts`. Each entry has:

| Field | Shown to |
|-------|----------|
| `title` | The user: toast heading, failed-message badge |
| `userMessage` | The user: the explanation |
| `description` | Developers: why it happened (in the log) |
| `solution` | Developers and support: what to do (in the log and the response `details`) |
| `code` | Our error code (decides the HTTP status and category) |
| `retryable` | Whether trying again can work |

If the log says `note: Meta code 123456 is not in META_ERROR_CATALOG`, add an entry for that code to the catalogue.

---

## 6. Writing API routes

### 6.1 Wrap every route

| Route type | Wrapper |
|------------|---------|
| Needs a signed-in user | `withAuth` (gives you `req.user`) |
| Public (webhooks, health checks) | `apiHandler` |

The wrapper does the error handling for you, so **routes don't need try/catch**.

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { customerService } from "@/lib/services";

export const POST = withAuth(async (req) => {
  const body = await readJson(req);   // invalid JSON → clean 400 instead of a crash

  if (!body?.name) {
    throw AppError.validation("Customer name is required.", "name");
  }

  const customer = await customerService.createCustomer({
    ...body,
    organizationId: req.user.organizationId,
  });

  return NextResponse.json({ success: true, customer });
});
```

Use `readJson(req)` instead of `req.json()`, and `readFormData(req)` instead of `req.formData()`. They turn unreadable input into a clear 400 error.

### 6.2 What the wrapper does for you

1. Gives the request a **Ref** (request id) and returns it in the `x-request-id` response header.
2. For `withAuth`: checks the Firebase token and loads the user. The user id and organisation id are then added to every log line of the request.
3. Catches anything thrown and converts it to an `AppError`.
4. Writes **one** log entry for the failure (`warn` for expected problems and 4xx, `error` for 5xx).
5. Sends the **standard error reply** to the browser.
6. Writes the request summary line (`POST /api/… › 200 · 34ms`).

### 6.3 The standard error reply

Every failed API call returns the same shape:

```json
{
  "success": false,
  "error": "It's been more than 24 hours since this customer last messaged you, so only an approved template message can be sent.",
  "title": "24-Hour Messaging Window Expired",
  "code": "MESSAGE_WINDOW_EXPIRED",
  "source": "whatsapp",
  "status": 422,
  "requestId": "req_9e82ea11c4e0",
  "retryable": false,
  "details": { "metaCode": 131047, "solution": "Send an approved WhatsApp template message instead of a free-form message." }
}
```

| Field | Meaning |
|-------|---------|
| `error` | The message to show the user. Always plain text. |
| `title` | Optional short heading. |
| `code` | Which kind of error (see [5.4](#54-error-codes-at-a-glance)). |
| `source` | Which area it came from. |
| `requestId` | The Ref, which links the reply to the server log. |
| `retryable` | Whether a "Try again" button makes sense. |
| `details` | Safe extra facts. |
| `debug` | **Development only.** Where it failed and the underlying error. Never sent in production. |

---

## 7. What is logged automatically

You don't need to add logging for these. It is already built in.

| What | How it appears |
|------|----------------|
| **Every API request** | `[…] HTTP: [req_…] [api] GET /api/customer › 200 · 41ms` |
| **Every failed API request** | A `WARN` or `ERROR` entry with the full error report |
| **Every Meta API call** | `[…] HTTP: [req_…] [MetaApi] meta:whatsapp.send_text › POST /…/messages → 200 · 312ms {"wamid":"…"}`. Failures show Meta's code and `fbtrace` id. |
| **Incoming webhooks** | One line per saved message, reaction or status update, plus a summary. Each failed item is logged with its message id, sender and organisation, and the rest of the batch still goes through. |
| **Failed deliveries reported by WhatsApp** | `WARN … WhatsApp reported a message delivery failure: 24-Hour Messaging Window Expired`, with Meta's title, message, description and solution |
| **Errors outside API routes** (page rendering, start-up) | Captured by `src/instrumentation.ts` as `[next] Unhandled … error` |

---

## 8. Handling errors in the browser (UI)

### 8.1 What happens automatically

Every call made with `apiClient`:

- **Retries once** if the user's sign-in token had just expired (the user notices nothing).
- Converts any failure (server error, no internet, timeout) into an **`ApiError`** with a friendly `message`, a `code`, a `title` and the `requestId`.
- **Logs it** in the browser console with the endpoint and Ref.

So in your component you only decide **how to show it**.

### 8.2 Show a message (toast)

```ts
import apiClient from "@/lib/api/client";
import { notifyError } from "@/lib/api/notify";
import { gooeyToast } from "@/components/ui/goey-toaster";

try {
  await apiClient.post("/api/customer", data);
  gooeyToast.success("Customer created");
} catch (err) {
  notifyError(err, { where: "InboxView.createCustomer", title: "Customer not created" });
}
```

The toast shows:

- **Heading:** the server's specific title if there is one (e.g. "24-Hour Messaging Window Expired"), otherwise the `title` you passed.
- **Text:** the friendly message followed by `· Ref req_…`.

`notifyError` returns the `ApiError`, so you can react to specific cases:

```ts
const apiError = notifyError(err, { where: "InboxView.handleSend", title: "Message not sent" });
if (apiError.code === "WHATSAPP_REAUTH_REQUIRED") openReconnectDialog();
```

For partial success (the action worked, but with a caveat), use a warning:

```ts
import { notifyWarning } from "@/lib/api/notify";

notifyWarning("Message delivered, but not saved", res.data.warning);
```

### 8.3 Show a panel when content fails to load

Never show "No items yet" when the real problem is that loading failed. Use the state components:

```tsx
import { ErrorState, EmptyState, LoadingState } from "@/components/ui/states";

{isLoading ? (
  <LoadingState label="Loading customers…" />
) : loadError ? (
  <ErrorState error={loadError} title="Couldn't load customers" onRetry={fetchCustomers} />
) : customers.length === 0 ? (
  <EmptyState title="No customers yet" description="Add your first customer to get started." />
) : (
  <CustomerList customers={customers} />
)}
```

| Component | When to use it |
|-----------|----------------|
| `LoadingState` | While the data is loading |
| `ErrorState` | Loading **failed**. It shows the message, the Ref, and a "Try again" button (pass `onRetry`). Use `compact` in narrow spaces. |
| `EmptyState` | Loading **succeeded** but there is nothing to show |

To keep the error in state, convert it first:

```ts
import { toApiError, type ApiError } from "@/lib/api/api-error";

const [loadError, setLoadError] = useState<ApiError | null>(null);

try {
  const res = await apiClient.get("/api/customer");
  setCustomers(res.data.customers);
  setLoadError(null);
} catch (err) {
  setLoadError(toApiError(err));
}
```

### 8.4 Log something that isn't an API call

Browser code is bundled, so the location can't be detected automatically. Pass it yourself as the first argument:

```ts
import { clientLogger } from "@/lib/client-logger";

clientLogger.error("WhatsAppConnectButton", "Facebook SDK failed to load", err);
clientLogger.warn("InboxView.handleFileChange", "Attachment rejected", { name, size });
clientLogger.info("useRealtime", "Live updates connected");
clientLogger.debug("InboxView.handleSend", "Sending", { to });   // hidden in production
```

Use `"ComponentName.functionName"` as the location so it's easy to search for.

### 8.5 Screens that crash

If a page fails while drawing (a bug in a component), the user sees a **"This page ran into a problem"** screen with *Try again* and *Reload page* buttons instead of a blank page. This is handled by `src/app/error.tsx` and `src/app/global-error.tsx`; you don't need to do anything.

### 8.6 File uploads

Check files **as soon as the user picks them**, so they get a clear message before anything is uploaded:

```ts
import { validateWhatsAppMedia } from "@/lib/media-limits";

const check = validateWhatsAppMedia(file);
if (!check.ok) {
  gooeyToast.error("File not supported", { description: check.message });
  return;
}
```

The same check runs again on the server, so it can't be bypassed.

---

## 9. Configuration

Set these in `.env.local` (development) or in the server environment (production). All are optional.

| Variable | Values | Default | What it does |
|----------|--------|---------|--------------|
| `LOG_LEVEL` | `error`, `warn`, `info`, `http`, `debug` | `debug` in development, `http` in production | Shows this level **and everything more serious**. For example, `info` shows `error`, `warn` and `info`, and hides `http` and `debug`. |
| `LOG_FORMAT` | `pretty`, `json` | `pretty` | `pretty` is for people reading a terminal. `json` writes pino's standard JSON lines, one per entry, for log tools (Datadog, CloudWatch, Grafana Loki…). |
| `NO_COLOR` | any value | not set | Turns colours off. |
| `FORCE_COLOR` | any value except `0` | not set | Turns colours on even when not writing to a terminal. |

Colours are used automatically when the output is a terminal, and never when it goes to a file. Restart the server after changing any of these values.

**Typical setups**

```bash
# Local development: see everything
LOG_LEVEL=debug

# Production server read by people
LOG_LEVEL=info

# Production with a log platform
LOG_LEVEL=http
LOG_FORMAT=json
```

**JSON format**

Each entry is one line, for example:

```json
{"level":"info","time":"2026-10-08T05:39:24.365Z","pid":1948,"hostname":"web-1","scope":"WhatsAppService","requestId":"req_db1239fa821c","route":"POST /api/channels/whatsapp/send","userId":3,"orgId":1,"channelId":3,"to":"919876543210","msg":"WhatsApp message accepted by Meta"}
```

| Field | Meaning |
|-------|---------|
| `level` | `error`, `warn`, `info`, `http` or `debug` |
| `time` | When it happened, in UTC (ISO 8601) |
| `pid`, `hostname` | Which server process wrote it |
| `scope` | Which module wrote it |
| `requestId`, `route`, `userId`, `orgId` | The request it belongs to (only present inside a request) |
| `where` | File, line and function in development; the route on request summary lines; `meta:<operation>` on Meta API lines |
| `err` | The error, written by pino's standard error serializer: `type`, `message` (followed by the messages of the errors underneath), `stack`, plus the `AppError` fields `code`, `status`, `source`, `retryable`, `title`, `details`, `provider` and `expected` |
| `msg` | The message |
| anything else | The context you passed, e.g. `channelId`, `to` |

To read JSON logs comfortably in a terminal, pipe them through pino-pretty, which is already installed:

```bash
npm start | npx pino-pretty
```

**Where pretty logs appear during development**

With `npm run dev`, log lines appear in the terminal and are also recorded by Next.js in `.next/dev/logs/next-development.log`, together with browser console messages.

---

## 10. Privacy and security

The logger protects sensitive data automatically:

- **Hidden fields:** pino's built-in `redact` feature replaces these fields with `[REDACTED]`: `password`, `passwordHash`, `token`, `accessToken`, `access_token`, `metaAccessToken`, `refreshToken`, `idToken`, `firebaseIdToken`, `firebaseGcmToken`, `verifyToken`, `input_token`, `secret`, `appSecret`, `clientSecret`, `client_secret`, `apiKey`, `privateKey`, `private_key`, `credential`, `authorization`, `Authorization`, `cookie`, `signature`, `signatureHeader`.
  - Names must match **exactly**, and they are found at the top level and up to **two levels inside**, e.g. `{ accessToken }`, `{ connection: { accessToken } }` and `{ data: { connection: { accessToken } } }`.
  - A new kind of secret (say `webhookSecret`) is **not** hidden until its name is added to `SECRET_FIELDS` in `src/lib/logger/redact.ts`.
- **Hidden URL parts:** `access_token`, `client_secret`, `input_token`, `code`, `token`, `hub.verify_token` and `appsecret_proof` are masked in logged URLs.
- **Hidden database values:** when a database query fails, the log shows the SQL but not the values that were sent (`params: [hidden]`), because they can hold customer data.
- **Internal details stay on the server:** stack traces, SQL and raw provider messages are sent to the browser **only in development**.

**Still your responsibility:**

- Don't put secrets **inside the message text** (`log.info("token is " + token)` is not protected).
- Don't log full customer message texts, file contents or personal data you don't need. Ids are enough. Nothing is shortened automatically.

---

## 11. Tracing a problem a user reported

You don't need to be a developer for steps 1–3.

1. **Ask for the Ref.** Every error message ends with `Ref req_…`, e.g. `Ref req_7a047aaa0e31`. Ask the user to copy it, or take a screenshot.
2. **Search the server logs** for that Ref. Every line from that request contains it.
3. **Read the header line of the error report.** The code says what kind of problem it was (see [5.4](#54-error-codes-at-a-glance)). Often that is enough, for example:
   - `MESSAGE_WINDOW_EXPIRED`: the customer hasn't replied in 24 hours, so a template is needed. Not a bug.
   - `WHATSAPP_REAUTH_REQUIRED`: the WhatsApp connection must be reconnected in Settings.
   - `DB_UNAVAILABLE`: the database was unreachable, so check the database server.
4. **For developers:** look at the `stack` (its first `src/…` line is where it failed, and `caused by:` shows the original error) and at `provider` (what Meta / Postgres / Firebase said).
5. **For Meta problems:** if you need Meta support, give them the `traceId` value from `provider` (Meta's `fbtrace_id`).

---

## 12. Quick recipes

| I want to… | Do this |
|------------|---------|
| Record that something important happened | `log.info("Order synced", { orderId })` |
| Reject bad input | `throw AppError.validation("Phone number is required.", "phone")` |
| Say a record doesn't exist | `throw AppError.notFound("Order not found.")` |
| Stop because WhatsApp isn't connected | `throw new AppError("WHATSAPP_NOT_CONNECTED")` |
| Add context to an error from a deeper call | `throw AppError.wrap(err, "MESSAGE_SEND_FAILED", { details: { customerId } })` |
| Carry on after an optional step fails | `catch (err) { log.warn("Optional step failed", { err }) }` |
| Add the same field to many lines | `const syncLog = log.child({ storeId })` |
| Hide a new kind of secret | Add its field name to `SECRET_FIELDS` in `src/lib/logger/redact.ts` |
| Read a request body safely | `const body = await readJson(req)` |
| Show an API error to the user | `notifyError(err, { where: "Component.fn", title: "Couldn't save" })` |
| Show a failed-to-load panel | `<ErrorState error={err} onRetry={reload} />` |
| Log in the browser | `clientLogger.error("Component.fn", "What happened", data)` |
| Add a new Meta error code | Add an entry to `src/lib/errors/meta-error-catalog.ts` |
| Add a new kind of error | Add a code to `ERROR_DEFINITIONS` in `src/lib/errors/codes.ts` |
| See more detail locally | Set `LOG_LEVEL=debug` in `.env.local` and restart |
| Read JSON logs comfortably | `npm start \| npx pino-pretty` (with `LOG_FORMAT=json`) |

---

## 13. Frequently asked questions

**Why don't I see file and line numbers in production logs?**
They come from source maps, which only exist when running `npm run dev`. In production the `where` field is left out, and stack lines point into compiled files (`.next/server/chunks/…`). Production logs still show the module name (scope), the route, the error code and all error details, which is normally enough. For exact files and lines, reproduce the problem with `npm run dev`.

**Why is an error logged as `WARN` and not `ERROR`?**
Because it is an expected situation: bad input, an expired session, or Meta refusing a message for a business reason. `ERROR` is kept for things that are actually broken, so real problems stand out.

**I caught an error and logged it. Why do I see it twice?**
You probably also re-threw it. Either handle it (log and continue) **or** throw it (it is logged for you). Don't do both.

**The user saw "Something went wrong on our side". Where is the real reason?**
That message is used for unexpected errors, so internal details are never shown to users. The real error is in the server log under the same Ref, in the `err` block: its `message`, and the `caused by:` part of its `stack`.

**Do webhook failures make Meta resend the event?**
No. Meta always receives a `200` reply so the webhook stays healthy. Each failed item is logged as `ERROR` with its message id, sender and organisation, so it can be investigated. There is no automatic replay yet.

**Where did the old `console.log` banners go?**
They were replaced by structured log lines. Set `LOG_LEVEL=debug` to see the extra detail they used to show (e.g. what is being sent to Meta).

**Which logging library is used?**
pino (with pino-pretty for readable output). `createLogger` returns a real pino logger. pino is maintained by a core group that includes a Node.js core maintainer, is downloaded tens of millions of times a week, and is supported by Next.js out of the box. See [section 14](#14-how-the-logger-is-built-for-maintainers).

**Why does the time in pretty logs differ from the time in JSON logs?**
Pretty logs show the server's local time so people can read them easily. JSON logs use UTC, which is the standard for log platforms.

**Do browser logs use pino too?**
No. In the browser, pino would only wrap `console`, so the small `clientLogger` is used instead. It works the same way: a location label, a message and data.

---

## 14. How the logger is built (for maintainers)

The rest of the code only calls `createLogger(...)`, so `src/lib/logger/` is the only place that knows about pino.

**Packages** (pinned to exact versions in `package.json`):

| Package | Version | Role |
|---------|---------|------|
| `pino` | 10.3.1 | Levels, child loggers, JSON output, writing |
| `pino-pretty` | 13.1.3 | Formats entries for people (`LOG_FORMAT=pretty`) |

**What pino does, and what this project adds**

Everything is configured through pino's and pino-pretty's own options in `src/lib/logger/index.ts`. The project's own code is small and only covers what pino doesn't do.

| Need | Provided by |
|------|-------------|
| Levels, `LOG_LEVEL` filtering, child loggers, JSON lines | pino (`customLevels` adds the `http` level) |
| Readable lines: time, level, request id, scope, location, message, context | pino-pretty (`messageFormat` template, `ignore`, `singleLine`) |
| Printing errors: type, message, stack, causes and extra fields | pino's standard error serializer (`pino.stdSerializers.err`) |
| Hiding secret fields | pino `redact`, using the field list in `redact.ts` |
| Request id, route, user and organisation on every line | pino `mixin`, reading `context.ts` (Node's `AsyncLocalStorage`) |
| The `log.info("message", { context })` call style | pino `hooks.logMethod` (pino's own order also works) |
| Converting errors to `AppError` before printing, hiding Drizzle query values | the `err` serializer in `index.ts` (a few lines around pino's serializer) |
| File, line and function of the caller; stacks pointing at `src/` files | `stack.ts`. pino has no caller detection, and Next.js runs bundled code, so positions are looked up in Node's source maps. |

**Design decisions**

- **No transports.** pino transports run in worker threads, which adds moving parts inside a bundled Next.js app, and nothing here ships logs elsewhere. If a log platform is added later, set `LOG_FORMAT=json` and let the platform collect standard output.
- **Pretty mode prints through `console`.** Each entry is formatted with pino-pretty's formatter and written with `console.log`, `console.warn` or `console.error`. Writing is synchronous (nothing is lost if the process crashes), lines stay in order with Next.js' own output, and Next.js can record them in its dev log.
- **JSON mode writes with `pino.destination({ sync: true })`**, pino's own standard-output stream, so every line is written at once and in order.
- **Stacks are shortened in development only.** Library frames are dropped, and so are frames from the logging and error-conversion code when the stack also contains other code of ours. Production stacks are printed exactly as pino receives them.
- **Edits apply on save.** Changes to the logger code take effect in `npm run dev` without a restart (environment variables still need one).

**Upgrading pino safely**

1. Read the release notes, and prefer versions that have been published for about a month.
2. Install exact versions, letting every dependency resolve only to releases that are at least a month old:
   ```bash
   npm install --save-exact pino@<version> pino-pretty@<version> --before=<YYYY-MM-DD one month ago>
   ```
3. Run `npm audit` and check that nothing is reported for the pino packages.
4. Start the app and look at one normal line, one request line and one error report.

---

## 15. Where everything lives

| File | What it contains |
|------|------------------|
| `src/lib/logger/index.ts` | pino and pino-pretty settings, `createLogger`, error printing |
| `src/lib/logger/stack.ts` | Finds the file, line and function, and shortens stacks, in development |
| `src/lib/logger/redact.ts` | Which fields and URL parts are hidden |
| `src/lib/logger/context.ts` | Request id, user id and organisation id per request |
| `src/lib/errors/codes.ts` | All error codes, their HTTP status and default messages |
| `src/lib/errors/app-error.ts` | The `AppError` class (`validation`, `notFound`, `wrap`) |
| `src/lib/errors/normalize.ts` | Converts Meta / Firebase / Postgres / Shopify errors into `AppError` |
| `src/lib/errors/meta-error-catalog.ts` | Meta error codes with title, message, description and solution |
| `src/lib/api/handler.ts` | `apiHandler`, `readJson`, `readFormData`, the standard error reply |
| `src/lib/security/auth.ts` | `withAuth` (sign-in check plus the same error handling) |
| `src/lib/meta/graph-client.ts` | Logging and error conversion for every Meta API call |
| `src/lib/api/client.ts` | Browser `apiClient`: token refresh, error conversion, console logging |
| `src/lib/api/api-error.ts` | The browser `ApiError` type and `toApiError` |
| `src/lib/api/notify.ts` | `notifyError` and `notifyWarning` toasts |
| `src/lib/client-logger.ts` | `clientLogger` for browser logs |
| `src/components/ui/states.tsx` | `ErrorState`, `EmptyState`, `LoadingState` |
| `src/lib/media-limits.ts` | WhatsApp file type and size rules |
| `src/app/error.tsx`, `src/app/global-error.tsx` | Crash screens |
| `src/instrumentation.ts` | Captures errors that happen outside API routes |
