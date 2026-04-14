import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "End User License Agreement — LaunchPad",
};

export default function EulaPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-sm text-muted-foreground">
      <h1 className="mb-8 text-2xl font-bold text-foreground">End User License Agreement</h1>
      <p className="mb-4">Last updated: April 14, 2026</p>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">1. Acceptance of Terms</h2>
        <p>
          By accessing or using LaunchPad, you agree to be bound by this End User License Agreement.
          If you do not agree, do not use the service.
        </p>

        <h2 className="text-lg font-semibold text-foreground">2. License Grant</h2>
        <p>
          LaunchPad grants you a limited, non-exclusive, non-transferable, revocable license to use
          the platform for the purpose of deploying and managing your software projects.
        </p>

        <h2 className="text-lg font-semibold text-foreground">3. Your Responsibilities</h2>
        <p>
          You are responsible for all activity under your account, including the content you deploy
          and the security of your connected service credentials. You agree not to use LaunchPad for
          any unlawful purpose or in violation of any applicable regulations.
        </p>

        <h2 className="text-lg font-semibold text-foreground">4. Intellectual Property</h2>
        <p>
          You retain all rights to the code and content you deploy through LaunchPad. LaunchPad does
          not claim ownership of your projects or data.
        </p>

        <h2 className="text-lg font-semibold text-foreground">5. Service Availability</h2>
        <p>
          LaunchPad is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We
          do not guarantee uninterrupted or error-free operation. We reserve the right to modify,
          suspend, or discontinue the service at any time.
        </p>

        <h2 className="text-lg font-semibold text-foreground">6. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, LaunchPad and its operators shall not be liable for
          any indirect, incidental, special, or consequential damages arising from your use of the
          service.
        </p>

        <h2 className="text-lg font-semibold text-foreground">7. Termination</h2>
        <p>
          Either party may terminate this agreement at any time. Upon termination, your right to use
          the service ceases immediately. You may request deletion of your data by contacting us.
        </p>

        <h2 className="text-lg font-semibold text-foreground">8. Contact</h2>
        <p>
          For questions about this agreement, contact us at{" "}
          <span className="text-foreground">legal@launchpad.dev</span>.
        </p>
      </section>
    </div>
  );
}
