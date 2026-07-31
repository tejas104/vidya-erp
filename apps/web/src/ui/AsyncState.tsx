"use client";
import type { ReactNode } from "react";
import { Skeleton, Button } from "@vidya/ui-system";
import styles from "./AsyncState.module.css";
export function AsyncState({
  loading, error, errorMessage, onRetry, isEmpty, empty, children,
}: {
  loading: boolean; error: boolean; errorMessage?: ReactNode; onRetry?: () => void;
  isEmpty?: boolean; empty?: ReactNode; children: ReactNode;
}) {
  if (loading) {
    return (
      <div className={styles.rows} aria-busy="true">
        <Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} />
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.error} role="alert">
        <span>{errorMessage ?? "Couldn't load this."}</span>
        {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
      </div>
    );
  }
  if (isEmpty && empty !== undefined) return <>{empty}</>;
  return <>{children}</>;
}
