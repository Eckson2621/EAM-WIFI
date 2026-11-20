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

Automatic deployment is configured through GitHub Actions in `.github/workflows/deploy.yml`. Before it can deploy, open GitHub repository Settings → Secrets and variables → Actions → New repository secret and add:\n\n- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to edit Workers.\n- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.\n\nThen push to `main` or run the workflow manually from the Actions tab. The workflow runs tests before deployment. Do not paste either value into source files or chat. A live deployment is not yet confirmed; it will only happen after those two GitHub secrets are configured and the workflow succeeds.

## Important limitations in this first scaffold

- Organization creation and owner/admin screens are not implemented yet.
- Router secure pairing, live RouterOS control, captive portal, voucher redemption, payment collection, and router event processing are not implemented yet. Registration stores router metadata only; it does not connect the router. See `docs/router-connection.md`.
- Access is limited by the existing Supabase grants and RLS policies. Test with real authenticated accounts from separate organizations before production use.
- Browser sign-in state is held in session storage and is cleared on sign-out; this is a starter implementation, not a full production session-management design.

## Repository layout

```text
src/index.js             Cloudflare Worker API\ndatabase/register_wifi_business.sql  Atomic registration RPC\ndocs/router-connection.md  Secure router pairing plan
public/index.html        Browser application
public/css/style.css     Application styles
public/js/app.js         Browser authentication and workspace UI
tests/worker.test.js     Basic Worker tests\n.github/workflows/deploy.yml  Test and deploy workflow
wrangler.toml            Cloudflare Worker and static asset configuration
package.json             Scripts and pinned Wrangler development dependency
.dev.vars.example        Local environment variable template
```
