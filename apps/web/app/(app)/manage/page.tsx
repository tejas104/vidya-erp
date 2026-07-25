"use client";
import { PageHeader } from "@vidya/ui-system";
import styles from "./page.module.css";
export const dynamic = "force-dynamic";
export default function ManageIndex() {
  return (
    <>
      <PageHeader title="The office" />
      <p className={styles.lede}>Pick a task from the sidebar. You only see the areas your role can act on.</p>
    </>
  );
}
