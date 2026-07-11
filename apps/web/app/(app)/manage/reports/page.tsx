"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type ReportView } from "@/ui/api";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

const TONE: Record<ReportView["status"], "good" | "warn" | "danger" | "neutral"> = {
  completed: "good",
  pending: "warn",
  running: "warn",
  failed: "danger",
};

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setReports((await api.listReports(50)).reports);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <EmptyState title="Couldn't load your reports." message="Try again shortly." />;
  if (reports === null) return <Skeleton lines={4} />;

  const columns: Column<ReportView>[] = [
    { key: "kind", header: "Report", render: (row) => row.kind },
    { key: "format", header: "Format", render: (row) => <Badge>{row.format.toUpperCase()}</Badge> },
    { key: "year", header: "Year", render: (row) => <span className="num">{row.academicYear}</span> },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span title={row.error ?? undefined}>
          <Badge tone={TONE[row.status]}>{row.status}</Badge>
        </span>
      ),
    },
    { key: "rows", header: "Rows", align: "right", render: (row) => <span className="num">{row.rows}</span> },
    { key: "created", header: "Requested", render: (row) => <span className="num">{new Date(row.createdAt).toLocaleString()}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.status === "completed" ? (
          <a className="btn ghost" href={api.downloadUrl(row.id)} download>
            Download
          </a>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Your reports"
        lede="Every report you've requested — downloads are re-checked against your scope on every fetch."
        actions={<Button variant="ghost" onClick={() => void load()}>Refresh</Button>}
      />
      <DataTable
        columns={columns}
        rows={reports}
        rowKey={(row) => row.id}
        empty={{
          title: "No reports yet.",
          message: "Reports you request appear here — try Download report on a student's page.",
        }}
      />
    </>
  );
}
