import { Button } from "../Button/Button";
import styles from "./EmptyState.module.css";

export function EmptyState({
  title, body, action,
}: { title: string; body?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={styles.state}>
      <div className={styles.title}>{title}</div>
      {body !== undefined ? <div>{body}</div> : null}
      {action !== undefined ? (
        <div className={styles.action}>
          <Button onClick={action.onClick}>{action.label}</Button>
        </div>
      ) : null}
    </div>
  );
}
