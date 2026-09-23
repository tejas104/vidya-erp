"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Input, Select, StatusBadge } from "@vidya/ui-system";
import {
  api,
  ApiError,
  type GuardianInvitationView,
  type GuardianRelationshipType,
  type GuardianRelationshipView,
  type Role,
} from "./api";
import styles from "./GuardiansPanel.module.css";

/**
 * A pupil's guardians, for staff (ADR-0027). Admins and the pupil's class
 * teacher may invite; only an admin may verify or revoke. The server enforces
 * all of it; the panel hides actions the viewer could not take, and hides
 * itself entirely for a viewer outside the pupil's scope.
 */

const TYPE_LABEL: Record<GuardianRelationshipType, string> = {
  parent: "Parent",
  "legal-guardian": "Legal guardian",
  "other-authorized-contact": "Other authorised contact",
};

const STATUS: Record<GuardianRelationshipView["status"], { status: "good" | "warn" | "danger" | "neutral"; label: string }> = {
  active: { status: "good", label: "Active" },
  restricted: { status: "warn", label: "Restricted" },
  pending: { status: "warn", label: "Awaiting verification" },
  revoked: { status: "danger", label: "Revoked" },
  expired: { status: "neutral", label: "Expired" },
};

type Load =
  | { state: "loading" }
  | { state: "hidden" }
  | { state: "error" }
  | { state: "ok"; relationships: GuardianRelationshipView[]; invitations: GuardianInvitationView[] };

export function GuardiansPanel({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [roles, setRoles] = useState<readonly Role[]>([]);
  const [issued, setIssued] = useState<{ code: string; invitation: GuardianInvitationView } | null>(null);
  const isAdmin = roles.includes("admin");
  const canInvite = isAdmin || roles.includes("class_teacher");

  const refresh = useCallback(() => {
    api
      .studentGuardians(studentId)
      .then((data) => setLoad({ state: "ok", ...data }))
      .catch((caught) => setLoad(caught instanceof ApiError && caught.status === 403 ? { state: "hidden" } : { state: "error" }));
  }, [studentId]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    api.session().then((session) => setRoles(session.roles)).catch(() => setRoles([]));
  }, []);

  if (load.state === "hidden" || load.state === "loading") return null;

  async function verify(id: string) {
    await api.verifyGuardian(id);
    refresh();
  }

  async function revoke(relationship: GuardianRelationshipView) {
    const reason = window.prompt(`Why is ${relationship.guardianName}'s access being revoked? This is recorded.`);
    if (reason === null || reason.trim().length < 3) return;
    await api.revokeGuardian(relationship.id, reason.trim());
    refresh();
  }

  return (
    <section className="section" aria-label="Guardians">
      <div className="section-head">
        <h2>Guardians</h2>
      </div>

      {load.state === "error" ? (
        <div className="state">Couldn't load guardians. Try again shortly.</div>
      ) : (
        <Card>
          {load.relationships.length === 0 && load.invitations.length === 0 ? (
            <EmptyState title="No guardians linked." body={canInvite ? "Invite a parent below; they'll set up their own sign-in with the code." : undefined} />
          ) : (
            <ul className={styles.list}>
              {load.relationships.map((relationship) => (
                <li key={relationship.id} className={styles.row}>
                  <div className={styles.who}>
                    <strong>{relationship.guardianName}</strong>
                    <span className={styles.meta}>
                      {TYPE_LABEL[relationship.relationshipType]}
                      {relationship.isPrimaryContact ? " · primary contact" : ""}
                      {relationship.verificationState === "staff-verified" ? " · verified by staff" : ""}
                      {relationship.statusReason !== null ? ` · ${relationship.statusReason}` : ""}
                    </span>
                  </div>
                  <StatusBadge status={STATUS[relationship.status].status}>{STATUS[relationship.status].label}</StatusBadge>
                  {isAdmin && relationship.status === "pending" ? (
                    <Button size="sm" onClick={() => void verify(relationship.id)}>Verify</Button>
                  ) : null}
                  {isAdmin && (relationship.status === "active" || relationship.status === "restricted" || relationship.status === "pending") ? (
                    <Button size="sm" variant="danger" onClick={() => void revoke(relationship)}>Revoke</Button>
                  ) : null}
                </li>
              ))}
              {load.invitations.map((invitation) => (
                <li key={invitation.id} className={styles.row}>
                  <div className={styles.who}>
                    <strong>{invitation.guardianName}</strong>
                    <span className={styles.meta}>
                      {TYPE_LABEL[invitation.relationshipType]} · invited via {invitation.contactValue} · expires {new Date(invitation.expiresAt).toLocaleString()}
                    </span>
                  </div>
                  <StatusBadge status="info">Invitation sent</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {issued !== null ? (
        <div className={styles.code} role="status">
          <p>
            Give this code to <strong>{issued.invitation.guardianName}</strong> at {issued.invitation.contactValue}. It is shown only now, works once, and expires{" "}
            {new Date(issued.invitation.expiresAt).toLocaleString()}.
          </p>
          <p className={`num ${styles.codeValue}`}>{issued.code}</p>
          <Button size="sm" variant="secondary" onClick={() => setIssued(null)}>Done</Button>
        </div>
      ) : null}

      {canInvite && issued === null ? (
        <InviteForm
          studentId={studentId}
          onIssued={(result) => {
            setIssued(result);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function InviteForm({ studentId, onIssued }: { studentId: string; onIssued: (result: { code: string; invitation: GuardianInvitationView }) => void }) {
  const [guardianName, setGuardianName] = useState("");
  const [relationshipType, setRelationshipType] = useState<GuardianRelationshipType>("parent");
  const [contactMethod, setContactMethod] = useState<"sms" | "email">("sms");
  const [contactValue, setContactValue] = useState("");
  const [staffVerified, setStaffVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onIssued(await api.inviteGuardian(studentId, { guardianName: guardianName.trim(), relationshipType, contactMethod, contactValue: contactValue.trim(), staffVerified }));
      setGuardianName("");
      setContactValue("");
      setStaffVerified(false);
    } catch {
      setError("Couldn't issue the invitation. Check the details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Invite a guardian">
      <form className={styles.form} onSubmit={submit}>
        <Input label="Guardian's name" value={guardianName} onChange={(event) => setGuardianName(event.target.value)} required />
        <Select
          label="Relationship"
          value={relationshipType}
          onChange={(event) => setRelationshipType(event.target.value as GuardianRelationshipType)}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          hint={relationshipType === "other-authorized-contact" ? "Sees attendance, notices and timetable only, and needs admin verification." : undefined}
        />
        <Select
          label="Send code by"
          value={contactMethod}
          onChange={(event) => setContactMethod(event.target.value as "sms" | "email")}
          options={[
            { value: "sms", label: "Phone (SMS)" },
            { value: "email", label: "Email" },
          ]}
        />
        <Input
          label={contactMethod === "sms" ? "Phone number on file" : "Email on file"}
          type={contactMethod === "sms" ? "tel" : "email"}
          value={contactValue}
          onChange={(event) => setContactValue(event.target.value)}
          required
        />
        <label className={styles.check}>
          <input type="checkbox" checked={staffVerified} onChange={(event) => setStaffVerified(event.target.checked)} />
          I have checked this person's identity in person
        </label>
        {error !== "" ? <p className={styles.error} role="alert">{error}</p> : null}
        <div>
          <Button type="submit" loading={busy} disabled={guardianName.trim() === "" || contactValue.trim().length < 3}>
            Issue invitation code
          </Button>
        </div>
      </form>
    </Card>
  );
}
