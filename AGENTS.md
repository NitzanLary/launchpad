# Agent Handoff Summaries

## 1. Testing Agent — Phase 0 Verification

### What was built

Phase 0 is the foundation of LaunchPad: a Turborepo monorepo with a Next.js 15 dashboard, Prisma schema, Auth.js login, Inngest pipeline stubs, and shared packages. No external services are wired up yet — this phase is purely about scaffolding, compilation, and structure.

### What to test

**Build verification:**
- Run `cd apps/web && npx next build` — must compile with zero errors. This is the single most important check. All routes should appear in the output (/, /login, /projects, /projects/[projectId], /projects/new, /settings, plus 4 API routes).
- Run `cd apps/web && npx prisma generate` — must succeed and produce a Prisma client.

**Prisma schema validation:**
- Run `cd apps/web && npx prisma validate` — schema must parse without errors.
- Verify all 13 models exist: User, Account, Session, VerificationToken, OAuthConnection, Project, Environment, PreviewSchema, Deploy, GuardResult, MigrationLog, Extension.
- Verify all enums exist: OAuthProvider, ProjectStatus, EnvironmentType, PreviewStatus, DeployType, DeployStatus, GuardStatus, MigrationStatus, ExtensionStatus.
- Check that encrypted fields (accessTokenEnc, refreshTokenEnc, supabaseDbPassword, supabaseServiceKey, connectionString, credentialsEnc) use the `Bytes` type.

**Package structure:**
- Verify `packages/shared/src/index.ts` exports from types, constants, and errors.
- Verify `packages/guards/src/index.ts` exports runGuards and all 4 guards (structureGuard, configGuard, migrationGuard, secretGuard).
- Verify `packages/cli/src/index.ts` defines 6 commands: dev, validate, status, add, db:reset, logs.
- Check that `@launchpad/shared` and `@launchpad/guards` are listed as workspace dependencies in `apps/web/package.json`.

**App structure (file existence checks):**
- Dashboard layout: `src/app/(dashboard)/layout.tsx` — must import `auth()` and redirect to `/login` if no session.
- Auth route: `src/app/api/auth/[...nextauth]/route.ts` — must re-export handlers from `@/lib/auth`.
- Webhook route: `src/app/api/webhooks/github/route.ts` — must have HMAC signature verification using `x-hub-signature-256`.
- Inngest route: `src/app/api/inngest/route.ts` — must register all 5 functions (projectCreate, pipelinePreview, pipelineStaging, pipelineProduction, cleanupStalePreviews).
- Projects API: `src/app/api/projects/route.ts` — must have both GET and POST handlers, POST must check project limit (max 1).

**Encryption module:**
- `src/lib/encryption.ts` — verify `encrypt()` returns a Buffer with format: IV (12 bytes) + ciphertext + auth tag (16 bytes). Verify `decrypt(encrypt(plaintext))` roundtrips correctly. Verify it throws if `ENCRYPTION_KEY` is missing or wrong length.

**Inngest function structure:**
- All 5 functions in `src/lib/inngest/functions/` should parse as valid TypeScript.
- `project-create.ts` should have an `onFailure` handler that sets project status to ERROR.
- `pipeline-preview.ts` should check `MAX_PREVIEW_SCHEMAS` limit before proceeding.
- `cleanup-stale-previews.ts` should use a cron trigger (`0 * * * *`).

**What NOT to test:**
- Do not attempt to start the dev server or hit API routes — there's no database connected yet (no DATABASE_URL).
- Do not test OAuth flows — GitHub OAuth requires client ID/secret which aren't configured.
- Do not test Inngest event dispatching — requires Inngest dev server or signing key.
- The integration clients (`src/lib/integrations/`) don't exist yet — that's Phase 2.

### Key files

| File | Purpose |
|---|---|
| `apps/web/prisma/schema.prisma` | Database schema (13 models) |
| `apps/web/src/lib/auth.ts` | Auth.js config |
| `apps/web/src/lib/encryption.ts` | AES-256-GCM module |
| `apps/web/src/lib/inngest/functions/*.ts` | 5 pipeline functions |
| `apps/web/src/app/api/webhooks/github/route.ts` | Webhook handler |
| `apps/web/src/app/api/projects/route.ts` | Projects API |
| `packages/shared/src/constants.ts` | Platform constants (limits, prefixes) |
| `packages/guards/src/*.ts` | 4 guard implementations + runner |

---

## 2. Testing Agent — Phase 1 Verification

### What was built

Phase 1 adds OAuth integration for all three external services (GitHub, Vercel, Supabase). After Phase 1, LaunchPad can authenticate with each service on behalf of the user, store tokens encrypted, auto-refresh expiring tokens, and validate that the user's Supabase account has the required free project slots. Integration API client classes are also introduced (used by later phases for project creation and deploy pipelines).

### What to test

