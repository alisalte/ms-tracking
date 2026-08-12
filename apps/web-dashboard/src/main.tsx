/**
 * Application entry point.
 *
 * Mounts the React app into the #root element.
 * Initializes i18n before rendering.
 */
import '@/i18n';
import '@/styles/global.css';
import '@/styles/tailwind.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App';

import { createRoot } from 'react-dom/client';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Root element not found. Ensure there is a <div id='root'> in index.html.");
}

createRoot(rootElement).render(<App />);
