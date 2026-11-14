/** A row of colours of the palette, each by its token (tokens.css) and its name. */
export function Swatches({
  label,
  colors,
}: {
  label: string;
  colors: readonly (readonly [name: string, token: `--${string}`])[];
}) {
  return (
    <figure className="notebook-swatches">
      <ul>
        {colors.map(([name, token]) => (
          <li key={token}>
            <span
              className="notebook-swatch"
              style={{ background: `var(${token})` }}
              aria-hidden="true"
            />
            <span>{name}</span>
          </li>
        ))}
      </ul>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
