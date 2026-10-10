"use client";

import { formatUsd } from "@studio/domain";
import Link from "next/link";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import type { UsageReport } from "../api";
import { formatDateTime, usageRow } from "../model";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function ProjectCell({ projectId, projectName }: { projectId: string | null; projectName: string | null }) {
  if (projectId === null) return <span className="text-muted-foreground">Ngoài dự án</span>;
  if (projectName === null) return <span className="text-muted-foreground">Dự án đã xoá</span>;
  return (
    <Link className="underline-offset-2 hover:underline" href={`/projects/${encodeURIComponent(projectId)}`}>
      {projectName}
    </Link>
  );
}

/** Spend per budget window, per project, and the latest paid calls. */
export function UsageReportView({ report, onReload }: { report: UsageReport; onReload: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chi phí đã dùng</CardTitle>
        <CardDescription>
          Tính theo số tiền nhà cung cấp thực tính; lượt bị chặn không tốn tiền.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="24 giờ qua" value={formatUsd(report.dayUsd)} />
            <Stat label="Tháng này" value={formatUsd(report.monthUsd)} />
            <Stat label="Tổng cộng" value={formatUsd(report.totalUsd)} />
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Theo dự án</h3>
            {report.byProject.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có lệnh gọi trả phí nào.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-normal">Dự án</th>
                      <th className="py-1 pr-3 text-right font-normal">Tháng này</th>
                      <th className="py-1 pr-3 text-right font-normal">Tổng</th>
                      <th className="py-1 text-right font-normal">Lượt gọi (bị chặn)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byProject.map((row) => (
                      <tr key={row.projectId ?? "none"} className="border-t">
                        <td className="py-1.5 pr-3">
                          <ProjectCell projectId={row.projectId} projectName={row.projectName} />
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatUsd(row.monthUsd)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatUsd(row.totalUsd)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {row.calls} ({row.blockedCalls})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {report.recent.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Lệnh gọi gần đây</h3>
              <ul className="flex flex-col divide-y text-sm">
                {report.recent.map((entry) => {
                  const row = usageRow(entry);
                  return (
                    <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                      <span>
                        <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span> ·{" "}
                        {row.what}
                      </span>
                      <span
                        className={entry.status === "ok" ? "tabular-nums" : "tabular-nums text-destructive"}
                      >
                        {row.status} · {row.usd}
                      </span>
                      {entry.message !== undefined && entry.status !== "ok" ? (
                        <span className="w-full text-xs text-muted-foreground">{entry.message}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onReload}>
            Tải lại
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
