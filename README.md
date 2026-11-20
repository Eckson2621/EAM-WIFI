# EAM-WIFI

EAM-WIFI is a multi-tenant Wi-Fi hotspot management application by EAM VENTURES. This repository contains a Cloudflare Worker API and a lightweight browser interface connected to the existing Supabase project.

## Current foundation

- Cloudflare Worker serves the browser application and API.
- Supabase Auth email/password sign-up, sign-in and sign-out.
- Authenticated organization membership lookup.
- Active Wi-Fi package lookup scoped to an organization.
- Supabase Row Level Security remains the authorization boundary: the Worker forwards the signed-in user's JWT and does not use a service-role key.
- Basic automated tests for health and unauthenticated access.

## Supabase connection

The public Supabase project URL and publishable API key are configured in `wrangler.toml`. A publishable key is intended for client-facing use; it is not a service-role secret. Never add a Supabase service-role/secret key, router password, or payment credential to this repository.

The existing database project is:

- Project ref: `jrgmzajlmuqpslhhroez`
- API URL: `https://jrgmzajlmuqpslhhroez.supabase.co`

This app uses the existing tables `organization_members` and `wifi_packages`, and Supabase Auth. It does not create duplicate database tables.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run dev
```

## Deploy to Cloudflare Workers

1. Open Cloudflare Dashboard → Workers & Pages → Create application → Import a repository.
2. Connect GitHub and choose `Eckson2621/EAM-WIFI`, branch `main`.
3. Configure the project as a Worker using the repository's `wrangler.toml`.
4. Build/deploy command: `npm run deploy` (Cloudflare may also deploy from the connected GitHub repository when Git integration is configured).
5. After deployment, open the assigned `workers.dev` URL and test `/api/health`.

The GitHub repository is prepared for deployment, but a Cloudflare account connection and successful live deployment must still be completed and verified in Cloudflare.

## Important limitations in this first scaffold

- Organization creation and owner/admin screens are not implemented yet.
- Router integrations, captive portal, voucher redemption, payment collection, and router event processing are not implemented yet.
- Access is limited by the existing Supabase grants and RLS policies. Test with real authenticated accounts from separate organizations before production use.
- Browser sign-in state is held in session storage and is cleared on sign-out; this is a starter implementation, not a full production session-management design.

## Repository layout

```text
src/index.js             Cloudflare Worker API
public/index.html        Browser application
public/css/style.css     Application styles
public/js/app.js         Browser authentication and workspace UI
tests/worker.test.js     Basic Worker tests
wrangler.toml            Cloudflare Worker and static asset configuration
package.json             Scripts and pinned Wrangler development dependency
.dev.vars.example        Local environment variable template
```
