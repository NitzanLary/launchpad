# Phase 2 Testing Guide — Project Creation Pipeline

## Overview

Phase 2 implements the project creation pipeline: when a user provides a project name, LaunchPad orchestrates GitHub, Supabase, and Vercel to scaffold a fully configured repo. This guide covers automated unit tests (Vitest), static verification checks, and manual end-to-end testing.

**Components under test:**

| Component | File | What it does |
|-----------|------|--------------|
| Template generator | `src/lib/template/` | Generates ~21 scaffold files with project-specific values, computes CLAUDE.md hash |
| DATABASE_URL builder | `src/lib/integrations/supabase.ts` | Constructs Supavisor pooler connection strings |
| GitHubClient (new methods) | `src/lib/integrations/github.ts` | Git Trees API for bulk file push |
| VercelClient (new method) | `src/lib/integrations/vercel.ts` | `deleteProject()` for cleanup |
| Project creation pipeline | `src/lib/inngest/functions/project-create.ts` | 11-step Inngest function |
| Pre-creation validation | `src/app/api/projects/route.ts` | OAuth + Supabase slot checks |
| Webhook handler | `src/app/api/webhooks/github/route.ts` | Per-project secret verification |
| Prisma schema | `prisma/schema.prisma` | 4 new fields on Project model |

---

## Part 1: Test Setup

Before writing any tests, the testing agent must set up Vitest.

### 1.1 Create Vitest Config

Create `apps/web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@launchpad/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
});
```

**Why:** The `@` alias maps to `src/` (matching the Next.js path alias in `tsconfig.json`), and `@launchpad/shared` resolves the workspace package.

### 1.2 Verify Vitest Runs

```bash
cd apps/web && npx vitest run --passWithNoTests
```

Must exit 0. If there are resolution errors, fix the alias config before continuing.

---

## Part 2: Automated Tests (Vitest)

### 2.1 Template Generator Tests

**File to create:** `apps/web/src/lib/template/__tests__/generate.test.ts`

This is the most important test suite — the template generator is pure logic with no external dependencies.

**Test: generates all required files**

Call `generateTemplateFiles()` with mock data:

```typescript
const mockData: TemplateData = {
  projectName: "My Cool App",
  projectSlug: "my-cool-app",
  projectId: "lp_test123",
  templateVersion: "1.0.0",
  launchpadVersion: "0.1",
  createdAt: "2026-04-08T12:00:00Z",
  supabaseStagingProjectId: "staging-ref-abc",
  supabaseProdProjectId: "prod-ref-xyz",
  githubOwner: "testuser",
};
```

