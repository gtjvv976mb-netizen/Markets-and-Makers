# Markets & Makers — complete launch runbook

This runbook deploys the current **lite browser MMO foundation** using:

- **GitHub** — private source repository, automated tests, controlled releases.
- **Render** — authoritative Node/WebSocket server and managed PostgreSQL.
- **Cloudflare Workers Static Assets** — browser client and immutable 3D assets.
- **Helius** — server-side Solana RPC reads and authenticated webhooks.

The first public environment is deliberately **devnet/read-only**. It does not create a token, buy tokens, pay players, credit deposits, or permit withdrawals. Those features remain behind the mainnet gate in Section 18.

## 1. Architecture being deployed

```text
Player browser
  |-- HTTPS ------> Cloudflare
  |                   Vite/Three.js game + GLB assets
  |
  `-- HTTPS/WSS --> Render authority server
                        |-- PostgreSQL: plots, jobs, businesses, ledgers
                        `-- Helius: devnet RPC + authenticated webhooks
```

The browser renders the world and submits player intent. Render owns authoritative movement and must eventually own construction, inventory, production, sales, and currency decisions. PostgreSQL is durable truth. Helius is an external event source, never gameplay authority.

## 2. Cost and safety checkpoint

Before creating resources:

1. Open `render.yaml` and review the requested plans.
2. The Blueprint currently requests a **Starter** Render web service and **Basic 256 MB** PostgreSQL in Singapore. These are paid resources.
3. Review current Cloudflare and Helius plan limits in their dashboards.
4. Turn on account budget alerts wherever supported.
5. Do not use a treasury private key, seed phrase, or wallet signing key. The current server does not need one.

Never place secrets in Git, the browser, a `VITE_*` variable, screenshots, chat, or support tickets. `VITE_*` values are public because Vite compiles them into browser code.

## 3. Values worksheet

Store secret values in a password manager, not in this document.

| Value | Secret? | Where it belongs | Available after |
|---|---:|---|---|
| GitHub repository URL | No | Local Git remote, Render | Repository creation |
| Render public URL | No | GitHub variable `VITE_GAME_SERVER_URL` | First Render deploy |
| Cloudflare production URL | No | Render `CLIENT_ORIGINS` | First Cloudflare deploy |
| Cloudflare Account ID | Sensitive metadata | GitHub secret `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard |
| Cloudflare API token | Yes | GitHub secret `CLOUDFLARE_API_TOKEN` | Cloudflare API Tokens |
| Helius API key | Yes | Render `HELIUS_API_KEY` only | Helius devnet project |
| Devnet test mint | No | Render `MM_TOKEN_MINT` | Devnet mint selection |
| Helius webhook secret | Yes | Render-generated; copied to Helius Authorization header | Blueprint creation |
| Monitored public addresses | No | Helius webhook settings | Devnet wallet design |

For technical handoff, share only non-secret URLs and the public devnet mint. Never share API keys, webhook secrets, private keys, or seed phrases.

## 4. Verify the project locally

From the project root:

```bash
cd game
npm ci
npm test
npm run build

