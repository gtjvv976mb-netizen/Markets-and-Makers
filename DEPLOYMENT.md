# Markets & Makers deployment handoff

For the full click-by-click launch procedure, validation checklist, rollback plan, and mainnet safety gate, use [`LAUNCH-RUNBOOK.md`](./LAUNCH-RUNBOOK.md).

## 0. GitHub

This workspace is not currently a Git repository. When you are ready, create a private GitHub repository and push only the deployable source. The root `.gitignore` excludes historical `outputs/`, working files, dependencies, build folders, local environment files, and archives.

GitHub Actions will automatically run both game and authority-server tests/builds on pull requests and pushes to `main`. Render is already configured with `autoDeployTrigger: checksPass`, so it will wait for those checks. Cloudflare deployment is a separate manual workflow protected by the GitHub `production` environment.

Add these GitHub repository settings before running the Cloudflare workflow:

- Secret `CLOUDFLARE_API_TOKEN`
- Secret `CLOUDFLARE_ACCOUNT_ID`
- Variable `VITE_GAME_SERVER_URL`
- Optional: require a reviewer for the `production` environment

## Stack

- **Cloudflare Workers Static Assets:** Vite browser client and all immutable GLB assets.
- **Render:** Node authoritative realtime service in Singapore.
- **Render Postgres:** durable plots, ledgers, businesses, jobs, command receipts, and Helius event inbox.
- **Helius:** server-side Solana reads and authenticated webhook delivery only.

## 1. Render

Commit the repository to GitHub/GitLab, then create a Render Blueprint from the root `render.yaml`.

Before applying the Blueprint, review its estimated monthly costs. It currently requests a Starter web service and a Basic 256 MB Postgres instance in Singapore.

Set these secret values in the Render dashboard:

- `CLIENT_ORIGINS`: the final Cloudflare URL, for example `https://markets-and-makers-game.<account>.workers.dev`
- `HELIUS_API_KEY`: a server-side Helius key
- `MM_TOKEN_MINT`: leave empty until the actual mint is final and independently reviewed

Render generates `HELIUS_WEBHOOK_SECRET`. Copy its value when configuring the Helius webhook authorization header. Never commit it.

The Blueprint runs `npm run migrate` before deployment and checks `/health`. Postgres has no public inbound IP ranges; the service uses Render's private connection string.

## 2. Cloudflare

In `game/`, create a local `.env.production` containing:

```env
VITE_GAME_SERVER_URL=https://markets-and-makers-authority.onrender.com
```

Then authenticate Wrangler and deploy:

```bash
cd game
npm ci
npm run deploy:cloudflare
```

The `wrangler.jsonc` deploys `dist/` as a single-page application. After Cloudflare supplies the production URL, update `CLIENT_ORIGINS` on Render and redeploy the service.

## 3. Helius

Keep the Helius API key only in Render. The browser never receives it.

Create an Enhanced Transaction webhook with:

- URL: `https://markets-and-makers-authority.onrender.com/webhooks/helius`
- Authorization header: the exact Render `HELIUS_WEBHOOK_SECRET`
- Network: devnet until the economy and legal review are complete
- Monitored address: only the reviewed treasury/mint addresses

Deliveries are idempotently stored by transaction signature. The webhook intentionally grants zero gameplay credits; settlement must be reviewed by a separate worker and ledger command.

## Current safety boundary

The local game remains playable when the Render URL is absent or temporarily unavailable. That fallback is for development only. A production economy must disable local economic authority before any transferable `$MM` integration is enabled.
