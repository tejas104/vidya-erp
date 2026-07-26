"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  type GrantInput,
  type OrgTree,
  type Role,
  type UserView,
} from "@/ui/api";
import {
  useToast,
  Button,
  Input,
  Select,
  Modal,
  Table,
  StatusBadge,
  EmptyState,
  Skeleton,
  PageHeader,
  type TableColumn,
} from "@vidya/ui-system";
import { AsyncState } from "@/ui/AsyncState";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "principal", "hod", "class_teacher", "teacher"];

type Row = {
  username: ReactNode;
  name: ReactNode;
  roles: ReactNode;
  status: ReactNode;
  grants: ReactNode;
  actions: ReactNode;
};

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
    setFailed(false);
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
      toast.push({ status: "good", message: `"${username.trim()}" created — they must reset the temporary password before first sign-in.` });
      setCreating(false);
      setUsername("");
      setDisplayName("");
      setTempPassword("");
      setNewRoles([]);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't create the user." });
    } finally {
      setSaving(false);
    }
  }

  async function submitRoles() {
    if (!rolesFor) return;
    setSaving(true);
    try {
      await api.setUserRoles(rolesFor.id, roleDraft);
      toast.push({ status: "good", message: `Roles updated for ${rolesFor.username} — their sessions were signed out.` });
      setRolesFor(null);
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't update roles." });
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
      toast.push({ status: "good", message: "Grant added — their sessions were signed out." });
      await load();
      setGrantsFor(null);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't add the grant." });
    } finally {
      setSaving(false);
    }
  }

  async function dropGrant(user: UserView, grantId: string) {
    try {
      await api.removeGrant(user.id, grantId);
      toast.push({ status: "good", message: "Grant removed." });
      await load();
      setGrantsFor(null);
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't remove the grant." });
    }
  }

  async function runVerify() {
    try {
      const result = await api.verifyGrants();
      toast.push({
        status: result.unresolved.length > 0 ? "info" : "good",
        message: `Verified ${result.verified} grant(s); ${result.unresolved.length} unresolved.`,
      });
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Verification failed." });
    }
  }

  async function issueReset() {
    if (!resetFor) return;
    try {
      const { token, expiresAt } = await api.passwordResetInit(resetFor.id);
      setIssued({ user: resetFor.username, token, expiresAt });
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't issue the token." });
    } finally {
      setResetFor(null);
    }
  }

  async function setPassword() {
    if (!passwordFor || newPass.length < 12) return;
    setSaving(true);
    try {
      await api.setUserPassword(passwordFor.id, newPass);
      toast.push({ status: "good", message: `Password set for ${passwordFor.username} — they can sign in with it now.` });
      setPasswordFor(null);
      setNewPass("");
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't set the password." });
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(user: UserView) {
    const next = user.status === "disabled" ? "active" : "disabled";
    try {
      await api.updateUser(user.id, { status: next });
      toast.push({ status: "good", message: `${user.username} is now ${next}.` });
      await load();
    } catch (caught) {
      toast.push({ status: "danger", message: caught instanceof ApiError ? caught.message : "Couldn't update." });
    }
  }

  const names = new Map<string, string>();
  if (tree) {
    names.set(tree.college.id, tree.college.name);
    for (const dept of tree.departments) {
      names.set(dept.id, dept.name);
      for (const klass of dept.classes) names.set(klass.id, klass.name);
      for (const subject of dept.subjects) names.set(subject.id, subject.name);
    }
  }
  const grantLabel = (grant: UserView["grants"][number]) => {
    const parts: string[] = [grant.role];
    if (grant.departmentId) parts.push(names.get(grant.departmentId) ?? grant.departmentId);
    if (grant.classId) parts.push(names.get(grant.classId) ?? grant.classId);
    if (grant.subjectId) parts.push(names.get(grant.subjectId) ?? grant.subjectId);
    if (!grant.departmentId && !grant.classId) parts.push("college-wide");
    return parts.join(" · ");
  };

  const grantClassOptions = (tree?.departments ?? [])
    .filter((dept) => grantDept === "" || dept.id === grantDept)
    .flatMap((dept) => dept.classes.map((klass) => ({ id: klass.id, label: klass.name })));
  const grantSubjectOptions =
    tree?.departments.find((dept) => dept.id === grantDept)?.subjects.map((s) => ({ id: s.id, label: s.name })) ?? [];

  if (failed) return <EmptyState title="Couldn't load users." body="Try again shortly." />;
  if (users === null || tree === null) {
    return (
      <div className={styles.skeletonStack} aria-hidden="true">
        <Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} />
      </div>
    );
  }

  const columns: TableColumn<Row>[] = [
    { key: "username", header: "Username", figure: true },
    { key: "name", header: "Name" },
    { key: "roles", header: "Roles" },
    { key: "status", header: "Status" },
    { key: "grants", header: "Grants", figure: true },
    { key: "actions", header: "" },
  ];
  const rows: Row[] = (users ?? []).map((row) => ({
    username: <span className="num">{row.username}</span>,
    name: row.displayName,
    roles: (
      <span className={styles.badgeRow}>
        {row.roles.length === 0 ? <span className={styles.dim}>—</span> : row.roles.map((role) => <StatusBadge key={role} status="neutral">{role}</StatusBadge>)}
      </span>
    ),
    status: (
      <StatusBadge status={row.status === "active" ? "good" : row.status === "must_reset" ? "warn" : "danger"}>
        {row.status}
      </StatusBadge>
    ),
    grants: <span className="num">{row.grants.length}</span>,
    actions: (
      <span className={styles.tableActions}>
        <Button variant="ghost" onClick={() => { setRoleDraft(row.roles); setRolesFor(row); }}>Roles</Button>
        <Button variant="ghost" onClick={() => { setGrantRole("hod"); setGrantDept(""); setGrantClass(""); setGrantSubject(""); setGrantsFor(row); }}>Grants</Button>
        <Button variant="ghost" onClick={() => setResetFor(row)}>Reset (token)</Button>
        <Button variant="ghost" onClick={() => { setNewPass(""); setPasswordFor(row); }}>Set password</Button>
        <Button variant="ghost" onClick={() => void toggleStatus(row)}>{row.status === "disabled" ? "Enable" : "Disable"}</Button>
      </span>
    ),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Users"
        title="Sign-ins & access"
        actions={
          <span className={styles.headerActions}>
            <Button variant="ghost" onClick={() => void runVerify()}>Verify grants</Button>
            <Button onClick={() => setCreating(true)}>New user</Button>
          </span>
        }
      />
      <p className={styles.lede}>Accounts, role memberships and scope grants. Role or grant changes sign the user out everywhere.</p>

      <AsyncState loading={false} error={false} isEmpty={users.length === 0} empty={<EmptyState title="No users yet." />}>
        <Table columns={columns} rows={rows} />
      </AsyncState>

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
        <div className={styles.formGrid}>
          <Input id="usr-name" label="Username" value={username} onChange={(event) => setUsername(event.target.value)} />
          <Input id="usr-display" label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <Input
            id="usr-temp"
            label="Temporary password"
            hint="At least 8 characters; the user must reset it before first sign-in."
            value={tempPassword}
            onChange={(event) => setTempPassword(event.target.value)}
          />
          <div className={styles.field}>
            <label htmlFor="usr-roles" className={styles.label}>Roles</label>
            <span id="usr-roles" className={styles.rolesRow}>
              {ROLES.map((role) => (
                <label key={role} className={styles.roleLabel}>
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
          </div>
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
        <p className={`field-hint ${styles.noTopMargin}`}>
          Removing a role also removes its scope grants, and the user is signed out everywhere.
        </p>
        <span className={styles.rolesRow}>
          {ROLES.map((role) => (
            <label key={role} className={styles.roleLabel}>
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
        <div className={styles.grantsList}>
          {(grantsFor?.grants ?? []).length === 0 ? (
            <p className="strip-empty">No grants yet.</p>
          ) : (
            (grantsFor?.grants ?? []).map((grant) => (
              <div key={grant.id} className={styles.grantRow}>
                <span className={styles.grantMeta}>
                  {grantLabel(grant)}{" "}
                  <StatusBadge status={grant.verified ? "good" : "warn"}>{grant.verified ? "verified" : "unverified"}</StatusBadge>{" "}
                  {grant.source === "derived" ? <StatusBadge status="neutral">derived</StatusBadge> : null}
                </span>
                {grant.source === "manual" && grantsFor ? (
                  <Button variant="ghost" onClick={() => void dropGrant(grantsFor, grant.id)}>Remove</Button>
                ) : null}
              </div>
            ))
          )}
        </div>
        <div className={styles.grantForm}>
          <Select
            id="grant-role"
            label="Role"
            hint="The user must already hold this role."
            value={grantRole}
            onChange={(event) => { setGrantRole(event.target.value as Role); setGrantDept(""); setGrantClass(""); setGrantSubject(""); }}
            options={ROLES.map((role) => ({ value: role, label: role }))}
          />
          {grantRole === "hod" || grantRole === "class_teacher" || grantRole === "teacher" ? (
            <Select
              id="grant-dept"
              label="Department"
              value={grantDept}
              onChange={(event) => { setGrantDept(event.target.value); setGrantClass(""); setGrantSubject(""); }}
              options={[{ value: "", label: "Choose…" }, ...(tree?.departments ?? []).map((dept) => ({ value: dept.id, label: dept.name }))]}
            />
          ) : null}
          {(grantRole === "class_teacher" || grantRole === "teacher") && grantDept !== "" ? (
            <Select
              id="grant-class"
              label="Class"
              value={grantClass}
              onChange={(event) => setGrantClass(event.target.value)}
              options={[{ value: "", label: "Choose…" }, ...grantClassOptions.map((option) => ({ value: option.id, label: option.label }))]}
            />
          ) : null}
          {grantRole === "teacher" && grantDept !== "" ? (
            <Select
              id="grant-subject"
              label="Subject"
              value={grantSubject}
              onChange={(event) => setGrantSubject(event.target.value)}
              options={[{ value: "", label: "Choose…" }, ...grantSubjectOptions.map((option) => ({ value: option.id, label: option.label }))]}
            />
          ) : null}
        </div>
      </Modal>

      {/* RESET CONFIRM */}
      <Modal
        open={resetFor !== null}
        onClose={() => setResetFor(null)}
        title="Issue a reset token"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetFor(null)}>Cancel</Button>
            <Button onClick={() => void issueReset()}>Issue token</Button>
          </>
        }
      >
        <p className={styles.noMargin}>
          Issue a one-time password-reset token for {resetFor?.username ?? ""}? Their current password stops working once they use it.
        </p>
      </Modal>

      {/* TOKEN */}
      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title={`Reset token — ${issued?.user ?? ""}`}
        footer={<Button onClick={() => setIssued(null)}>Done</Button>}
      >
        <p className={styles.noTopMargin}>
          Share this token out-of-band. It is shown <strong>once</strong> and never logged.
        </p>
        <p className={`num ${styles.tokenBox}`}>{issued?.token}</p>
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
        <Input
          id="usr-newpass"
          label="New temporary password"
          hint="At least 12 characters. The user signs in with this straight away and can change it from their profile. It is never stored in plain text or logged — you won't see it again."
          value={newPass}
          autoComplete="new-password"
          onChange={(event) => setNewPass(event.target.value)}
        />
      </Modal>
    </>
  );
}
