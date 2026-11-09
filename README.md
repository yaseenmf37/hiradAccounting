This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Install as a PWA

The production app exposes a web manifest, install icons, and a service worker.
Serve it over HTTPS for installation (localhost is treated as secure during
development). On Windows, use the install icon in Chrome or Edge's address bar.
On Android, open the site in Chrome and choose **Install app** or **Add to Home
screen** from the browser menu.

The service worker caches the offline dashboard shell and versioned Next.js
static assets. When a navigation to the dashboard fails, it opens the regular
dashboard UI from that shell; other routes are not replaced with the offline
shell. Online navigations are always fetched from the server. Successfully
viewed JSON API responses and the bootstrap snapshot are stored per
user/business in IndexedDB and encrypted with a device-local, non-extractable
Web Crypto key that is wrapped with AES-KW using a PBKDF2-derived key from the
account password. Each account has independent salts; the password, derived
wrapping key, and plaintext AES key are not persisted. On existing installations,
the app re-encrypts cached responses and pending Outbox records before replacing
the legacy key in one IndexedDB transaction. If that transaction fails or the
password is wrong, the previous key and ciphertext remain in place. Changing the
account password also re-wraps the local data key; if that local step fails, the
previous offline password remains usable and the UI reports that local update
did not complete. Concurrent writes from another tab are locked out during key
replacement and checked against the current key generation before being stored.

Password-wrapped local encryption does not protect data while the workspace is
unlocked from same-origin script execution (including XSS), malicious browser
extensions, direct access to browser storage/runtime, or a compromised device.
It is not a substitute for server-side authorization or device security. Install
the service worker and open the authenticated workspace online until the
snapshot status reports ready before going offline. The regular dashboard and
purchase/sales invoice form use the cached products, contacts, and currency.
New invoices are encrypted in a persistent local outbox and are explicitly
pending—not finalized—until the server confirms them. Offline editing of existing
records and offline entry of other financial operations are not supported.
Offline data may be evicted by the browser. Server-side session revocation cannot
reach a disconnected device. Signing out locks local workspace access without
deleting cached data or unsent encrypted Outbox operations.

## Offline workspace limitations

When an authenticated workspace opens online, it attempts to cache all pages
from core product, category, contact, invoice, payment, expense, and backorder
endpoints, plus the dashboard response. The dashboard reports whether the
snapshot is ready or failed. It is not a complete account export: reports,
settings, and every detail view are not included, and oversized responses can
leave the snapshot incomplete. Browsers may evict local data.

Invoice creation and all invoice accounting effects are committed in one
database transaction, with a business-scoped `Idempotency-Key` protecting
retries. Apply the invoice idempotency migration before deploying this version.
After connectivity returns, queued invoices are retried automatically; permanent
validation/conflict errors remain visible for manual review.

## Separate Supabase Development database

Never point local development or Prisma migration commands at the Production
project. Create a separate Supabase project named for Development, then copy
`.env.example` to `.env.development.local` and replace its placeholders with
that Development project's connection details. Use its pooler URL for
`DATABASE_URL` and its direct connection URL for `DIRECT_URL`; both must refer
to the same Development project. Do not copy Production credentials into the
local development file.

The local env file is ignored by Git. `npm run dev`, `npm run db:check:dev`,
`npm run create-admin`, and Prisma commands load it and fail closed if it is
missing, unmarked, points at the same target as `.env`, or mixes Supabase
project references. Prisma commands in Production use the environment-provided
URLs only when `HIRAD_DATABASE_ENV=production` is explicitly set in the
deployment environment. After setup, run `npm run db:check:dev` to validate the
local target without printing connection details. Database migrations must be
explicitly run only against the confirmed Development project.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
