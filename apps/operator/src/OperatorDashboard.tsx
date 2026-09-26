"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SubscriptionAccess } from "@vidya/control-plane";
import styles from "./OperatorDashboard.module.css";

export type TenantOverview = {
  id: string; code: string; name: string; city: string;
  deployment: "requested" | "provisioning" | "ready_for_onboarding" | "active" | "failed" | "offboarding";
  subscription: "trial" | "active" | "past_due" | "grace" | "restricted" | "suspended" | "cancelled";
  paidThrough: string; seats: number; release: string; access: SubscriptionAccess;
};

const subscriptionNames: Record<TenantOverview["subscription"], string> = {
  trial: "Trial", active: "Active", past_due: "Past due", grace: "In grace",
  restricted: "Read only", suspended: "Suspended", cancelled: "Cancelled",
};
const deploymentNames: Record<TenantOverview["deployment"], string> = {
  requested: "Requested", provisioning: "Provisioning", ready_for_onboarding: "Ready to onboard",
  active: "Running", failed: "Needs recovery", offboarding: "Offboarding",
};
function accessName(access: SubscriptionAccess): string {
  if (access.reason === "invalid_record") return "Unlicensed";
  if (access.reason === "grace") return "Full · grace";
  return access.mode === "full" ? "Full access" : "Read only";
}

export function OperatorDashboard({ tenants }: { tenants: readonly TenantOverview[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "running">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
      if (event.key === "Tab") {
        // This preview panel has only its Close control; keep focus inside.
        event.preventDefault();
        dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [selectedId]);
  const needsAttention = (tenant: TenantOverview) => tenant.deployment === "failed" ||
    (["ready_for_onboarding", "active"].includes(tenant.deployment) &&
      (tenant.access.mode === "read_only" || tenant.access.reason === "grace"));
  const visible = useMemo(() => tenants.filter((tenant) => {
    const matches = `${tenant.name} ${tenant.code} ${tenant.city}`.toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === "all" || (filter === "attention" && needsAttention(tenant)) ||
      (filter === "running" && tenant.deployment === "active"));
  }), [tenants, query, filter]);
  const selected = tenants.find((tenant) => tenant.id === selectedId) ?? null;
  const attentionCount = tenants.filter(needsAttention).length;

  return <div className={styles.shell}>
    <aside className={styles.rail} aria-label="Operator navigation">
      <div className={styles.brand}><span className={styles.brandMark}>V</span><span>VIDYA<span className={styles.brandSub}>OPERATIONS</span></span></div>
      <nav aria-label="Primary"><a className={styles.current} href="#portfolio" aria-current="page">Portfolio</a><span>Provisioning</span><span>Subscriptions</span><span>Audit</span></nav>
      <div className={styles.railFoot}>Console preview<br /><small>Fictional schools · no live controls</small></div>
    </aside>
    <main id="portfolio" className={styles.main}>
      <header className={styles.topline}><span>VIDYA / FLEET</span><span>LOCAL DESIGN PREVIEW</span></header>
      <div className={styles.heading}><div><p className={styles.eyebrow}>School portfolio</p><h1>One view across every school.</h1><p className={styles.lede}>Track subscription attention and deployment readiness without opening a school’s records.</p></div><div className={styles.demoTag}>Synthetic data · 26 Sep 2026</div></div>
      <section className={styles.metrics} aria-label="Portfolio summary">
        <div><span>Schools registered</span><strong>{tenants.length}</strong><small>Vendor metadata only</small></div>
        <div><span>Needs attention</span><strong>{attentionCount}</strong><small>Renewal or deployment</small></div>
        <div><span>Running</span><strong>{tenants.filter((tenant) => tenant.deployment === "active").length}</strong><small>Deployment state</small></div>
      </section>
      <section className={styles.register} aria-label="School register">
        <div className={styles.registerHead}><div><p className={styles.eyebrow}>Registry</p><h2>Schools and licences</h2></div><p>This preview cannot create tenants, collect payment or change access.</p></div>
        <div className={styles.controls}><label className={styles.search}>Search schools<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, code or city" /></label><div className={styles.filters} aria-label="Filter schools">{(["all", "attention", "running"] as const).map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "all" ? "All schools" : item === "attention" ? "Needs attention" : "Running"}</button>)}</div></div>
        {visible.length === 0 ? <p className={styles.empty}>No schools match this view. Try another search or filter.</p> : <div className={styles.tableScroll}><table><thead><tr><th scope="col">School</th><th scope="col">Recorded state</th><th scope="col">Effective access</th><th scope="col">Paid through</th><th scope="col">Deployment</th><th scope="col">Seats</th><th scope="col"><span className={styles.srOnly}>Details</span></th></tr></thead><tbody>{visible.map((tenant) => <tr key={tenant.id}><td data-label="School"><strong>{tenant.name}</strong><small>{tenant.city} · {tenant.code}</small></td><td data-label="Recorded state">{subscriptionNames[tenant.subscription]}</td><td data-label="Effective access"><span className={`${styles.pill} ${needsAttention(tenant) ? styles.warn : styles.ok}`}>{accessName(tenant.access)}</span></td><td data-label="Paid through">{tenant.paidThrough}</td><td data-label="Deployment">{deploymentNames[tenant.deployment]}</td><td data-label="Seats">{tenant.seats.toLocaleString()}</td><td data-label="Details"><button className={styles.view} type="button" onClick={() => setSelectedId(tenant.id)} aria-label={`View ${tenant.name}`}>View →</button></td></tr>)}</tbody></table></div>}
      </section>
      <p className={styles.footnote}>School fees, pupils and guardians never enter this console. Subscription expiry does not delete school data.</p>
    </main>
    {selected && <div className={styles.overlay} role="presentation" onClick={() => setSelectedId(null)}><section ref={dialogRef} className={styles.detail} role="dialog" aria-modal="true" aria-label={`${selected.name} details`} onClick={(event) => event.stopPropagation()}><button type="button" className={styles.close} onClick={() => setSelectedId(null)}>Close</button><p className={styles.eyebrow}>School account</p><h2>{selected.name}</h2><p>{selected.city} · {selected.code}</p><dl><div><dt>Recorded state</dt><dd>{subscriptionNames[selected.subscription]}</dd></div><div><dt>Effective access</dt><dd>{accessName(selected.access)}</dd></div><div><dt>Paid through</dt><dd>{selected.paidThrough}</dd></div><div><dt>Deployment</dt><dd>{deploymentNames[selected.deployment]}</dd></div><div><dt>Planned seats</dt><dd>{selected.seats.toLocaleString()}</dd></div><div><dt>Release</dt><dd>{selected.release}</dd></div></dl><p className={styles.detailNote}>This is a fictional preview. Production actions require named operator MFA, a reason and an audit event.</p></section></div>}
  </div>;
}