cd ../server
npm ci
npm test
npm run build
```

Expected:

- Both test suites pass.
- Both builds finish without errors.
- `game/dist/` is generated locally but is not committed.
- No `.env` file is staged for Git.

Optional browser test:

```bash
cd game
npm run dev
```

This can use the development fallback. It is not proof that Render authority works.

## 5. Create the private GitHub repository

1. Sign in to GitHub and select **New repository**.
2. Choose a name such as `markets-and-makers`.
3. Set visibility to **Private**.
4. Do **not** initialize it with a README, `.gitignore`, or license. The local project already has its files; an empty remote avoids a first-push conflict.
5. Create the repository and copy its URL.

Initialize this workspace and explicitly add only the deployable stack:

```bash
git init -b main
git add .github .gitignore game server render.yaml DEPLOYMENT.md LAUNCH-RUNBOOK.md production-qa-report.json
git status
```

Before committing, `git status` must not include:

- `.env` or `.env.*` files other than committed examples
- API keys, wallet keys, seed phrases, or webhook secrets
- `node_modules/`, `dist/`, caches, Blender archives, or historical outputs

Then commit and push:

```bash
git commit -m "Initial Markets and Makers production stack"
git remote add origin https://github.com/YOUR_ACCOUNT/markets-and-makers.git
git push -u origin main
```

If GitHub requests authentication, use its browser/device flow, GitHub Desktop, or a scoped credential. Do not use your GitHub account password as an HTTPS Git password.

## 6. Confirm GitHub CI and protect `main`

1. Open the GitHub repository.
2. Open **Actions → Markets and Makers CI**.
3. Confirm both jobs pass:
   - `Browser game`
   - `Authority server`
4. If one fails, open the failed step, reproduce and fix it locally, commit, and push.

Recommended repository protection:

1. Open **Settings → Rules → Rulesets** or **Branches**.
2. Protect `main`.
3. Require the two CI jobs before merge.
4. Block force pushes and branch deletion.
5. Require pull requests when another developer joins.

Do not deploy a failing `main` branch. Render uses `autoDeployTrigger: checksPass` so later deploys wait for GitHub checks.

## 7. Deploy Render and PostgreSQL

Render is deployed first because the Cloudflare client build needs its public URL.

### 7.1 Connect the repository

1. Sign in to Render.
2. Select **New → Blueprint**.
3. Connect the GitHub account or organization that owns the private repository.
4. If possible, grant Render access only to this repository.
5. Select the repository.
6. Render should detect root-level `render.yaml`.

### 7.2 Review the Blueprint before paying

It should propose:

- `markets-and-makers-authority` web service
- `markets-and-makers-db` PostgreSQL
- Singapore region
- `/health` health check
- `npm run migrate` pre-deploy command
- automatic deploy only after GitHub checks pass

Review the displayed monthly price before selecting **Deploy Blueprint**. The current plans are paid.

### 7.3 Enter initial Render values

Render prompts for the `sync: false` values in `render.yaml`:

- `CLIENT_ORIGINS`: enter an exact temporary/expected Cloudflare origin if known. Replace it after Step 10. Never use `*`.
- `HELIUS_API_KEY`: leave empty until Section 12 if the form permits it.
- `MM_TOKEN_MINT`: leave empty until a devnet test mint exists.

If Render refuses an empty Helius value, complete Section 12.1 first and return. Do not use fake placeholders; the service would incorrectly report the chain as configured.

Render supplies `DATABASE_URL` from PostgreSQL and generates `HELIUS_WEBHOOK_SECRET`.

### 7.4 Watch first deployment

Expected order:

1. PostgreSQL provisions.
2. Server dependencies install and TypeScript builds.
3. `npm run migrate` creates tables.
4. The service starts.
5. Render checks `/health`.

Use the service **Events** and **Logs** to diagnose failures. Fix the cause before redeploying.

## 8. Verify Render

Copy the public origin, such as:

```text
https://markets-and-makers-authority.onrender.com
```

Test it:

```bash
curl https://YOUR_RENDER_HOST/health
curl https://YOUR_RENDER_HOST/api/public-config
```

Before Helius configuration, `/health` should resemble:

```json
{
  "status": "ok",
  "service": "markets-and-makers-authority",
  "database": "ready",
  "realtime": "ready",
  "chain": "not-configured"
}
```

`chain: "not-configured"` is correct now. `database: "unavailable"` blocks launch; inspect the database, `DATABASE_URL`, and migration logs.

`/api/public-config` must report:

- realm `sunwoven-1`
- tick rate `10`
- network `devnet`
- token mode `read-only`
- token mint `null` until configured

Save the exact Render origin without a trailing slash.

## 9. Configure GitHub for Cloudflare

### 9.1 Create a restricted API token

1. Sign in to Cloudflare.
2. Open **My Profile → API Tokens**.
3. Select **Create Token**.
4. Use **Edit Cloudflare Workers** or an equivalent custom token with only the permissions Wrangler needs for this Worker and its static assets.
5. Restrict it to the correct account.
6. Set an expiration/rotation policy.
7. Create and store the token in a password manager.

Do not use the Global API Key. Copy the Cloudflare **Account ID** from the account dashboard.

### 9.2 Create the GitHub production environment

1. GitHub repository → **Settings → Environments**.
2. Create an environment named exactly `production`.
3. Limit deployment branches to `main`.
4. If your GitHub plan supports protected environments for private repositories, add a required reviewer and prevent self-review when appropriate.

### 9.3 Add Actions secrets and variable

GitHub → **Settings → Secrets and variables → Actions → Secrets**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

In the **Variables** tab add:

- `VITE_GAME_SERVER_URL` = exact Render origin, for example `https://markets-and-makers-authority.onrender.com`