Assert the returned `files` array contains entries with these exact `path` values:
- `CLAUDE.md`
- `.launchpad/config.json`
- `package.json`
- `README.md`
- `prisma/schema.prisma`
- `supabase/seed.sql`
- `src/lib/prisma.ts`
- `src/lib/supabase.ts`
- `src/lib/supabase-server.ts`
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/app/page.tsx`
- `src/app/api/.gitkeep`
- `vercel.json`
- `tsconfig.json`
- `.gitignore`
- `next.config.mjs`
- `tailwind.config.ts`
- `postcss.config.mjs`
- `public/.gitkeep`
- `.launchpad/validators/.gitkeep`

Assert `files.length >= 21`.

**Test: CLAUDE.md contains project name**

Find the `CLAUDE.md` file in the output. Assert its `content` includes the string `"# LaunchPad Project: My Cool App"`.

**Test: CLAUDE.md contains the delimiter**

Import `CLAUDE_MD_DELIMITER` from `@launchpad/shared`. Assert the CLAUDE.md content includes the delimiter string exactly once. Verify the content below the delimiter contains `"## Your Project Notes"`.

**Test: CLAUDE.md platform hash is deterministic**

Call `generateTemplateFiles()` twice with identical `mockData`. Assert `claudeMdPlatformHash` is identical both times.

**Test: CLAUDE.md platform hash format**

Assert `claudeMdPlatformHash` matches the regex `/^sha256:[a-f0-9]{64}$/`.

**Test: config.json contains matching hash**

Parse the `.launchpad/config.json` content as JSON. Assert `parsed.claude_md_platform_hash === claudeMdPlatformHash`.

**Test: config.json structure matches PRD**

Parse the config JSON and assert it contains:
- `version` equals `"0.1"`
- `project_id` equals `"lp_test123"`
- `template` equals `"nextjs-supabase-prisma"`
- `template_version` equals `"1.0.0"`
- `created_at` equals `"2026-04-08T12:00:00Z"`
- `environments.preview.db_provider` equals `"supabase"`
- `environments.preview.db_project_id` equals `"staging-ref-abc"`
- `environments.preview.db_strategy` equals `"isolated_schema"`
- `environments.staging.db_project_id` equals `"staging-ref-abc"`
- `environments.staging.db_schema` equals `"public"`
- `environments.production.db_project_id` equals `"prod-ref-xyz"`
- `environments.production.db_schema` equals `"public"`
- `extensions` is an empty array
- `managed_files` contains `"CLAUDE.md"`, `".launchpad/config.json"`, `"vercel.json"`

**Test: package.json uses project slug as name**

Parse the `package.json` content. Assert `parsed.name === "my-cool-app"`. Assert it includes `next`, `react`, `@prisma/client`, `@supabase/supabase-js` in `dependencies`.

**Test: README includes clone URL with owner**

Assert the README.md content includes `"git clone https://github.com/testuser/my-cool-app.git"`.

**Test: prisma/schema.prisma contains datasource with env**

Assert the schema.prisma content includes `env("DATABASE_URL")` and `provider = "postgresql"`.

**Test: layout.tsx includes project name in metadata**

Assert the layout.tsx content includes `"My Cool App"`.

**Test: .gitignore includes required entries**

Assert the .gitignore content includes `.env*.local`, `.env`, `node_modules`, `.next/`, `.vercel`.

**Test: project name with special characters**

Call with `projectName: "Café & Lounge"`, `projectSlug: "caf-lounge"`. Verify CLAUDE.md renders without error and includes the full project name. Verify package.json uses the slug.

---

### 2.2 DATABASE_URL Builder Tests

**File to create:** `apps/web/src/lib/integrations/__tests__/database-url.test.ts`

**Test: standard URL construction**

```typescript
const url = buildDatabaseUrl("ref123", "mypassword", "us-east-1");
```

Assert it equals:
```
postgresql://postgres.ref123:mypassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**Test: password with special characters is URI-encoded**

```typescript
const url = buildDatabaseUrl("ref123", "p@ss:w0rd/test", "us-east-1");
```

Assert it contains `p%40ss%3Aw0rd%2Ftest` (not the raw special characters). Specifically check that `@`, `:`, and `/` in the password are encoded.

**Test: different regions**

```typescript
const url = buildDatabaseUrl("abc", "pass", "eu-west-2");
```

Assert it contains `aws-0-eu-west-2.pooler.supabase.com`.

**Test: uses correct port constant**

Assert the URL contains `:6543/` (the `SUPABASE_POOLER_PORT` value).

**Test: pgbouncer and connection_limit params**

Assert the URL ends with or contains `?pgbouncer=true&connection_limit=1`.

---

### 2.3 GitHubClient API Methods Tests (HTTP contract)

**File to create:** `apps/web/src/lib/integrations/__tests__/github.test.ts`

These tests mock `global.fetch` and verify the GitHubClient methods send correct HTTP requests. The purpose is to verify request shape and URL construction — not to test GitHub's API.

**Setup:** Before each test, mock `global.fetch` to return a mock `Response`. After each test, restore the original `fetch`.

```typescript
let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = global.fetch;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(""),
  });
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
});
```

**Test: createBlob sends correct request**

