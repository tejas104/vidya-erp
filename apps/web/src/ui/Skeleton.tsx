export function Skeleton({ lines = 1, width = "100%" }: { lines?: number; width?: string | number }) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="ui-skel" style={{ width: index === lines - 1 && lines > 1 ? "60%" : width }} />
      ))}
    </div>
  );
}