The Render URL is public and therefore a variable, not a secret.

## 10. Deploy the browser to Cloudflare

1. GitHub → **Actions → Deploy browser game to Cloudflare**.
2. Select **Run workflow** on `main`.
3. Approve `production` if you enabled approval.
4. Wait for install, tests, build, and Wrangler deployment to pass.
5. Copy the deployed URL from the workflow output.

The Worker is named `markets-and-makers-game`; the URL should resemble:

```text
https://markets-and-makers-game.YOUR_SUBDOMAIN.workers.dev
```

Open it in a private/incognito window to avoid stale cached code.

## 11. Close the CORS loop

Render accepts browser HTTP/WebSocket traffic only from exact `CLIENT_ORIGINS`.

1. Copy the Cloudflare origin only: scheme plus host, no path or trailing slash.
2. Render → authority service → **Environment**.
3. Set `CLIENT_ORIGINS` to that origin.
4. If using both a custom domain and `workers.dev`, use a comma-separated list:

```text
https://play.example.com,https://markets-and-makers-game.example.workers.dev
```

5. Save and deploy Render.
6. Refresh the Cloudflare game.

Never “fix” CORS with `CLIENT_ORIGINS=*`.

## 12. Configure Helius on devnet

Do this only after the normal game stack works.

### 12.1 Create the devnet project

1. Sign in to Helius.
2. Create a Markets & Makers project.
3. Use **devnet** endpoints for this environment.
4. Create/copy its API key and store it securely.
5. Set Render `HELIUS_API_KEY` to that key.
6. Keep `SOLANA_NETWORK=devnet`.

The key belongs only in Render—never Cloudflare, GitHub variables, browser code, or a `VITE_*` value.

### 12.2 Configure a devnet test mint

Use a separate devnet test mint. Do not point this environment to a real pump.fun/mainnet token.

1. Create/select the reviewed devnet test mint.
2. Copy its public mint address.
3. Set Render `MM_TOKEN_MINT` to it.
4. Save and redeploy.
5. `/health` should now say `chain: "read-only-ready"`.
6. `/api/public-config` must still say `devnet` and `read-only`.

Test a public devnet wallet:

```bash
curl "https://YOUR_RENDER_HOST/api/chain/balance?owner=PUBLIC_DEVNET_WALLET"
```

This only reads token balance. It cannot sign, transfer, credit, or withdraw.

## 13. Configure the authenticated Helius webhook

### 13.1 Copy the generated secret

1. Render service → environment settings.
2. Locate generated `HELIUS_WEBHOOK_SECRET`.
3. Copy it directly into Helius webhook configuration.
4. Never copy it into GitHub, Cloudflare, source code, chat, or the client.

### 13.2 Create the webhook

Create an **Enhanced Transaction** webhook in Helius:

- Network/type: devnet enhanced transaction
- URL: `https://YOUR_RENDER_HOST/webhooks/helius`
- Authorization header: exact `HELIUS_WEBHOOK_SECRET`
- Addresses: only reviewed devnet treasury, mint, and relevant token accounts

Keep address scope small. Valid deliveries return HTTP `202` similar to:

