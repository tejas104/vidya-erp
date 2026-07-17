"use client";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type GrantInput,
  type OrgTree,
  type Role,
  type UserView,
} from "@/ui/api";
import { useToast } from "@/ui/Toast";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Modal } from "@/ui/Modal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DataTable, type Column } from "@/ui/DataTable";
import { Badge } from "@/ui/Badge";
import { EmptyState } from "@/ui/EmptyState";
import { Skeleton } from "@/ui/Skeleton";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "principal", "hod", "class_teacher", "teacher"];

export default function UsersPage() {
  const toast = useToast();
  const [tree, setTree] = useState<OrgTree | null>(null);
  const [users, setUsers] = useState<UserView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // create-user modal
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [newRoles, setNewRoles] = useState<Role[]>([]);
  // roles modal
  const [rolesFor, setRolesFor] = useState<UserView | null>(null);
  const [roleDraft, setRoleDraft] = useState<Role[]>([]);
  // grants modal
  const [grantsFor, setGrantsFor] = useState<UserView | null>(null);
  const [grantRole, setGrantRole] = useState<Role>("hod");
  const [grantDept, setGrantDept] = useState("");
  const [grantClass, setGrantClass] = useState("");
  const [grantSubject, setGrantSubject] = useState("");
  // reset-token modal
  const [resetFor, setResetFor] = useState<UserView | null>(null);
  const [issued, setIssued] = useState<{ user: string; token: string; expiresAt: string } | null>(null);
  // set-password modal (admin supplies a new value directly)
  const [passwordFor, setPasswordFor] = useState<UserView | null>(null);
  const [newPass, setNewPass] = useState("");

  const load = useCallback(async () => {
    try {
      const { colleges } = await api.colleges();
      const college = colleges[0];
      if (!college) {
        setFailed(true);
        return;
      }
      const [loadedTree, list] = await Promise.all([api.collegeTree(college.id), api.listUsers(college.id)]);
      setTree(loadedTree);
      setUsers(list.users);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function toggleRole(list: Role[], role: Role): Role[] {
    return list.includes(role) ? list.filter((r) => r !== role) : [...list, role];
  }

  async function submitCreate() {
    if (!tree || username.trim() === "" || displayName.trim() === "" || tempPassword.length < 8) return;
    setSaving(true);
    try {
      await api.createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        collegeId: tree.college.id,
        temporaryPassword: tempPassword,
        roles: newRoles,
      });
      toast.show(`"${username.trim()}" created — they must reset the temporary password before first sign-in.`, "good");
      setCreating(false);
      setUsername("");
      setDisplayName("");
      setTempPassword("");
      setNewRoles([]);
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't create the user.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitRoles() {
    if (!rolesFor) return;
    setSaving(true);
    try {
      await api.setUserRoles(rolesFor.id, roleDraft);
      toast.show(`Roles updated for ${rolesFor.username} — their sessions were signed out.`, "good");
      setRolesFor(null);
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't update roles.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function submitGrant() {
    if (!grantsFor || !tree) return;
    const body: GrantInput = { role: grantRole, collegeId: tree.college.id };
    if (grantRole === "hod") {
      if (!grantDept) return;
      body.departmentId = grantDept;
    }
    if (grantRole === "class_teacher" || grantRole === "teacher") {
      if (!grantDept || !grantClass) return;
      body.departmentId = grantDept;
      body.classId = grantClass;
      if (grantRole === "teacher") {
        if (!grantSubject) return;
        body.subjectId = grantSubject;
      }
    }
    setSaving(true);
    try {
      await api.addGrant(grantsFor.id, body);
      toast.show("Grant added — their sessions were signed out.", "good");
      await load();
      setGrantsFor(null);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't add the grant.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function dropGrant(user: UserView, grantId: string) {
    try {
      await api.removeGrant(user.id, grantId);
      toast.show("Grant removed.", "good");
      await load();
      setGrantsFor(null);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't remove the grant.", "danger");
    }
  }

  async function runVerify() {
    try {
      const result = await api.verifyGrants();
      toast.show(
        `Verified ${result.verified} grant(s); ${result.unresolved.length} unresolved.`,
        result.unresolved.length > 0 ? "info" : "good",
      );
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Verification failed.", "danger");
    }
  }

  async function issueReset() {
    if (!resetFor) return;
    try {
      const { token, expiresAt } = await api.passwordResetInit(resetFor.id);
      setIssued({ user: resetFor.username, token, expiresAt });
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't issue the token.", "danger");
    } finally {
      setResetFor(null);
    }
  }

  async function setPassword() {
    if (!passwordFor || newPass.length < 12) return;
    setSaving(true);
    try {
      await api.setUserPassword(passwordFor.id, newPass);
      toast.show(`Password set for ${passwordFor.username} — they can sign in with it now.`, "good");
      setPasswordFor(null);
      setNewPass("");
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't set the password.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(user: UserView) {
    const next = user.status === "disabled" ? "active" : "disabled";
    try {
      await api.updateUser(user.id, { status: next });
      toast.show(`${user.username} is now ${next}.`, "good");
      await load();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : "Couldn't update.", "danger");
    }
  }

  if (failed) return <EmptyState title="Couldn't load users." message="Try again shortly." />;
  if (users === null || tree === null) return <Skeleton lines={5} />;

  const names = new Map<string, string>();
  names.set(tree.college.id, tree.college.name);
  for (const dept of tree.departments) {
    names.set(dept.id, dept.name);
    for (const klass of dept.classes) names.set(klass.id, klass.name);
    for (const subject of dept.subjects) names.set(subject.id, subject.name);
  }
  const grantLabel = (grant: UserView["grants"][number]) => {
    const parts: string[] = [grant.role];
    if (grant.departmentId) parts.push(names.get(grant.departmentId) ?? grant.departmentId);
    if (grant.classId) parts.push(names.get(grant.classId) ?? grant.classId);
    if (grant.subjectId) parts.push(names.get(grant.subjectId) ?? grant.subjectId);
    if (!grant.departmentId && !grant.classId) parts.push("college-wide");
    return parts.join(" · ");
  };

  const grantClassOptions = tree.departments
    .filter((dept) => grantDept === "" || dept.id === grantDept)
    .flatMap((dept) => dept.classes.map((klass) => ({ id: klass.id, label: klass.name })));
  const grantSubjectOptions =
    tree.departments.find((dept) => dept.id === grantDept)?.subjects.map((s) => ({ id: s.id, label: s.name })) ?? [];

  const columns: Column<UserView>[] = [
    { key: "username", header: "Username", render: (row) => <span className="num">{row.username}</span> },
    { key: "name", header: "Name", render: (row) => row.displayName },
    {
      key: "roles",
      header: "Roles",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {row.roles.length === 0 ? <span style={{ opacity: 0.5 }}>—</span> : row.roles.map((role) => <Badge key={role}>{role}</Badge>)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.status === "active" ? "good" : row.status === "must_reset" ? "warn" : "danger"}>
          {row.status}
        </Badge>
      ),
    },
    { key: "grants", header: "Grants", align: "right", render: (row) => <span className="num">{row.grants.length}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => { setRoleDraft(row.roles); setRolesFor(row); }}>Roles</Button>
          <Button variant="ghost" onClick={() => { setGrantRole("hod"); setGrantDept(""); setGrantClass(""); setGrantSubject(""); setGrantsFor(row); }}>Grants</Button>
          <Button variant="ghost" onClick={() => setResetFor(row)}>Reset (token)</Button>
          <Button variant="ghost" onClick={() => { setNewPass(""); setPasswordFor(row); }}>Set password</Button>
          <Button variant="ghost" onClick={() => void toggleStatus(row)}>{row.status === "disabled" ? "Enable" : "Disable"}</Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Users"
        title="Sign-ins & access"
        lede="Accounts, role memberships and scope grants. Role or grant changes sign the user out everywhere."
        actions={
          <span style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={() => void runVerify()}>Verify grants</Button>
            <Button onClick={() => setCreating(true)}>New user</Button>
          </span>
        }
      />

      <DataTable columns={columns} rows={users} rowKey={(row) => row.id} empty={{ title: "No users yet." }} />

      {/* CREATE USER */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New user"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              onClick={() => void submitCreate()}
              loading={saving}
              disabled={username.trim() === "" || displayName.trim() === "" || tempPassword.length < 8}
            >
              Create user
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Username" htmlFor="usr-name">
            <input id="usr-name" value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label="Display name" htmlFor="usr-display">
            <input id="usr-display" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Field label="Temporary password" htmlFor="usr-temp" hint="At least 8 characters; the user must reset it before first sign-in.">
            <input id="usr-temp" value={tempPassword} onChange={(event) => setTempPassword(event.target.value)} />
          </Field>
          <Field label="Roles" htmlFor="usr-roles">
            <span id="usr-roles" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {ROLES.map((role) => (
                <label key={role} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={newRoles.includes(role)}
                    onChange={() => setNewRoles((current) => toggleRole(current, role))}
                    aria-label={role}
                  />
                  {role}
                </label>
              ))}
            </span>
          </Field>
        </div>
      </Modal>

      {/* ROLES */}
      <Modal
        open={rolesFor !== null}
        onClose={() => setRolesFor(null)}
        title={`Roles — ${rolesFor?.username ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRolesFor(null)}>Cancel</Button>
            <Button onClick={() => void submitRoles()} loading={saving}>Save roles</Button>
          </>
        }
      >
        <p className="field-hint" style={{ marginTop: 0 }}>
          Removing a role also removes its scope grants, and the user is signed out everywhere.
        </p>
        <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {ROLES.map((role) => (
            <label key={role} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={roleDraft.includes(role)}
                onChange={() => setRoleDraft((current) => toggleRole(current, role))}
                aria-label={role}
              />
              {role}
            </label>
          ))}
        </span>
      </Modal>

      {/* GRANTS */}
      <Modal
        open={grantsFor !== null}
        onClose={() => setGrantsFor(null)}
        title={`Scope grants — ${grantsFor?.username ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantsFor(null)}>Close</Button>
            <Button onClick={() => void submitGrant()} loading={saving}>Add grant</Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          {(grantsFor?.grants ?? []).length === 0 ? (
            <p className="strip-empty">No grants yet.</p>
          ) : (
            (grantsFor?.grants ?? []).map((grant) => (
              <div key={grant.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--rule)" }}>
                <span style={{ fontSize: 14 }}>
                  {grantLabel(grant)}{" "}
                  <Badge tone={grant.verified ? "good" : "warn"}>{grant.verified ? "verified" : "unverified"}</Badge>{" "}
                  {grant.source === "derived" ? <Badge>derived</Badge> : null}
                </span>
                {grant.source === "manual" && grantsFor ? (
                  <Button variant="ghost" onClick={() => void dropGrant(grantsFor, grant.id)}>Remove</Button>
                ) : null}
              </div>
            ))
          )}
        </div>
        <div style={{ display: "grid", gap: "var(--space-3)", borderTop: "1px solid var(--rule-strong)", paddingTop: "var(--space-4)" }}>
          <Field label="Role" htmlFor="grant-role" hint="The user must already hold this role.">
            <select
              id="grant-role"
              value={grantRole}
              onChange={(event) => { setGrantRole(event.target.value as Role); setGrantDept(""); setGrantClass(""); setGrantSubject(""); }}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </Field>
          {grantRole === "hod" || grantRole === "class_teacher" || grantRole === "teacher" ? (
            <Field label="Department" htmlFor="grant-dept">
              <select id="grant-dept" value={grantDept} onChange={(event) => { setGrantDept(event.target.value); setGrantClass(""); setGrantSubject(""); }}>
                <option value="">Choose…</option>
                {tree.departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </Field>
          ) : null}
          {(grantRole === "class_teacher" || grantRole === "teacher") && grantDept !== "" ? (
            <Field label="Class" htmlFor="grant-class">
              <select id="grant-class" value={grantClass} onChange={(event) => setGrantClass(event.target.value)}>
                <option value="">Choose…</option>
                {grantClassOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </Field>
          ) : null}
          {grantRole === "teacher" && grantDept !== "" ? (
            <Field label="Subject" htmlFor="grant-subject">
              <select id="grant-subject" value={grantSubject} onChange={(event) => setGrantSubject(event.target.value)}>
                <option value="">Choose…</option>
                {grantSubjectOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      </Modal>

      {/* RESET CONFIRM + TOKEN */}
      <ConfirmDialog
        open={resetFor !== null}
        title="Issue a reset token"
        message={`Issue a one-time password-reset token for ${resetFor?.username ?? ""}? Their current password stops working once they use it.`}
        confirmLabel="Issue token"
        onConfirm={() => void issueReset()}
        onCancel={() => setResetFor(null)}
      />
      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title={`Reset token — ${issued?.user ?? ""}`}
        footer={<Button onClick={() => setIssued(null)}>Done</Button>}
      >
        <p style={{ marginTop: 0 }}>
          Share this token out-of-band. It is shown <strong>once</strong> and never logged.
        </p>
        <p className="num" style={{ wordBreak: "break-all", background: "var(--paper-sunken)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)" }}>
          {issued?.token}
        </p>
        <p className="field-hint">Expires {issued ? new Date(issued.expiresAt).toLocaleString() : ""}.</p>
      </Modal>

      {/* SET PASSWORD (admin supplies the value directly) */}
      <Modal
        open={passwordFor !== null}
        onClose={() => setPasswordFor(null)}
        title={`Set password — ${passwordFor?.username ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordFor(null)}>Cancel</Button>
            <Button onClick={() => void setPassword()} loading={saving} disabled={newPass.length < 12}>Set password</Button>
          </>
        }
      >
        <Field
          label="New temporary password"
          htmlFor="usr-newpass"
          hint="At least 12 characters. The user signs in with this straight away and can change it from their profile. It is never stored in plain text or logged — you won't see it again."
        >
          <input id="usr-newpass" value={newPass} autoComplete="new-password" onChange={(event) => setNewPass(event.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