```typescript
const client = new GitHubClient("test-token");
fetchMock.mockResolvedValueOnce({
  ok: true,
  json: () => Promise.resolve({ sha: "blob-sha-123" }),
});

const result = await client.createBlob("owner", "repo", "file content");

// Assert fetch was called with correct URL
expect(fetchMock).toHaveBeenCalledWith(
  "https://api.github.com/repos/owner/repo/git/blobs",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ content: "file content", encoding: "utf-8" }),
  })
);
expect(result.sha).toBe("blob-sha-123");
```

Verify the `Authorization: Bearer test-token` header is present.

**Test: createTree sends correct request**

Call `createTree("owner", "repo", [{ path: "file.txt", mode: "100644", type: "blob", sha: "abc" }])`. Assert it POSTs to `/repos/owner/repo/git/trees` with body `{ tree: [...] }`.

**Test: createCommitObject sends correct request**

Call `createCommitObject("owner", "repo", "commit msg", "tree-sha", [])`. Assert it POSTs to `/repos/owner/repo/git/commits` with body `{ message: "commit msg", tree: "tree-sha", parents: [] }`.

**Test: createRef sends correct request**

Call `createRef("owner", "repo", "refs/heads/main", "commit-sha")`. Assert it POSTs to `/repos/owner/repo/git/refs` with body `{ ref: "refs/heads/main", sha: "commit-sha" }`.

**Test: pushFiles orchestrates blob -> tree -> commit -> ref**

Mock `fetch` to return different responses for each call in sequence:
1. First N calls (blobs) — return `{ sha: "blob-sha-N" }`
2. Tree call — return `{ sha: "tree-sha" }`
3. Commit call — return `{ sha: "commit-sha" }`
4. Ref call — return `{}`

Call `pushFiles("owner", "repo", [{ path: "a.txt", content: "aaa" }, { path: "b.txt", content: "bbb" }], "test commit")`.

Assert `fetch` was called at least 5 times (2 blobs + 1 tree + 1 commit + 1 ref). Verify the tree call includes both blobs with `mode: "100644"` and `type: "blob"`. Verify the commit call has `parents: []` (initial commit). Verify the ref call creates `refs/heads/main`.

**Test: deleteRepo sends DELETE request**

Call `deleteRepo("owner", "repo")`. Assert `fetch` was called with method `DELETE` to `https://api.github.com/repos/owner/repo`.

**Test: API error throws with status and body**

Mock `fetch` to return `{ ok: false, status: 422, text: () => "Validation Failed" }`. Call `createRepo("name")`. Assert it throws an error containing `"422"` and `"Validation Failed"`.

---

### 2.4 VercelClient deleteProject Test

**File to create:** `apps/web/src/lib/integrations/__tests__/vercel.test.ts`

**Test: deleteProject sends DELETE to correct URL**

Mock `fetch`. Call `deleteProject("prj_abc123")`. Assert it sends `DELETE` to `https://api.vercel.com/v9/projects/prj_abc123` with `Authorization: Bearer` header.

---

### 2.5 Webhook Handler Tests (per-project secret)

**File to create:** `apps/web/src/app/api/webhooks/github/__tests__/route.test.ts`

These tests verify the webhook handler's signature verification logic. Since the handler imports `prisma` and `inngest`, those must be mocked.

**Setup:** Mock `@/lib/db` (prisma), `@/lib/inngest/client` (inngest), and `@/lib/encryption` (decrypt).

**Test: verifySignature computes correct HMAC**

The `verifySignature` function is not exported, so test it indirectly by constructing a valid webhook payload:

1. Pick a secret: `"test-secret-hex"`
2. Create a payload: `JSON.stringify({ repository: { id: 12345 }, ref: "refs/heads/main", after: "abc123", head_commit: { id: "abc", message: "test", author: { name: "user" } } })`
3. Compute the expected signature: `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`
4. Mock `prisma.project.findFirst` to return `{ id: "proj1", webhookSecretEnc: Buffer.from("encrypted") }`
5. Mock `decrypt` to return `"test-secret-hex"`
6. Mock `prisma.deploy.create` to return `{ id: "deploy1" }`
7. Mock `inngest.send` to resolve