```json
{
  "received": 1,
  "accepted": 1,
  "creditsGranted": 0,
  "reviewRequired": true
}
```

This is intentional. Events are stored idempotently by transaction signature but grant no in-game credits.

### 13.3 Test the boundary

1. Send a test without Authorization; expect `401`.
2. Send a Helius dashboard test with correct authorization; expect `202`.
3. Deliver the same transaction signature twice; the duplicate must not create a second record.
4. Inspect Render logs and Helius delivery history.

Never paste the webhook secret into a shared command or commit.

## 14. End-to-end acceptance test

### Infrastructure

- [ ] GitHub `main` CI is green.
- [ ] Render `/health` returns HTTP 200.
- [ ] PostgreSQL reports `ready`.
- [ ] Cloudflare loads in a private browser.
- [ ] No missing GLBs, scripts, or CORS errors appear.
- [ ] Public config says `devnet` and `read-only`.
- [ ] No secret appears in downloaded JS, HTML, responses, or source maps.

### Realtime authority

- [ ] Open two separate browser sessions.
- [ ] Both connect to `wss://YOUR_RENDER_HOST/room`.
- [ ] Welcome message says `authority: "render-zone"`.
- [ ] Each sees the other's movement snapshots.
- [ ] Refresh/reconnect does not create uncontrolled duplicates.
- [ ] An unapproved origin cannot connect.

### Database and chain boundary

- [ ] Migration completed without errors.
- [ ] Duplicate Helius signature is stored once.
- [ ] Webhook always reports `creditsGranted: 0`.
- [ ] Server contains no wallet private key or seed phrase.
- [ ] Client cannot alter authoritative Coin, `$MM`, inventory, or production results.

### Browser performance

- [ ] Target low-end device maintains at least 30 FPS in spawn.
- [ ] Switching views does not continually grow memory.
- [ ] GLBs/static assets load and then benefit from browser/CDN caching.

Record date, Git SHA, Render deploy ID, Cloudflare deployment ID, tester, and result for every release candidate.

## 15. Normal release procedure

1. Create a feature branch.
2. Make and test the change locally.
3. Push and open a pull request.
4. Wait for both CI jobs.
5. Review code, migrations, asset size, and security impact.
6. Merge to `main`.
7. Render deploys after checks pass.
8. Verify `/health` and Render logs.
9. Manually run the Cloudflare workflow.
10. Perform the end-to-end smoke test.
11. Record release identifiers.

Keep Cloudflare deployment manual so server health can be verified before publishing a potentially incompatible client.

## 16. Monitoring and operations

### Daily during tests

- Check Render health, deploys, CPU/memory, restarts, and DB connections.
- Check Cloudflare errors, request volume, and asset delivery.
- Check Helius webhook failures/retries and RPC usage.
- Review server errors without logging authorization headers or private data.

### Weekly

- Review Dependabot updates.
- Confirm backup/restore features for the selected Render DB plan.
- Remove unnecessary account access.
- Review Cloudflare/Helius token scopes and usage.
- Reconcile ledgers after economic commands exist.

### Secret rotation

- Rotate Cloudflare API token on schedule or suspected exposure.
- Rotate Helius API key, update Render, deploy, then revoke the old key.
- Rotate webhook secret in Render and Helius together; pause delivery during the change if needed.
- Never rotate only one side and assume traffic continues.

## 17. Rollback and incidents

### Bad browser deployment

1. Stop inviting traffic.
2. Roll back in Cloudflare deployment history, or revert the Git commit and rerun the manual workflow.
3. Verify loading and authority connection.
4. Preserve logs and record the incident.

### Bad Render deployment

1. Roll back to the last known-good Render deploy.
2. Verify `/health`, WebSocket, and migrations.
3. For a bad migration, do not improvise destructive SQL. Use the verified backup/PITR option for the plan or a reviewed forward migration.
4. Check whether rollback disabled auto-deploy; re-enable it only after the fix merges.

### Helius storm/authentication failure

