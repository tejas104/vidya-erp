import styles from "./Skeleton.module.css";

export function Skeleton({
  width = "100%", height = 14,
}: { width?: string | number; height?: string | number }) {
  return <div aria-hidden="true" className={styles.skel} style={{ width, height }} />;
}
