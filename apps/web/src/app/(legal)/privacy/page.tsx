import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — LaunchPad",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-sm text-muted-foreground">
      <h1 className="mb-8 text-2xl font-bold text-foreground">Privacy Policy</h1>
      <p className="mb-4">Last updated: April 14, 2026</p>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">1. Information We Collect</h2>
        <p>
          LaunchPad collects information necessary to provide the deployment service, including your
          GitHub username and email (via GitHub OAuth), and OAuth tokens for connected services
          (GitHub, Vercel, Supabase). We do not collect personal information beyond what is required
          for the service to function.
        </p>

        <h2 className="text-lg font-semibold text-foreground">2. How We Use Your Information</h2>
        <p>
          Your information is used solely to operate the LaunchPad platform: authenticating your
          identity, creating and managing projects, provisioning infrastructure, and deploying your
          code. We do not sell, share, or use your data for advertising.
        </p>

        <h2 className="text-lg font-semibold text-foreground">3. Data Storage and Security</h2>
        <p>
          OAuth tokens and sensitive credentials are encrypted at rest using AES-256-GCM. Data is
          stored in a Supabase-hosted PostgreSQL database. We follow industry-standard security
          practices to protect your information.
        </p>

        <h2 className="text-lg font-semibold text-foreground">4. Third-Party Services</h2>
        <p>
          LaunchPad integrates with GitHub, Vercel, and Supabase on your behalf. Your use of those
          services is governed by their respective privacy policies. LaunchPad only accesses the
          minimum scopes and permissions required to operate.
        </p>

        <h2 className="text-lg font-semibold text-foreground">5. Data Deletion</h2>
        <p>
          You may disconnect any connected service from the Settings page at any time, which removes
          stored tokens. To delete your account and all associated data, contact us at the email
          below.
        </p>

        <h2 className="text-lg font-semibold text-foreground">6. Contact</h2>
        <p>
          For questions about this policy, contact us at{" "}
          <span className="text-foreground">privacy@launchpad.dev</span>.
        </p>
      </section>
    </div>
  );
}
