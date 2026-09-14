# About this deployment and backups

This screen shows exactly which version of Vidya is running — have it open
when you contact support or fill in the license register.

## Steps

1. Open **System** from the sidebar (under Manage).
2. Note the **Version** and **Build (git SHA)** shown.
3. Quote the **Deployed version** (the two combined) to support, and match it against your license register's deployed-version column.

## Review recorded activity

The **Audit log** lists the newest recorded events for administrators. Select an
event window of 50, 100 or 200, optionally enter an exact action such as
`identity.login-failed`, and choose **Apply filter**. **View details** reveals the
recorded details and request identifier. **Refresh** reloads the current filter.
When the window is full, older events may exist beyond it; narrow the action or
increase the window. This screen does not change or delete audit records.

If licence details or the audit log cannot load, use the corresponding retry
button. Version and build information remain available for support.

Backups are not run from this screen. They are handled on a schedule by your IT support or hosting team — ask them for the backup-and-restore runbook if you need to check when the last one ran or how to request a restore.

> Screenshot: the About this deployment panel showing version and build.
