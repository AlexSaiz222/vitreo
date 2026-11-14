import { useShortcutsHelp } from '../app/shortcuts.ts';
import { Sheet } from './primitives/index.ts';

const SHORTCUTS = [
  ['1 – 6', 'Abrir una planta'],
  ['L', 'Encender o apagar la luz'],
  ['H', 'Volver a la vista inicial'],
  ['Esc', 'Cerrar'],
  ['?', 'Esta lista'],
] as const;

/** The keyboard shortcuts, listed (opened with ?). */
export function ShortcutsHelp() {
  const open = useShortcutsHelp((state) => state.open);
  const set = useShortcutsHelp((state) => state.set);
  if (!open) return null;
  return (
    <Sheet
      title="Atajos de teclado"
      onClose={() => {
        set(false);
      }}
    >
      <dl className="shortcut-list">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys} className="shortcut">
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
