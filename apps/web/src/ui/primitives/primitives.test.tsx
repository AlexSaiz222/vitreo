// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DialGauge } from './DialGauge.tsx';
import { MoistureDrop } from './MoistureDrop.tsx';
import { IconButton, Button } from './Button.tsx';
import { CloseIcon } from './icons.tsx';
import { Segmented } from './Segmented.tsx';
import { Sheet } from './Sheet.tsx';
import { Slider } from './Slider.tsx';
import { Toggle } from './Toggle.tsx';

beforeAll(() => {
  // jsdom has no matchMedia; the sheet asks whether the screen is narrow.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(cleanup);

describe('Toggle', () => {
  it('is a switch that flips with a click (Space and Enter click a button)', () => {
    function Example() {
      const [on, setOn] = useState(false);
      return <Toggle label="Riego automático" checked={on} onChange={setOn} />;
    }
    render(<Example />);
    const toggle = screen.getByRole('switch', { name: 'Riego automático' });
    expect(toggle).toHaveProperty('ariaChecked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveProperty('ariaChecked', 'true');
  });
});

describe('Segmented', () => {
  const OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 'day', label: 'Día' },
    { value: 'night', label: 'Noche' },
  ] as const;

  function Example() {
    const [value, setValue] = useState<(typeof OPTIONS)[number]['value']>('day');
    return <Segmented label="Apariencia" value={value} options={OPTIONS} onChange={setValue} />;
  }

  it('has a single Tab stop, on the chosen option', () => {
    render(<Example />);
    const tabbable = screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0);
    expect(tabbable.map((radio) => radio.textContent)).toEqual(['Día']);
  });

  it('moves and chooses with the arrows, wrapping around, and Home/End', () => {
    render(<Example />);
    const day = screen.getByRole('radio', { name: 'Día' });
    fireEvent.keyDown(day, { key: 'ArrowRight' });
    const night = screen.getByRole('radio', { name: 'Noche' });
    expect(night).toHaveProperty('ariaChecked', 'true');
    expect(document.activeElement).toBe(night);
    fireEvent.keyDown(night, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveProperty('ariaChecked', 'true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Auto' }), { key: 'End' });
    expect(night).toHaveProperty('ariaChecked', 'true');
  });
});

describe('Sheet', () => {
  it('takes the focus, closes with Escape and gives the focus back', () => {
    const onClose = vi.fn();
    render(<button type="button">Abrir</button>);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    opener.focus();
    const { unmount } = render(
      <Sheet title="Albahaca" onClose={onClose}>
        <p>Está bien.</p>
      </Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Albahaca' }));
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(opener);
  });
});

describe('DialGauge', () => {
  it('is a meter with the value in words', () => {
    render(<DialGauge label="Depósito" value={0.7} valueText="70 %" />);
    const meter = screen.getByRole('meter', { name: 'Depósito: 70 %' });
    expect(meter.getAttribute('aria-valuenow')).toBe('70');
  });

  it('never draws a missing reading as zero', () => {
    render(<DialGauge label="Depósito" value={null} valueText="" />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByRole('img', { name: 'Depósito: Sin dato' })).toBeTruthy();
    expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(0);
  });
});

describe('buttons', () => {
  it('an icon button is named for screen readers', () => {
    render(<IconButton label="Cerrar" icon={<CloseIcon />} />);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('a switching button says whether it is on', () => {
    render(<Button pressed>Luz</Button>);
    expect(screen.getByRole('button', { name: 'Luz' })).toHaveProperty('ariaPressed', 'true');
  });
});

describe('Slider', () => {
  it('reads its value aloud as written', () => {
    render(
      <Slider
        label="Umbral"
        value={35}
        min={10}
        max={80}
        onChange={() => undefined}
        format={(v) => `${v.toString()} %`}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Umbral' }).getAttribute('aria-valuetext')).toBe(
      '35 %',
    );
  });
});

describe('MoistureDrop', () => {
  const water = () => document.querySelector('.ui-moisture-drop-water');

  it('fills from the bottom as far as the soil is wet', () => {
    const { rerender } = render(<MoistureDrop moisture={0.68} />);
    const full = 20.3 - 2.8;
    expect(Number(water()?.getAttribute('height'))).toBeCloseTo(full * 0.68);
    rerender(<MoistureDrop moisture={0.2} thirsty />);
    expect(Number(water()?.getAttribute('height'))).toBeCloseTo(full * 0.2);
    expect(document.querySelector('.ui-moisture-drop')?.getAttribute('data-state')).toBe('thirsty');
  });

  it('draws no water without a reading (never as zero, never as full)', () => {
    render(<MoistureDrop moisture={null} />);
    expect(water()).toBeNull();
    expect(document.querySelector('.ui-moisture-drop')?.getAttribute('data-state')).toBe('unknown');
  });
});
