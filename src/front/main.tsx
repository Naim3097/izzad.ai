import '@fontsource-variable/inter/opsz.css';
import '@fontsource/anton/400.css';
import '@fontsource/bungee/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Funnel } from './Funnel';
import './front.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Funnel />
  </StrictMode>,
);
