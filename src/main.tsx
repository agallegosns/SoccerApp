import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.tsx';
import './ui/tokens.css';
import './ui/base.css';
import './app/app.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('No se encontró el contenedor #root');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
