import { useId } from 'react';
import type { CSSProperties } from 'react';

import './Slider.css';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** How the value is written, shown and read aloud ("35 %", "5 s"). */
  format?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
  disabled,
}: SliderProps) {
  const id = useId();
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const text = format(value);
  return (
    <div className="ui-slider">
      <div className="ui-slider-head">
        <label className="ui-slider-label" htmlFor={id}>
          {label}
        </label>
        <output className="ui-slider-value" htmlFor={id}>
          {text}
        </output>
      </div>
      <input
        id={id}
        className="ui-slider-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        disabled={disabled}
        style={{ '--fill': `${fill.toString()}%` } as CSSProperties}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
    </div>
  );
}
