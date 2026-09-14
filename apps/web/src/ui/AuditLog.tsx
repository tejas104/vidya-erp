"use client";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState, Input, Select, Table } from "@vidya/ui-system";
import { api, ApiError, type AuditEventsView } from "./api";
import { AsyncState } from "./AsyncState";
import styles from "./AuditLog.module.css";

export function AuditLog() {
  const [action, setAction] = useState("");
  const [limit, setLimit] = useState("50");
  const [query, setQuery] = useState({ action: "", limit: 50, revision: 0 });
  const [data, setData] = useState<AuditEventsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDenied(false);
    setData(null);
    api.systemAudit(query.action, query.limit).then((result) => {
      if (alive) setData(result);
    }).catch((caught: unknown) => {
      if (!alive) return;
      const forbidden = caught instanceof ApiError && caught.status === 403;
      setDenied(forbidden);
      setError(forbidden ? "Only administrators can view the audit log." : "Couldn't load the audit log. Check your connection and retry.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query]);

  function refresh() {
    setQuery((previous) => ({ ...previous, revision: previous.revision + 1 }));
  }

  return (
    <Card title="Audit log" actions={<Button variant="secondary" size="sm" onClick={refresh} disabled={loading || denied}>Refresh</Button>}>
      <p className={styles.description}>Recent recorded activity, newest first. Filter by an exact action to investigate a change.</p>
      <form className={styles.filters} onSubmit={(event) => {
        event.preventDefault();
        setQuery((previous) => ({ action: action.trim(), limit: Number(limit), revision: previous.revision + 1 }));
      }}>
        <Input label="Action" placeholder="All actions" maxLength={120} value={action} onChange={(event) => setAction(event.target.value)} hint="For example: system.clock-rollback" />
        <Select label="Event window" value={limit} onChange={(event) => setLimit(event.target.value)} options={[50, 100, 200].map((value) => ({ value: String(value), label: `Newest ${value}` }))} />
        <Button type="submit" disabled={loading || denied}>Apply filter</Button>
      </form>
      <AsyncState loading={loading} error={error !== null} errorMessage={error} onRetry={denied ? undefined : refresh}
        isEmpty={data?.events.length === 0} empty={<EmptyState title="No recorded events" body={query.action ? "No events match this action. Clear the filter to see all recent activity." : "Recorded changes will appear here."} />}>
        {data && data.events.length > 0 ? <>
          <p className={styles.description} role="status">Showing {data.events.length} event{data.events.length === 1 ? "" : "s"}.{data.truncated ? " This window is full; older events may exist. Narrow the action filter or increase the window." : ""}</p>
          <div className={styles.tableViewport}><Table columns={[
            { key: "when", header: "When" }, { key: "action", header: "Action" },
            { key: "actor", header: "Actor" }, { key: "resource", header: "Resource" }, { key: "details", header: "Details" },
          ]} rows={data.events.map((event) => ({
            when: <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString("en-IN")}</time>,
            action: <span className={styles.identifier}>{event.action}</span>,
            actor: <span className={styles.identifier}>{event.actorId ?? event.actorType}</span>,
            resource: <span className={styles.identifier}>{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ""}</span>,
            details: <details><summary aria-label={`Details for event ${event.id}`}>View details</summary><pre className={styles.details}>{JSON.stringify({ eventId: event.id, requestId: event.requestId, details: event.details }, null, 2)}</pre></details>,
          }))} /></div>
        </> : null}
      </AsyncState>
    </Card>
  );
}
