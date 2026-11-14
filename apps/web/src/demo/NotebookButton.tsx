import { BookIcon } from '../ui/primitives/index.ts';

/**
 * "Cómo se hizo" (D113, D115): the notebook, as one more round icon with
 * Ajustes and Rebobinar, where it is found without adding noise; only on a
 * computer with a mouse (ui.css, D116). A link to
 * its own page; leaving starts the demo afresh, as a reload does. Built
 * into the demo only (App.tsx loads it lazily there).
 */
export default function NotebookButton() {
  return (
    <a
      className="ui-icon-button hud-floating notebook-button"
      data-size="lg"
      href="/cuaderno"
      aria-label="Cómo se hizo"
      title="Cómo se hizo"
    >
      <BookIcon />
    </a>
  );
}
