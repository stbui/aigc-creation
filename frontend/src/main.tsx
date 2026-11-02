import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import './ui/styles.css';
import App from './App';
import { UiProvider } from './ui';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </React.StrictMode>
);
