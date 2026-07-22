"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Modal, Skeleton, EmptyState, Input } from "@vidya/ui-system";
import { buildIndex, filterIndex, getCachedIndex, type IndexEntry } from "./searchIndex";
import { api, type Role } from "../api";
import styles from "./SearchPalette.module.css";

const DEBOUNCE_MS = 150;

export function SearchPalette({
  open, onClose, roles,
}: { open: boolean; onClose: () => void; roles: Role[] }) {
  const router = useRouter();
  const [index, setIndex] = useState<IndexEntry[] | null>(() => getCachedIndex());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // Guards against a second concurrent build — Retry is imperative and the
  // open-effect must never stack a second build on top of an in-flight one.
  const loadingRef = useRef(false);
  function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadError(false);
    setProgress(null);
    buildIndex(api, roles, (done, total) => setProgress({ done, total }))
      .then((entries) => setIndex(entries))
      .catch(() => setLoadError(true))
      .finally(() => {
        loadingRef.current = false;
      });
  }

  // Cold-start build on open. Fires on `open` transitions only — NOT on
  // loadError, so Retry (imperative, guarded) can't re-trigger it into a
  // double build. getCachedIndex() already seeded `index` when a prior open
  // built it, so a warm re-open does nothing.
  useEffect(() => {
    if (open && index === null && !loadError) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Modal's focus-trap lands on the Close button on open; move focus to the
  // search input (after the trap's effect) so Cmd-K → type works immediately.
  const inputWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      inputWrapRef.current?.querySelector("input")?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setQ(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const { pages, students } = useMemo(
    () => (index ? filterIndex(index, q) : { pages: [], students: [] }),
    [index, q],
  );
  const flat = useMemo(() => [...pages, ...students], [pages, students]);

  useEffect(() => {
    setActiveIndex(0);
  }, [q, index]);

  function select(entry: IndexEntry) {
    router.push(entry.href);
    onClose();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = flat[activeIndex];
      if (entry) select(entry);
    }
  }

  function renderGroup(label: string, entries: IndexEntry[]) {
    if (entries.length === 0) return null;
    return (
      <div className={styles.group}>
        <div className={styles.groupHeader}>{label}</div>
        {entries.map((entry) => {
          const i = flat.indexOf(entry);
          return (
            <button
              key={entry.href}
              type="button"
              className={i === activeIndex ? `${styles.row} ${styles.active}` : styles.row}
              onClick={() => select(entry)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span>{entry.label}</span>
              {entry.roll !== undefined ? <span className={styles.roll}>{entry.roll}</span> : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Search">
      <div ref={inputWrapRef}>
        <Input
          label="Search students or pages"
          placeholder="Search students or pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.results}>
        {index === null && !loadError ? (
          <div className={styles.loadingRow}>
            <Skeleton height={16} />
            <span className={styles.loadingLabel}>
              Students — loading {progress?.done ?? 0}/{progress?.total ?? 0} sections
            </span>
          </div>
        ) : null}
        {loadError ? (
          <div className={styles.errorRow}>
            <span>Couldn&apos;t load search index.</span>
            <button type="button" className={styles.retryBtn} onClick={load}>
              Retry
            </button>
          </div>
        ) : null}
        {index !== null && q.trim() !== "" && flat.length === 0 ? (
          <EmptyState title="No results" body={`No matches for "${q}"`} />
        ) : null}
        {renderGroup("Pages", pages)}
        {renderGroup("Students", students)}
      </div>
    </Modal>
  );
}
