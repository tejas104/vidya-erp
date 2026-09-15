import { EmptyState, SlideOver } from "@vidya/ui-system";
import { HELP_DOCS } from "./help-content.generated";
import { useHelpEdition } from "./HelpEditionContext";

/**
 * Looks `slug` up in the runtime edition's build-time-compiled HELP_DOCS and renders it inside
 * the shared SlideOver. `doc.html` is pre-escaped by scripts/compile-help.ts
 * from repo-controlled markdown — dangerouslySetInnerHTML is safe and
 * intended here (no sanitiser dependency per ADR-0009).
 *
 * The SlideOver's own title stays generic ("Help") rather than echoing the
 * doc's title: the doc's `<h1>` already carries that heading in the body,
 * and duplicating it would give screen readers (and tests) two headings
 * with the same name.
 */
export function HelpPanel({
  slug,
  open,
  onClose,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
}) {
  const edition = useHelpEdition();
  const doc = HELP_DOCS[edition][slug];
  return (
    <SlideOver open={open} onClose={onClose} title="Help">
      {doc ? (
        <div dangerouslySetInnerHTML={{ __html: doc.html }} />
      ) : (
        <EmptyState title="No help yet for this screen." />
      )}
    </SlideOver>
  );
}
