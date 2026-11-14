import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { carriedMix } from '../features/sound/carry.ts';
import { runAmbient } from '../features/sound/run.ts';
import { Notebook } from './Notebook.tsx';
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';

// The notebook's own page (cuaderno.html, D113): only the notebook, none of
// the app's data layer, worker or 3D. The greenhouse's sound goes on here,
// as it was sounding when you left the demo (D129), if it was on.
runAmbient(carriedMix);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <Notebook />
  </StrictMode>,
);