Call the POST handler with the correct signature header. Assert it returns 202 (not 401).

**Test: invalid signature returns 401**

Same as above but with a wrong signature string. Assert it returns 401.

**Test: missing repository ID returns 400**

Send a payload without `repository.id`. Assert it returns 400 with error `"Missing repository ID"`.

**Test: unknown repo ID returns 404**

Mock `prisma.project.findFirst` to return `null`. Assert it returns 404.

**Test: does NOT read from process.env.GITHUB_WEBHOOK_SECRET**

Grep the source file for `process.env.GITHUB_WEBHOOK_SECRET`. Assert it does NOT appear. The handler must use per-project secrets only.

---

### 2.6 Pre-Creation Validation Tests

**File to create:** `apps/web/src/app/api/projects/__tests__/route.test.ts`

These tests verify the POST handler's validation logic. Mock `@/lib/auth`, `@/lib/db`, `@/lib/inngest/client`, `@/lib/tokens`, and `@/lib/integrations`.

**Test: missing OAuth connection returns 400 with provider names**

Mock `auth()` to return a valid session. Mock `hasConnection` to return `true` for GitHub and Vercel, `false` for Supabase. Mock `prisma.project.findUnique` and `prisma.project.count` to pass earlier checks.

Call POST with `{ name: "test-project" }`. Assert status 400. Assert response body `error` includes `"Supabase"`.

**Test: all connections missing lists all three**

Mock all `hasConnection` calls to return `false`. Assert response error includes `"GitHub"`, `"Vercel"`, and `"Supabase"`.

**Test: Supabase with existing projects returns SUPABASE_SLOTS_FULL**

Mock all connections as present. Mock `getProviderToken` to return a token. Mock `supabase.countActiveProjects()` to return `2`.

Assert status 400. Assert response error matches the `ERROR_CODES.SUPABASE_SLOTS_FULL` constant.

**Test: Supabase token failure returns descriptive error**

Mock `getProviderToken` to throw. Assert status 400. Assert error mentions "reconnect Supabase".

**Test: successful validation proceeds to create project**

Mock all checks passing (connections exist, 0 active Supabase projects). Mock `prisma.project.create` and `inngest.send`. Assert status 201. Assert `inngest.send` was called with event name `"project/create.requested"`.

---

## Part 3: Static Verification Checks

These checks verify code structure without running tests. The testing agent should perform them by reading files.

### 3.1 Prisma Schema Verification

**File:** `apps/web/prisma/schema.prisma`

Verify the `Project` model contains these 4 new fields:
- `webhookSecretEnc  Bytes?`
- `githubOwner       String?`
- `supabaseStagingRef String?`
- `supabaseProdRef    String?`

Run `cd apps/web && npx prisma validate` — must exit 0.

### 3.2 Pipeline Structure Verification

**File:** `apps/web/src/lib/inngest/functions/project-create.ts`

Verify by reading the file:

1. **Function config:** `retries: 3` (not 1 as in Phase 0)
2. **Step names exist** (search for these strings):
   - `"validate-prerequisites"`
   - `"create-github-repo"`
   - `"create-supabase-staging"`
   - `"create-supabase-production"`
   - `"wait-supabase-provision"` (this is a `step.sleep`)
   - `"check-supabase-staging-ready"`
   - `"check-supabase-production-ready"`
   - `"create-vercel-project"`
   - `"configure-vercel-env"`
   - `"push-template"`
   - `"register-webhook"`
   - `"finalize-project"`
