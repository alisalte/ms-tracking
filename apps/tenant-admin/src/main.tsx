import '@/i18n';
import '@/styles.css';
import App from './App';

import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { i18n } from '@/i18n';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

document.documentElement.lang = i18n.language.startsWith('fa') ? 'fa' : 'en';
document.documentElement.dir = i18n.language.startsWith('fa') ? 'rtl' : 'ltr';

createRoot(rootElement).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
