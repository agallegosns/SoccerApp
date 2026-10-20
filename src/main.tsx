import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './ui/tokens.css';
import './ui/base.css';
import './ui/components.css';
import './app/app.css';
import { App } from './app/App.tsx';
import { startAutoUpdate } from './app/autoUpdate.ts';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('No se encontró el contenedor #root');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startAutoUpdate();
