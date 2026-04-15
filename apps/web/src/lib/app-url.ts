/**
 * Resolve the public base URL of the LaunchPad app (no trailing slash).
 *
 * Preference order:
 *  1. NEXT_PUBLIC_APP_URL — explicit override (local dev, custom domains).
 *  2. VERCEL_PROJECT_PRODUCTION_URL — stable production domain on Vercel.
 *  3. VERCEL_URL — per-deployment domain (preview deploys).
 *  4. http://localhost:3000 — only outside Vercel; throws if VERCEL=1.
 *
 * GitHub webhook registration and the Vercel Deploy Button redirect both rely
 * on this being a real public URL, so we refuse to silently return localhost
 * in a Vercel environment.
 */
export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.VERCEL === "1") {
    throw new Error(
      "LaunchPad app URL is unknown. Set NEXT_PUBLIC_APP_URL in the Vercel project environment."
    );
  }
  return "http://localhost:3000";
}
