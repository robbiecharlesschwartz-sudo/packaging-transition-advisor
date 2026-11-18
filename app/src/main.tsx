import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const embed = window.location.pathname.startsWith('/embed/replay');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App embed={embed} />
  </StrictMode>,
);
