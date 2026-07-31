import { Icon } from "./Icon";

/**
 * "Outside your scope" denial — distinct from EmptyState (which means "there's
 * nothing here yet"). This means "there's something here, but not for you."
 */
export function DeniedState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="state state-denied" role="alert" aria-live="polite">
      <Icon name="key" />
      <span>
        <strong>{title}</strong>
        {message !== undefined ? <> {message}</> : null}
      </span>
    </div>
  );
}