3. **`encrypt()` used for sensitive data:** Search for `encrypt(` — must appear for `staging.password`, `stagingDb.serviceKey`, `production.password`, `prodDb.serviceKey`, and `webhookSecret`. Verify `Buffer.from(` does NOT appear for any of these.
4. **`step.sleep` for Supabase provisioning:** Verify `step.sleep("wait-supabase-provision", "45s")` exists between the creation steps (3/4) and the ready-check steps (5/6).
5. **Idempotency checks:** Steps `create-github-repo`, `create-vercel-project`, and `register-webhook` must query the project record and return early if the resource already exists (check for `if (project.githubRepoId)`, `if (project.vercelProjectId)`, `if (project.githubWebhookId)`).
6. **onFailure handler:** Must call `supabase.deleteProject()` for both staging and prod refs, and `vercel.deleteProject()` for vercel project. Must wrap each cleanup in try/catch. Must set project status to `"ERROR"`.
7. **Vercel env vars:** Step `configure-vercel-env` must set 8 env vars. Verify 4 have `target: ["preview", "development"]` and 4 have `target: ["production"]`. Verify `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` use `type: "encrypted"`. Verify `NEXT_PUBLIC_*` vars use `type: "plain"`.

### 3.3 Webhook Handler Verification

**File:** `apps/web/src/app/api/webhooks/github/route.ts`

1. Must NOT import or reference `process.env.GITHUB_WEBHOOK_SECRET`.
2. Must import `decrypt` from `@/lib/encryption`.
3. `verifySignature` function signature must accept 3 parameters: `(payload: string, signature: string, secret: string)`.
4. The handler must parse the body to extract `repository.id` BEFORE signature verification.
5. Must call `prisma.project.findFirst` with `{ where: { githubRepoId: repoId, status: "ACTIVE" } }`.
6. Must call `decrypt(new Uint8Array(project.webhookSecretEnc))` to get the secret.

### 3.4 Environment Variables Verification

**File:** `apps/web/.env.example`

1. Must contain `NEXT_PUBLIC_APP_URL`.
2. Must NOT contain `GITHUB_WEBHOOK_SECRET`.

### 3.5 Integration Barrel Export Verification

**File:** `apps/web/src/lib/integrations/index.ts`

Must export `buildDatabaseUrl` alongside the three client classes.

### 3.6 Build Verification

```bash
cd apps/web && npx next build
```

Must compile successfully. Handlebars `require.extensions` warnings are expected and acceptable. Zero type errors.

---

## Part 4: Manual End-to-End Testing

These tests require real OAuth credentials for GitHub, Vercel, and Supabase. They should only be run when the full platform is deployed with a real database.

### Prerequisites

- LaunchPad web app running locally or deployed
- A GitHub account with no conflicting repo names
- A Vercel account (Hobby or Pro)
- A Supabase account with **0 existing projects** (free tier)
- All three accounts connected via OAuth in LaunchPad Settings page

### 4.1 Happy Path: Full Project Creation

1. Navigate to the LaunchPad dashboard
2. Click "New Project"
3. Enter project name: `test-e2e-app`
4. Click Create

**Verify during creation (project detail page should show status CREATING):**
- The page should show the project with status "Creating..."

**Verify after completion (status transitions to ACTIVE, may take 1-2 minutes):**
- Refresh the project detail page — status should be "Active"
- A "Getting Started" section should show the clone command
- Two environment cards should appear: Staging and Production

**Verify external services:**

GitHub:
- Visit `github.com/{your-username}/test-e2e-app`
- The repo should exist and be private
- It should have a single commit "Initial project scaffold by LaunchPad"
- It should contain all template files: `CLAUDE.md`, `package.json`, `prisma/schema.prisma`, `src/app/page.tsx`, etc.
- Check Settings > Webhooks — one webhook should be registered pointing to your LaunchPad URL

Supabase:
- Visit the Supabase dashboard
- Two projects should exist: `test-e2e-app-staging` and `test-e2e-app-prod`
- Both should have status "Active" (green indicator)

Vercel:
- Visit the Vercel dashboard
- A project `test-e2e-app` should exist, linked to the GitHub repo
- Check Settings > Environment Variables — 8 env vars should be configured:
  - `DATABASE_URL` (Preview+Development and Production, both encrypted)
  - `NEXT_PUBLIC_SUPABASE_URL` (Preview+Development and Production)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Preview+Development and Production)
  - `SUPABASE_SERVICE_ROLE_KEY` (Preview+Development and Production, both encrypted)