**Build verification:**
- Run `cd apps/web && npx next build` — must compile with zero errors. All Phase 0 routes should still appear, plus these 6 new routes: `/api/oauth/vercel`, `/api/oauth/vercel/callback`, `/api/oauth/supabase`, `/api/oauth/supabase/callback`, `/api/oauth/disconnect`, `/api/oauth/validate-supabase`.
- Run `cd apps/web && npx prisma generate` — must still succeed (no schema changes in Phase 1, but verify nothing broke).

**Auth.js GitHub token extraction (`src/lib/auth.ts`):**
- Verify the `signIn` callback exists and fires when `account.provider === "github"`.
- Verify it calls `encrypt(account.access_token)` and upserts into `OAuthConnection` with provider `"GITHUB"`.
- Verify it stores `providerAccountId` from the Auth.js account object.
- Verify it handles the case where `account.refresh_token` is null (GitHub classic OAuth tokens don't have refresh tokens).
- Verify `account.scope` is split by comma and trimmed into the `scopes` array.

**OAuth utility module (`src/lib/oauth.ts`):**
- `generateOAuthState("vercel")` must return a string prefixed with `vercel:` and set an HTTP-only cookie named `oauth_state` with `maxAge: 600`.
- `validateOAuthState(state, "vercel")` must return `true` only when the state matches the cookie AND the provider prefix matches. It must always clear the cookie afterward.
- `validateOAuthState(state, "supabase")` must return `false` if the cookie was set for `"vercel"` — cross-provider confusion is blocked.
- `buildAuthorizationUrl("vercel", state, redirectUri)` must produce a URL starting with `https://vercel.com/integrations/oauthclient/authorize` with correct query params (`client_id`, `redirect_uri`, `response_type=code`, `state`). Vercel has no `scope` param.
- `buildAuthorizationUrl("supabase", state, redirectUri)` must produce a URL starting with `https://api.supabase.com/v1/oauth/authorize` with `scope=all`.
- `exchangeCodeForTokens` must POST to the provider's token URL with `application/x-www-form-urlencoded` content type and include `grant_type=authorization_code`.
- `refreshAccessToken` must POST with `grant_type=refresh_token`.
- `getCallbackUrl("vercel", "https://example.com/api/oauth/vercel/callback?code=x")` must return `https://example.com/api/oauth/vercel/callback`.

**Vercel OAuth routes:**
- `GET /api/oauth/vercel` (`src/app/api/oauth/vercel/route.ts`) — must check `auth()` session, return 401 if not authenticated, otherwise redirect to Vercel's authorization URL.
- `GET /api/oauth/vercel/callback` (`src/app/api/oauth/vercel/callback/route.ts`) — must validate state, exchange code, encrypt tokens, and upsert into `OAuthConnection` with provider `"VERCEL"`. Must redirect to `/settings?connected=vercel` on success. Must redirect to `/settings?error=...` on failure. Must use `tokens.team_id || tokens.user_id || "vercel-user"` as providerAccountId.

**Supabase OAuth routes:**
- `GET /api/oauth/supabase` (`src/app/api/oauth/supabase/route.ts`) — same auth check pattern as Vercel. Must redirect to Supabase's authorization URL.
- `GET /api/oauth/supabase/callback` (`src/app/api/oauth/supabase/callback/route.ts`) — must validate state, exchange code, encrypt tokens, upsert into `OAuthConnection` with provider `"SUPABASE"` and `scopes: ["all"]`. After storing tokens, must call `SupabaseClient.listProjects()` to validate account. If projects exist, must redirect to `/settings?connected=supabase&warning=supabase_slots_full`. If 0 projects, redirect to `/settings?connected=supabase`.

**Disconnect route (`src/app/api/oauth/disconnect/route.ts`):**
- `POST /api/oauth/disconnect` must accept `{ provider: "VERCEL" | "SUPABASE" }` in the body.
- Must return 400 if `provider === "GITHUB"` with message about sign-in provider.
- Must return 400 if user has active projects (status `CREATING` or `ACTIVE`) when disconnecting Vercel or Supabase.
- Must delete the `OAuthConnection` record and return `{ success: true }` on success.

**Supabase validation route (`src/app/api/oauth/validate-supabase/route.ts`):**
- `GET /api/oauth/validate-supabase` must load the Supabase token via `getProviderToken()`, instantiate `SupabaseClient`, call `countActiveProjects()`, and return `{ valid: boolean, activeProjectCount: number, message: string }`.
- If no Supabase connection exists, must return 400 with TokenError details.

**Token management module (`src/lib/tokens.ts`):**
- `getProviderToken(userId, "GITHUB")` must load and decrypt the token. Since GitHub has no refresh (PROVIDER_TO_KEY maps to null), an expired token must throw `TokenError` with code `"TOKEN_EXPIRED"`.
- `getProviderToken(userId, "VERCEL")` must auto-refresh if `tokenExpiresAt` is within 5 minutes of now (`EXPIRY_BUFFER_MS = 300000`). Refresh must call `refreshAccessToken("vercel", refreshToken)`, re-encrypt both tokens, and update the DB record.
- `getProviderToken` must throw `TokenError` with code `"NOT_CONNECTED"` if no OAuthConnection exists.
- `hasConnection(userId, provider)` must return `true`/`false` based on existence of the record (select only `id`).
- `TokenError` must be a proper subclass of `Error` with a `code` property (`"NOT_CONNECTED" | "TOKEN_EXPIRED" | "REFRESH_FAILED"`).

**Encryption module (`src/lib/encryption.ts`):**
- `encrypt()` return type must be `Uint8Array<ArrayBuffer>` (not `Buffer`, not `Uint8Array<ArrayBufferLike>`). This is required for Prisma `Bytes` field compatibility.
- `decrypt()` must accept `Uint8Array` and convert to Buffer internally.
- Verify `decrypt(encrypt(plaintext))` roundtrips correctly (same test as Phase 0 but with the new return type).

**Integration client classes (`src/lib/integrations/`):**
- `GitHubClient` — constructor takes `accessToken`. Must have methods: `getUser()`, `createRepo()`, `createWebhook()`, `putFileContents()`. All methods must use `Authorization: Bearer` header and `X-GitHub-Api-Version: 2022-11-28`.
- `VercelClient` — constructor takes `accessToken`. Must have methods: `getUser()`, `listProjects()`, `createProject()`, `setEnvVars()`, `createDeployment()`, `getDeployment()`. Must use `Authorization: Bearer` header.
- `SupabaseClient` — constructor takes `accessToken`. Must have methods: `listProjects()`, `createProject()`, `getProjectApiKeys()`, `getProjectDatabase()`, `deleteProject()`, `listOrganizations()`, `countActiveProjects()`. `countActiveProjects()` must filter by status `ACTIVE_HEALTHY` or `COMING_UP`.
- `src/lib/integrations/index.ts` must re-export all three client classes.

**Settings page (`src/app/(dashboard)/settings/page.tsx` + `connected-accounts.tsx`):**
- The server component must query `OAuthConnection` records and pass a serialized `connectionMap` to the client component.
- The client component `ConnectedAccounts` must render 3 provider cards (GitHub, Vercel, Supabase).
- GitHub card must show "Via sign-in" badge (no connect/disconnect buttons).
- Vercel and Supabase cards must show "Connect" link (pointing to `/api/oauth/vercel` and `/api/oauth/supabase` respectively) when not connected.
- When connected, must show "Connected" badge, account identifier, and "Disconnect" button.
- When token is expired, must show "(token expired)" warning and a "Reconnect" link.
- Must read URL search params (`connected`, `error`, `warning`) from the OAuth callback redirect and display appropriate notifications (green for success, yellow for `supabase_slots_full` warning, red for errors).
- Must clean URL params after reading via `router.replace("/settings")`.
- Disconnect must call `POST /api/oauth/disconnect` and show error if user has active projects.
- `ConnectedAccounts` must be wrapped in `<Suspense>` (required because it uses `useSearchParams`).

**Environment variables (`apps/web/.env.example`):**
- Must include `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`, `SUPABASE_CLIENT_ID`, `SUPABASE_CLIENT_SECRET` as new entries.

**What NOT to test:**
- Do not attempt actual OAuth flows — there are no real OAuth app credentials configured.
- Do not test token exchange against real Vercel/Supabase APIs.
- Do not test the dev server or hit API routes live — there's no database connected yet.
- Do not test the integration client methods against real APIs — they are typed stubs for Phase 2.

### Key files

| File | Purpose |
|---|---|
| `apps/web/src/lib/auth.ts` | Auth.js config — now captures GitHub token in signIn callback |
| `apps/web/src/lib/oauth.ts` | OAuth utilities: state/CSRF, authorization URLs, token exchange, refresh |
| `apps/web/src/lib/tokens.ts` | Token lifecycle: load, decrypt, auto-refresh, re-encrypt |
| `apps/web/src/lib/encryption.ts` | AES-256-GCM — updated to return `Uint8Array<ArrayBuffer>` |
| `apps/web/src/lib/integrations/github.ts` | GitHub API client class |
| `apps/web/src/lib/integrations/vercel.ts` | Vercel API client class |
| `apps/web/src/lib/integrations/supabase.ts` | Supabase Management API client class |
| `apps/web/src/lib/integrations/index.ts` | Barrel export for integration clients |
| `apps/web/src/app/api/oauth/vercel/route.ts` | Vercel OAuth initiation |
| `apps/web/src/app/api/oauth/vercel/callback/route.ts` | Vercel OAuth callback |
| `apps/web/src/app/api/oauth/supabase/route.ts` | Supabase OAuth initiation |
| `apps/web/src/app/api/oauth/supabase/callback/route.ts` | Supabase OAuth callback + account validation |
| `apps/web/src/app/api/oauth/disconnect/route.ts` | Disconnect provider (blocks if active projects) |
| `apps/web/src/app/api/oauth/validate-supabase/route.ts` | On-demand Supabase slot validation |
| `apps/web/src/app/(dashboard)/settings/page.tsx` | Settings page (server component, queries connections) |
| `apps/web/src/app/(dashboard)/settings/connected-accounts.tsx` | Settings UI (client component, connect/disconnect/notifications) |
| `apps/web/.env.example` | Updated with Vercel + Supabase OAuth client vars |

---

## 3. Planning Agent — Phase 1 Design Brief (COMPLETED — kept for reference)

### What Phase 1 is

Phase 1 adds OAuth integration for Vercel and Supabase. After Phase 1, LaunchPad can authenticate with all three external services (GitHub, Vercel, Supabase) on behalf of the user and make API calls using their tokens.

GitHub OAuth is already working via Auth.js (sign-in). But that only gives us a session — we still need to store the GitHub token in OAuthConnection for API calls (repo creation, webhook management). Phase 1 must handle this too.

### What needs to be designed

**1. Vercel OAuth flow**

Vercel uses standard OAuth2. Design the flow:
- User clicks "Connect Vercel" on the settings page → redirect to Vercel authorization URL.
- Vercel redirects back to a callback route (e.g., `/api/oauth/vercel/callback`).
- Exchange the code for access token + (possibly) refresh token.
- Encrypt tokens using `encrypt()` from `src/lib/encryption.ts`.
- Store in `OAuthConnection` model (provider: VERCEL).

Key questions to resolve:
- Should we use a Vercel Integration or plain OAuth2 app? Integrations give broader permissions but are more complex. Plain OAuth2 may suffice for MVP.
- What scopes/permissions do we need? At minimum: create projects, manage deployments, manage environment variables, read domains.
- Token refresh strategy — does Vercel issue refresh tokens? How do we handle expiry?

**2. Supabase OAuth flow**

Supabase Management API uses OAuth2 for third-party access. Design the flow:
- User clicks "Connect Supabase" → redirect to Supabase authorization URL.
- Callback at `/api/oauth/supabase/callback`.
- Exchange code for tokens, encrypt, store in OAuthConnection.

Key questions:
- Supabase Management API OAuth — verify the exact authorization URL, token endpoint, and available scopes.
- The PRD requires checking that the user has 0 existing Supabase projects before allowing project creation. This check uses the Management API (`GET /v1/projects`). Design when and where this validation happens (on connect? on project creation? both?).

**3. GitHub token extraction from Auth.js**

Auth.js already handles GitHub OAuth for sign-in, but the access token it receives needs to be captured and stored in OAuthConnection for later API use (creating repos, pushing files, registering webhooks). Design how to:
- Extract the GitHub access token from the Auth.js OAuth callback (via the `jwt` or `signIn` callback).
- Encrypt and store it in OAuthConnection.
- Ensure the token has the `repo` scope (already requested in `src/lib/auth.ts`).

**4. Token refresh and expiry handling**

Design a consistent pattern for all three providers:
- How integration clients will load and decrypt tokens.
- How to detect expired tokens and trigger refresh.
- What happens if a refresh fails (re-auth prompt on the dashboard).

**5. Settings page — Connected Accounts UI**

The settings page at `src/app/(dashboard)/settings/page.tsx` already shows connection status. Design:
- Connect buttons that initiate the OAuth flows.
- Disconnect functionality.
- Re-auth flow when tokens expire or scopes change.
- Visual feedback: connected with account identifier (GitHub username, Vercel team name, Supabase org).

**6. Supabase account validation**

Per the PRD (Section 5.1, step 3): before allowing project creation, verify the user's Supabase account has 0 existing projects (free tier allows max 2, LaunchPad needs both). Design:
- When to run this check (on Supabase connect, and again on project creation).
- What to show if validation fails.
- Whether to cache the result or always check live.

### Existing code to build on

| What exists | Where | Notes |
|---|---|---|
| Auth.js config | `apps/web/src/lib/auth.ts` | GitHub provider with `repo` scope. Add a callback to extract the access token. |
| OAuthConnection model | `apps/web/prisma/schema.prisma` | Ready to use. Fields: provider, accessTokenEnc, refreshTokenEnc, tokenExpiresAt, scopes. |
| Encryption module | `apps/web/src/lib/encryption.ts` | `encrypt(string) → Buffer`, `decrypt(Buffer) → string`. Working and tested. |
| Settings page | `apps/web/src/app/(dashboard)/settings/page.tsx` | Shows connection status per provider. Needs connect/disconnect buttons wired up. |
| Integrations directory | `apps/web/src/lib/integrations/` | Empty. This is where GitHub, Vercel, and Supabase API client classes should go. |
| Error messages | `packages/shared/src/errors.ts` | `SUPABASE_SLOTS_FULL` and `PROJECT_LIMIT_REACHED` messages already defined. |
| Constants | `packages/shared/src/constants.ts` | Platform limits already defined. |

### Constraints

- Vercel Hobby tier — the LaunchPad platform itself runs on Hobby. OAuth callbacks must complete within the serverless function timeout.
- No `.env` files in user projects — all secrets are managed by LaunchPad and injected via Vercel env vars.
- Free tier: 1 LaunchPad project per user = 2 Supabase projects (staging + prod). Validate Supabase slots before project creation.
- Encrypted token storage is mandatory — never store plaintext tokens in the database.

### Expected deliverables from the plan

1. OAuth callback route structure for Vercel and Supabase.
2. Strategy for extracting GitHub token from Auth.js flow.
3. Token lifecycle management pattern (load, decrypt, check expiry, refresh, re-encrypt).
4. API client class interface for each provider (what methods they expose).
5. Settings page UX flow for connect/disconnect/re-auth.
6. Supabase project slot validation logic.

---

## 4. Planning Agent — Phase 2 Design Brief

### What Phase 2 is

Phase 2 wires up the project creation pipeline — the `project-create` Inngest function. When a user clicks "New Project" and provides a project name, LaunchPad must orchestrate an 8-step process across GitHub, Supabase, and Vercel to scaffold a fully configured repo, provision databases, create a Vercel project, and inject environment variables. At the end of Phase 2, clicking "New Project" produces a ready-to-clone repo connected to staging and production databases with working deploys.

### What already exists

**Integration clients (Phase 1):**

The three API client classes are in `apps/web/src/lib/integrations/`. They are typed and structured but have not been tested against real APIs yet. Each takes an `accessToken` in its constructor.

| Client | File | Key methods |
|---|---|---|
| `GitHubClient` | `src/lib/integrations/github.ts` | `getUser()`, `createRepo(name)`, `createWebhook(owner, repo, url, secret)`, `putFileContents(owner, repo, path, content, message, sha?)` |
| `VercelClient` | `src/lib/integrations/vercel.ts` | `getUser()`, `listProjects()`, `createProject(name, githubRepoId)`, `setEnvVars(projectId, envVars[])`, `createDeployment(projectId, ref, target?)`, `getDeployment(deploymentId)` |
| `SupabaseClient` | `src/lib/integrations/supabase.ts` | `listProjects()`, `createProject(name, orgId, dbPassword, region?)`, `getProjectApiKeys(ref)`, `getProjectDatabase(ref)`, `deleteProject(ref)`, `listOrganizations()`, `countActiveProjects()` |

**Token management (Phase 1):**

`src/lib/tokens.ts` exports `getProviderToken(userId, provider)` which loads, decrypts, and auto-refreshes tokens. Pipeline functions should use this to get tokens before instantiating API clients.

**Inngest project-create function (Phase 0 — scaffolded with TODOs):**

`src/lib/inngest/functions/project-create.ts` already has the step structure and `onFailure` handler. The 8 steps are stubbed. Read this file to understand the existing step skeleton.

**Inngest client:**

`src/lib/inngest/client.ts` — instantiated with `id: "launchpad"`.

**Project creation API route:**

`src/app/api/projects/route.ts` already handles `POST /api/projects`. It validates the name, generates a slug, checks the 1-project limit, creates a Project record with status `CREATING`, and dispatches the `project/create.requested` Inngest event with `{ projectId, userId, name, slug }`.

**Prisma schema:**

The `Project`, `Environment`, and `OAuthConnection` models are all defined. The `Environment` model has fields for Supabase credentials (supabaseProjectId, supabaseDbHost, supabaseDbPassword, supabaseAnonKey, supabaseServiceKey, supabaseUrl, dbSchema, vercelEnvTarget). Sensitive fields use `Bytes` type (encrypted).

**Scaffolded template directory:**

`src/lib/template/` exists but is empty. This is where the project template generator should go.

**Error messages:**

`packages/shared/src/errors.ts` has `SUPABASE_SLOTS_FULL` and `PROJECT_LIMIT_REACHED` messages.

**Constants:**

`packages/shared/src/constants.ts` has `TEMPLATE_NAME`, `TEMPLATE_VERSION`, `LAUNCHPAD_VERSION`, `MANAGED_FILES`, `CLAUDE_MD_DELIMITER`, and all limit constants.

### What needs to be designed

**1. Project creation pipeline — `project-create.ts` step implementation**

The 8 steps that need implementation (see `src/lib/inngest/functions/project-create.ts` for the existing skeleton):

1. **Validate prerequisites** — Check all 3 OAuth connections exist and tokens are valid. Re-validate Supabase slots (0 existing projects). Fail fast if anything is missing.
2. **Create GitHub repo** — Use `GitHubClient.createRepo(slug)`. Store `githubRepoId` and `githubRepoUrl` on the Project record.
3. **Create Supabase staging project** — Use `SupabaseClient.createProject(slug + "-staging", orgId, generatedPassword)`. Wait for project to become ready (Supabase projects take ~60s to provision — design polling or webhook strategy). Store all credentials in an `Environment` record (type: STAGING).
4. **Create Supabase production project** — Same as staging but with `slug + "-prod"`. Store in Environment (type: PRODUCTION).
5. **Create Vercel project** — Use `VercelClient.createProject(slug, githubRepoId)`. Store `vercelProjectId` and `vercelProjectUrl` on the Project record.
6. **Inject Vercel env vars** — Use `VercelClient.setEnvVars()` to inject Supabase credentials for both environments. Design which env vars go to which Vercel target (production vs preview+development). Required vars: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
7. **Push template to GitHub** — Generate the scaffolded project template (see Section 6 of PRD) and push all files to the repo using `GitHubClient.putFileContents()`. This includes `CLAUDE.md`, `.launchpad/config.json`, `package.json`, Prisma schema, Supabase clients, etc.
8. **Register GitHub webhook** — Use `GitHubClient.createWebhook()` to listen for push events. Store `githubWebhookId` on the Project record. Set project status to `ACTIVE`.

Key design questions:
- **Supabase provisioning wait** — Supabase projects take ~60 seconds to become ready. Each Inngest step has a 60s serverless timeout on Hobby. Design whether to use `step.sleep()` + polling, `step.waitForEvent()`, or a retry loop within a step. Consider that `getProjectApiKeys()` and `getProjectDatabase()` won't return data until the project is ready.
- **Failure and rollback** — The `onFailure` handler sets project status to `ERROR`. But what about partial cleanup? If step 4 fails, step 3 already created a Supabase project. Design whether to attempt cleanup of partial resources or leave them for manual cleanup. Consider that the user's Supabase account now has an orphaned project consuming a slot.
- **Template generation** — Design the template generator in `src/lib/template/`. It needs to produce all files from PRD Section 6 with project-specific values interpolated (project name, Supabase URL, etc.). The project already has `handlebars` as a dependency. Design whether to use Handlebars templates or simple string interpolation.
- **DATABASE_URL format** — Per PRD Section 18.2, the connection string must use Supavisor port 6543 with `pgbouncer=true&connection_limit=1`. The staging DATABASE_URL for preview+development targets should use `?schema=public`. Design the exact connection string construction.
- **GitHub file push strategy** — `putFileContents()` pushes one file at a time via the Contents API. For a full template (~15 files), this means 15 sequential API calls. Consider whether to use the Git Trees API instead for a single commit with all files, or if sequential pushes are acceptable for project creation.
- **Webhook secret** — Each project needs a unique webhook secret for HMAC verification. Design where to generate and store this. The webhook handler at `src/app/api/webhooks/github/route.ts` currently reads `GITHUB_WEBHOOK_SECRET` from env — but each project needs its own secret.

**2. Template generator (`src/lib/template/`)**

Must generate all files listed in PRD Section 6:
- `CLAUDE.md` — Platform zone with project name interpolated + user zone. Must compute and store the platform zone hash for config guard verification.
- `.launchpad/config.json` — Populated with project ID, Supabase project IDs, template version, managed files list, CLAUDE.md hash.
- `package.json` — With Next.js, Prisma, Supabase client dependencies pre-configured.
- `prisma/schema.prisma` — Base schema with `datasource` pointing to `env("DATABASE_URL")`.
- `src/lib/supabase.ts` and `src/lib/supabase-server.ts` — Pre-configured Supabase clients.
- `src/lib/prisma.ts` — Prisma client singleton.
- `src/app/layout.tsx`, `src/app/page.tsx` — Basic Next.js app shell.
- `vercel.json` — Minimal Vercel config.
- `tsconfig.json`, `.gitignore`, `README.md`.

Design the template format (Handlebars templates vs string literals) and the data model passed to the generator.

**3. Project detail page updates**

`src/app/(dashboard)/projects/[projectId]/page.tsx` currently shows project info including clone instructions for ACTIVE projects. After Phase 2, verify this page works correctly when a project transitions from CREATING → ACTIVE. The project status should update in real-time or on page refresh.

**4. Pre-creation validation in the API route**

`src/app/api/projects/route.ts` currently checks the 1-project limit but does NOT check OAuth connections or Supabase slots. Design whether to add these checks to the API route (fail fast before dispatching Inngest) or rely on the pipeline's step 1 validation. Consider UX: failing in the API route gives immediate feedback; failing in the pipeline means the user sees a CREATING project that transitions to ERROR.

### Existing code to build on

| What exists | Where | Notes |
|---|---|---|
| Integration clients | `src/lib/integrations/*.ts` | Phase 1 — typed, not yet tested against real APIs |
| Token management | `src/lib/tokens.ts` | `getProviderToken()` handles load, decrypt, refresh |
| Project-create function | `src/lib/inngest/functions/project-create.ts` | Step skeleton with TODOs. Has `onFailure` handler |
| Projects API route | `src/app/api/projects/route.ts` | POST dispatches `project/create.requested` event |
| Inngest client | `src/lib/inngest/client.ts` | Initialized, registered in `/api/inngest/route.ts` |
| Prisma schema | `prisma/schema.prisma` | Project, Environment, OAuthConnection models ready |
| Template directory | `src/lib/template/` | Empty — generator goes here |
| Handlebars dependency | `package.json` | Already installed (`handlebars: ^4.7.8`) |
| PRD Section 6 | `PRD_DeployPlatform.md` | Full template file listing and CLAUDE.md content |
| CLAUDE.md delimiter | `packages/shared/src/constants.ts` | `CLAUDE_MD_DELIMITER` constant for hash computation |
| Webhook handler | `src/app/api/webhooks/github/route.ts` | HMAC verification using `GITHUB_WEBHOOK_SECRET` env var |

### Constraints

- **Vercel Hobby 60s timeout** — Each Inngest step runs as a separate serverless invocation with a 60s limit. Supabase project provisioning may take longer. Steps must be designed to stay within this limit.
- **Supabase free tier** — Exactly 2 projects allowed. Both consumed by staging + production. No room for error — if creation fails partway, the orphaned project wastes a slot.
- **GitHub API rate limits** — 5,000 requests/hour for authenticated users. Template push of ~15 files is well within limits, but worth noting.
- **Encrypted storage** — All Supabase credentials (db password, service key, connection strings) must be encrypted via `encrypt()` before storing in Environment records. Never store plaintext.
- **Idempotency** — Each Inngest step must be idempotent (safe to retry). If step 3 already created the staging project on a previous attempt, the retry must detect this and skip creation.

### Expected deliverables from the plan

1. Detailed step-by-step implementation plan for each of the 8 pipeline steps, including error handling and idempotency strategy.
2. Supabase provisioning wait strategy (polling interval, max retries, timeout handling).
3. Partial failure cleanup strategy (which resources to tear down if a later step fails).
4. Template generator architecture (file list, data model, Handlebars vs string interpolation).
5. DATABASE_URL construction pattern for staging, production, and preview environments.
6. GitHub file push strategy (Contents API per-file vs Git Trees API bulk commit).
7. Webhook secret generation and per-project storage strategy.
8. Pre-creation validation strategy (API route fast-fail vs pipeline-only).

---

## 5. Testing Agent — Phase 2 Verification

### What was built

Phase 2 implements the project creation pipeline — the 11-step Inngest function that orchestrates GitHub, Supabase, and Vercel to scaffold a fully configured project. It also adds a template generator, Git Trees API methods, pre-creation validation, per-project webhook secrets, and a DATABASE_URL builder.

### What to test

**Build verification:**
- Run `cd apps/web && npx next build` — must compile with zero errors.
- Run `cd apps/web && npx prisma generate` — must succeed.
- Run `cd apps/web && npx prisma validate` — schema must parse without errors.

**Schema changes (verify 4 new fields on Project model):**
- `webhookSecretEnc Bytes?` — encrypted per-project webhook secret
- `githubOwner String?` — GitHub username for API calls
- `supabaseStagingRef String?` — tracks staging Supabase ref for cleanup
- `supabaseProdRef String?` — tracks prod Supabase ref for cleanup

**GitHubClient new methods (`src/lib/integrations/github.ts`):**
- `createBlob(owner, repo, content)` — must POST to `/repos/{o}/{r}/git/blobs` with `{ content, encoding: "utf-8" }`.
- `createTree(owner, repo, tree[])` — must POST to `/repos/{o}/{r}/git/trees`.
- `createCommitObject(owner, repo, message, treeSha, parents[])` — must POST to `/repos/{o}/{r}/git/commits`.
- `createRef(owner, repo, ref, sha)` — must POST to `/repos/{o}/{r}/git/refs`.
- `pushFiles(owner, repo, files[], message)` — must orchestrate blob→tree→commit→ref in correct order. Blobs must be created in parallel via `Promise.all`.
- `deleteRepo(owner, repo)` — must DELETE `/repos/{o}/{r}`.

**VercelClient new method (`src/lib/integrations/vercel.ts`):**
- `deleteProject(projectId)` — must DELETE `/v9/projects/{projectId}`.

**Template generator (`src/lib/template/`):**
- `generateTemplateFiles(data)` must return `{ files: TemplateFile[], claudeMdPlatformHash: string }`.
- Files array must contain at least: CLAUDE.md, .launchpad/config.json, package.json, README.md, prisma/schema.prisma, src/app/layout.tsx, src/app/page.tsx, src/lib/prisma.ts, src/lib/supabase.ts, src/lib/supabase-server.ts, vercel.json, tsconfig.json, .gitignore, and .gitkeep files for empty directories.
- CLAUDE.md must contain the project name from TemplateData.
- CLAUDE.md must include the `CLAUDE_MD_DELIMITER` from `@launchpad/shared`.
- `claudeMdPlatformHash` must be `sha256:{hex}` format, computed from the content above the delimiter.
- `.launchpad/config.json` must include the same hash value as `claude_md_platform_hash`.
- `package.json` must have the project slug as the `name` field.
- `README.md` must include the GitHub owner and project slug in the clone URL.

**DATABASE_URL builder (`src/lib/integrations/supabase.ts`):**
- `buildDatabaseUrl("ref123", "p@ss", "us-east-1")` must return `postgresql://postgres.ref123:p%40ss@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`.
- Password must be URI-encoded.
- Must use `SUPABASE_POOLER_PORT` constant (6543).

**Project creation pipeline (`src/lib/inngest/functions/project-create.ts`):**
- Must have 11 named steps: validate-prerequisites, create-github-repo, create-supabase-staging, create-supabase-production, (sleep), check-supabase-staging-ready, check-supabase-production-ready, create-vercel-project, configure-vercel-env, push-template, register-webhook, finalize-project.
- Function `retries` must be 3 (for Supabase polling).
- `step.sleep("wait-supabase-provision", "45s")` must exist between creation and ready-check steps.
- Step 1 must check all 3 OAuth connections and Supabase slot count.
- Steps 2, 7, 10 must have idempotency checks (query project DB record, skip if already created).
- Steps 3-4 must persist `supabaseStagingRef`/`supabaseProdRef` to project record after creation.
- Steps 5-6 must check `ACTIVE_HEALTHY` status and fetch API keys (`anon` and `service_role`).
- Step 8 must set 8 environment variables on Vercel (4 for preview+development, 4 for production).
- Step 9 must call `generateTemplateFiles()` and `github.pushFiles()`.
- Step 10 must generate a random webhook secret, register it via GitHub API, and store encrypted via `encrypt()`.
- Step 11 must use `encrypt()` for `supabaseDbPassword` and `supabaseServiceKey` (NOT `Buffer.from()`).
- `onFailure` handler must attempt cleanup: delete Supabase staging/prod projects and Vercel project, then set status to ERROR.

**Pre-creation validation (`src/app/api/projects/route.ts`):**
- POST handler must check all 3 OAuth connections via `hasConnection()` before creating the project.
- Must return 400 with missing provider names if any connection is missing.
- Must call `supabase.countActiveProjects()` and return 400 with `ERROR_CODES.SUPABASE_SLOTS_FULL` if > 0.

**Webhook handler (`src/app/api/webhooks/github/route.ts`):**
- Must NOT read `GITHUB_WEBHOOK_SECRET` from environment.
- Must parse payload to extract `repository.id` first.
- Must look up project by `githubRepoId` and decrypt `webhookSecretEnc`.
- Must verify HMAC signature using the per-project secret.
- `verifySignature()` must accept `secret` as a parameter (not read from env).

**Environment variables (`apps/web/.env.example`):**
- Must include `NEXT_PUBLIC_APP_URL`.
- Must NOT include `GITHUB_WEBHOOK_SECRET`.

**What NOT to test:**
- Do not attempt actual OAuth flows or API calls to GitHub/Vercel/Supabase.
- Do not start the dev server or hit API routes live — there's no database connected.
- Do not test Inngest event dispatching — requires Inngest dev server.

### Key files

| File | Purpose |
|---|---|
| `apps/web/prisma/schema.prisma` | 4 new fields on Project model |
| `apps/web/src/lib/inngest/functions/project-create.ts` | Full 11-step project creation pipeline |
| `apps/web/src/lib/integrations/github.ts` | Git Trees API methods + pushFiles + deleteRepo |
| `apps/web/src/lib/integrations/vercel.ts` | deleteProject method |
| `apps/web/src/lib/integrations/supabase.ts` | buildDatabaseUrl export |
| `apps/web/src/lib/integrations/index.ts` | Re-exports buildDatabaseUrl |
| `apps/web/src/lib/template/index.ts` | generateTemplateFiles + hash computation |
| `apps/web/src/lib/template/types.ts` | TemplateData, TemplateFile interfaces |
| `apps/web/src/lib/template/files/claude-md.ts` | CLAUDE.md Handlebars template |
| `apps/web/src/lib/template/files/config-json.ts` | .launchpad/config.json generator |
| `apps/web/src/lib/template/files/package-json.ts` | package.json generator |
| `apps/web/src/lib/template/files/readme.ts` | README.md Handlebars template |
| `apps/web/src/lib/template/files/static.ts` | All static template files |
| `apps/web/src/app/api/projects/route.ts` | Pre-creation validation (OAuth + Supabase slots) |
| `apps/web/src/app/api/webhooks/github/route.ts` | Per-project webhook secret verification |
| `apps/web/.env.example` | NEXT_PUBLIC_APP_URL added, GITHUB_WEBHOOK_SECRET removed |
