import { configExample } from '@vitreo/shared/fixtures';
import type { ConfigMessage } from '@vitreo/shared';
import { describe, expect, it } from 'vitest';

import { useAutomation } from './automation.ts';
import { useThresholds } from './thresholds.ts';

describe('each plant threshold (D100)', () => {
  it("starts with the species' proposals and follows config", () => {
    expect(useThresholds.getState().get('basil_01')).toBe(0.4);
    const config = configExample as unknown as ConfigMessage;
    useAutomation.setState({
      state: {
        config: {
          ...config,
          watering: config.watering.map((rule) =>
            rule.zone === 'basil_01' ? { ...rule, enabled: false, threshold: 0.55 } : rule,
          ),
        },
        appliedRev: null,
        rejected: null,
      },
    });
    expect(useThresholds.getState().get('basil_01')).toBe(0.55);
    expect(useThresholds.getState().get('tomato_01')).toBe(0.4);
  });
});
