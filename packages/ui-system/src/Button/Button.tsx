import styles from "./Button.module.css";

export function Button({ children }: { children: React.ReactNode }) {
  return <button type="button" className={styles.btn} data-spike="1">{children}</button>;
}
