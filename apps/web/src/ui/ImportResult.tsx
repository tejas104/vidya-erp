import type { ReactNode } from "react";
import { api, type ImportView } from "./api";
import { Table, StatusBadge, type TableColumn } from "@vidya/ui-system";
import { Icon } from "./Icon";

/**
 * Renders one import outcome (dry-run preview OR the confirmed result) —
 * shared by both the students and staff screens so the three-tier row
 * rendering exists in exactly one place.
 *
 * Only error and warning rows carry per-row detail (the API never returns a
 * row-by-row list of the ok rows — there's nothing wrong to report for
 * those, so they only show up in the ok count). Each row's tier is spelled
 * out in text AND carries its own icon, so it survives greyscale/colour-
 * blindness — never colour alone.
 */

type TierRow = { rowNo: number; tier: "warning" | "error"; message: string };
type Cols = { rowNo: ReactNode; tier: ReactNode; message: ReactNode };

function tieredRows(view: ImportView): TierRow[] {
  return [
    ...view.errors.map((e) => ({ rowNo: e.row, tier: "error" as const, message: e.message })),
    ...view.warnings.map((w) => ({ rowNo: w.row, tier: "warning" as const, message: w.message })),
  ].sort((a, b) => a.rowNo - b.rowNo);
}

const COLUMNS: TableColumn<Cols>[] = [
  { key: "rowNo", header: "Row", figure: true, align: "right" },
  { key: "tier", header: "Status" },
  { key: "message", header: "Problem" },
];

export function ImportResult({ view, final }: { view: ImportView; final: boolean }) {
  const rows = tieredRows(view);
  const flagged = view.errorRows + view.warningRows;
  // The service caps errors/warnings at 500 rows each — beyond that the detail
  // is genuinely withheld from this view (still counted, just not listed).
  const withheld = flagged - rows.length;

  const tableRows: Cols[] = rows.map((r) => ({
    rowNo: <span className="num">{r.rowNo}</span>,
    tier:
      r.tier === "error" ? (
        <StatusBadge status="danger" icon={<Icon name="alert" size={14} />}>error</StatusBadge>
      ) : (
        <StatusBadge status="warn" icon={<Icon name="info" size={14} />}>warning</StatusBadge>
      ),
    message: r.message,
  }));

  return (
    <div data-testid={final ? "import-final" : "import-preview"}>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{view.totalRows}</div>
          <div className="stat-label">rows</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            <StatusBadge status="good" icon={<Icon name="check" size={14} />}>{view.okRows}</StatusBadge>
          </div>
          <div className="stat-label">ok{final ? " · written" : ""}</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            <StatusBadge status="warn" icon={<Icon name="info" size={14} />}>{view.warningRows}</StatusBadge>
          </div>
          <div className="stat-label">warning</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            <StatusBadge status="danger" icon={<Icon name="alert" size={14} />}>{view.errorRows}</StatusBadge>
          </div>
          <div className="stat-label">error</div>
        </div>
      </div>

      {rows.length > 0 ? <Table columns={COLUMNS} rows={tableRows} /> : null}

      {withheld > 0 ? (
        <p className="field-hint" data-testid="withheld-notice">
          {withheld} more flagged row{withheld === 1 ? "" : "s"} withheld from this list —
          {final ? (
            <>
              {" "}
              <a href={api.importErrorsUrl(view.id)} download>
                download the error CSV
              </a>{" "}
              for the complete list.
            </>
          ) : (
            " confirm the import to get the full error CSV."
          )}
        </p>
      ) : null}

      {final && view.errorRows > 0 ? (
        <p>
          <a href={api.importErrorsUrl(view.id)} download>
            Download rejected rows (CSV)
          </a>
        </p>
      ) : null}
    </div>
  );
}