1. Pause the Helius webhook.
2. Preserve delivery and server logs.
3. Rotate the secret if exposure is suspected.
4. Correct filters/configuration.
5. Replay only reviewed events; keep signature idempotency.

### Suspected economic exploit

1. Disable deposits, settlement, withdrawals, and token-credit workers first.
2. Keep the game read-only or offline if needed.
3. Preserve ledgers, command receipts, request IDs, logs, and deploy IDs.
4. Reconcile PostgreSQL against chain events.
5. Do not reverse/reimburse on-chain activity until legal, accounting, and security review.

## 18. Mainnet and real `$MM` gate

This runbook is not authorization to launch a real-money economy. Before changing to `mainnet`, enabling pump.fun `$MM`, deposits, payouts, or withdrawals, require:

- Qualified legal review for each target jurisdiction: securities, gambling, consumer, tax, AML/KYC, sanctions, age, and marketing rules.
- Terms, Privacy Policy, risk disclosures, support/refund rules, and prohibited jurisdictions.
- Independent security review of wallet, custody, deposit, settlement, withdrawal, and admin flows.
- Multisignature treasury custody, limited hot-wallet balances, role separation, and approval thresholds—not one mayor-controlled hot wallet.
- Double-entry ledger invariants, idempotency, reconciliation, audit logs, withdrawal queues/caps/cooldowns, and emergency pause.
- Simulations for treasury depletion, bots/Sybil attacks, circular trades, price collapse, bank runs, thin liquidity, tax changes, and procurement abuse.
- No promise of profit, returns, appreciation, customer demand, or liquidity.
- Closed devnet and independent penetration/economy testing with critical findings resolved.

After written approval, mainnet should use a **separate** Render environment, Helius project/key/webhook, Cloudflare configuration, and deployment approval. Never convert devnet to mainnet by casually changing one variable.

## 19. Complete now versus still required

### Ready with this runbook

- Browser world and existing 3D assets
- Cloudflare asset delivery
- Render Node authority foundation
- 10 Hz WebSocket movement/presence
- PostgreSQL schema/migrations
- Helius devnet read-only balance path
- Authenticated idempotent webhook inbox with zero credits
- GitHub CI and manual Cloudflare deployment

### Required for the full economy

- ~~Accounts/authentication and secure wallet linking~~ — done: wallet-signed
  challenge/response sessions (`/api/auth/*`), one wallet to one player, tokens
  stored only as a hash. `MM_MARKET_ROUTES` remains as a circuit breaker.
- ~~Shared prices, demand and settlement~~ — done: districts own price and demand
  state, and `/api/economy/sell|buy` settle on the ledger inside one transaction.
- Server-authoritative plot leasing/build validation
- Business interiors, equipment upgrades, capacity, and recipes
- Inventory, production jobs, market, NPC demand, taxes, and government procurement
- Double-entry settlement and admin controls
- Island scaling, reconnect ownership, handoff, and load tests
- Moderation, support, analytics, backups, disaster drills, and abuse controls
- Mainnet legal/security/economic approval

The next safe milestone is a **closed, devnet, no-cash-out vertical slice**, not a public real-token economy.

## 20. Official references

- [GitHub: create a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
- [GitHub Actions: Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Render Infrastructure as Code](https://render.com/docs/infrastructure-as-code)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render GitHub integration](https://render.com/docs/github)
- [Render environment variables](https://render.com/docs/configure-environment-variables)
- [Render deployment behavior](https://render.com/docs/deploys)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare external CI/CD](https://developers.cloudflare.com/workers/ci-cd/external-cicd/)
- [Cloudflare Wrangler Action](https://github.com/cloudflare/wrangler-action)
- [Helius authentication](https://www.helius.dev/docs/api-reference/authentication)
- [Helius endpoints](https://www.helius.dev/docs/api-reference/endpoints)
- [Helius webhooks](https://www.helius.dev/docs/webhooks)
- [Helius webhook authorization](https://www.helius.dev/docs/faqs/webhooks)