- The initial deployment should have been triggered automatically by the template push

**Verify clone and local dev:**
```bash
git clone https://github.com/{your-username}/test-e2e-app.git
cd test-e2e-app
npm install
# Verify CLAUDE.md exists and contains the project name
cat CLAUDE.md
# Verify .launchpad/config.json is populated
cat .launchpad/config.json
```

### 4.2 Validation Failures

**Missing OAuth connection:**
1. Disconnect Vercel from LaunchPad Settings
2. Try to create a new project
3. Should get an immediate error: "Please connect your Vercel account(s) in Settings..."
4. Reconnect Vercel

**Supabase slots full:**
1. After a successful project creation (2 Supabase projects exist)
2. Try to create another project (even though LaunchPad's 1-project limit would block first)
3. The Supabase slot check should fire if you bypass the project limit (or test via direct API call)

**Duplicate project name:**
1. Try to create a project with the same name as an existing one
2. Should get error: "A project with this name already exists" (409)

### 4.3 Webhook Verification

After a successful project creation:

1. Clone the repo and create a feature branch:
   ```bash
   git checkout -b feat/test-webhook
   echo "// test" >> src/app/page.tsx
   git add . && git commit -m "test webhook"
   git push -u origin feat/test-webhook
   ```
2. Check the LaunchPad dashboard — a new "Preview" deploy should appear with status PENDING
3. This confirms the webhook was registered correctly and the per-project secret verification works

### 4.4 Pipeline Failure + Cleanup

This test verifies the `onFailure` handler cleans up partial resources.

**Approach:** This is hard to trigger manually. The most practical way is to cause Vercel project creation to fail (e.g., by using a project name that conflicts with an existing Vercel project). If the pipeline fails:

1. Check the LaunchPad dashboard — project status should be "Error"
2. Check Supabase dashboard — the staging and production projects should have been deleted (cleaned up by the onFailure handler)
3. Check Vercel dashboard — the Vercel project should have been deleted (if it was created before the failure)
4. The GitHub repo may still exist (intentionally not cleaned up)

### 4.5 Cleanup After E2E Testing

After manual testing, clean up all created resources:

1. Delete the LaunchPad project from the dashboard (if implemented) or directly from the database
2. Delete the GitHub repo: `gh repo delete {your-username}/test-e2e-app --yes`
3. Delete both Supabase projects from the Supabase dashboard
4. Delete the Vercel project from the Vercel dashboard

---

## Part 5: Test Execution Summary

### Automated tests — run with:
```bash
cd apps/web && npx vitest run
```

### Expected test file structure:
```
apps/web/src/
  lib/
    template/__tests__/generate.test.ts        # ~12 tests
    integrations/__tests__/database-url.test.ts # ~5 tests
    integrations/__tests__/github.test.ts       # ~7 tests
    integrations/__tests__/vercel.test.ts       # ~1 test
  app/
    api/webhooks/github/__tests__/route.test.ts # ~5 tests
    api/projects/__tests__/route.test.ts        # ~5 tests
```

### Static checks — performed by reading code:
- Prisma schema validation
- Pipeline structure verification (step names, encrypt usage, idempotency)
- Webhook handler verification (no env var, per-project secret)
- .env.example verification

### Manual E2E — requires real credentials:
- Full project creation happy path
- Validation failure scenarios
- Webhook delivery verification
- Pipeline failure cleanup verification

### Priority order:
1. Template generator tests (pure logic, highest value)
2. DATABASE_URL builder tests (pure logic, critical correctness)
3. Static verification checks (quick, catches regressions)
4. GitHubClient HTTP contract tests (verifies API integration)
5. Pre-creation validation tests (verifies user-facing errors)
6. Webhook handler tests (verifies security-critical code)
7. Build verification
8. Manual E2E (only when deploying with real credentials)
