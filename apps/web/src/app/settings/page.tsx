import type { Metadata } from "next";

import { BudgetSettingsPage } from "@/features/settings";
import { getContainer } from "@/server/container";

export const metadata: Metadata = { title: "Cài đặt ngân sách · Shorts Studio" };

// Spend changes with every paid call; never serve a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const container = getContainer();
  const [view, report] = await Promise.all([container.getBudgetSettings(), container.getUsageReport()]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <BudgetSettingsPage view={view} report={report} />
    </div>
  );
}
