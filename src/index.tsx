import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import RootRoutes from './routes';
import './styles/tokens.css';
import './styles/components.css';
import './styles/theme-dark.css';
import { applyTheme, getInitialTheme } from './hooks/useTheme';

// Применяем сохранённую тему до рендера, чтобы не было «мигания» светлой темы.
applyTheme(getInitialTheme());

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HashRouter>
      <RootRoutes />
    </HashRouter>
  </React.StrictMode>
);
