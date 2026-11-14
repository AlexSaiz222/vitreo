import './DialGauge.css';

/** The dial sweeps 270°, from bottom left (135°) clockwise to bottom right. */
const START_DEG = 135;
const SWEEP_DEG = 270;
const CENTRE = 100;

export interface DialGaugeProps {
  /** What it measures, for screen readers and the caption ("Depósito"). */
  label: string;
  /** 0–1 along the dial; null when there is no reading (never drawn as 0). */
  value: number | null;
  /** The value as written: "70 %", "22,4 °C". */
  valueText: string;
  /** A mark on the dial, 0–1 (e.g. a plant's watering threshold). */
  threshold?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Shown under the value in the large dial. */
  caption?: string;
}

function point(fraction: number, radius: number): [number, number] {
  const angle = ((START_DEG + SWEEP_DEG * fraction) * Math.PI) / 180;
  return [CENTRE + radius * Math.cos(angle), CENTRE + radius * Math.sin(angle)];
}

/**
 * A dial with tick marks, as in the reference (`ui-neumorphism-01.png`).
 * The ticks up to the value are drawn in ink and the rest stay faint; the
 * number is always written in the middle, so the dial is never the only
 * way to read it. Without a reading every tick stays faint and it says so.
 */
export function DialGauge({
  label,
  value,
  valueText,
  threshold,
  size = 'lg',
  caption,
}: DialGaugeProps) {
  const ticks = size === 'sm' ? 25 : size === 'md' ? 33 : 41;
  const [outer, inner] = size === 'sm' ? [94, 74] : size === 'md' ? [94, 78] : [94, 80];
  const known = value !== null;
  const shown = known ? Math.min(1, Math.max(0, value)) : 0;
  const text = known ? valueText : 'Sin dato';
  const meter = known
    ? {
        role: 'meter',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round(shown * 100),
        'aria-valuetext': valueText,
      }
    : { role: 'img' };
  const [markX, markY] = point(shown, outer + 1);

  return (
    <div className="ui-dial" data-size={size} aria-label={`${label}: ${text}`} {...meter}>
      <svg className="ui-dial-ticks" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        {Array.from({ length: ticks }, (_, i) => {
          const fraction = i / (ticks - 1);
          const [x1, y1] = point(fraction, inner);
          const [x2, y2] = point(fraction, outer);
          return (
            <line
              key={i}
              className="ui-dial-tick"
              data-active={known && fraction <= shown + 1e-6}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          );
        })}
        {threshold !== undefined && (
          <line
            className="ui-dial-threshold"
            x1={point(threshold, inner - 10)[0]}
            y1={point(threshold, inner - 10)[1]}
            x2={point(threshold, outer + 4)[0]}
            y2={point(threshold, outer + 4)[1]}
          />
        )}
        {known && (
          <circle
            className="ui-dial-mark"
            cx={markX}
            cy={markY}
            r={size === 'sm' ? 8 : size === 'md' ? 6 : 5}
          />
        )}
      </svg>
      <div className="ui-dial-knob" aria-hidden="true">
        <span className="ui-dial-value">{known ? valueText : '—'}</span>
        {size !== 'sm' && <span className="ui-dial-caption">{known ? caption : 'sin dato'}</span>}
      </div>
    </div>
  );
}
