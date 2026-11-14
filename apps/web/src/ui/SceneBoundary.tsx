import { Component } from 'react';
import type { ReactNode } from 'react';

import { useSettings } from '../app/settings.ts';

/**
 * If the 3D cannot start or breaks (no WebGL, a lost context, a failed
 * model), the app falls back to the plant list instead of a blank page
 * (A3, D86); the settings say why.
 */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.warn('The 3D scene failed; showing the plant list instead.', error);
    useSettings.getState().markWebglFailed();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
