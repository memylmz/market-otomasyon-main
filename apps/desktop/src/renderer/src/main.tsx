import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import './stil.css';

const kok = document.getElementById('kok');
if (!kok) throw new Error('Kök öğe bulunamadı');

createRoot(kok).render(
  <StrictMode>
    {/* Electron dosya protokolünde çalıştığı için HashRouter kullanılır. */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
