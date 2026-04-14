import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import type { VsCodeApi } from './types';

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App vscode={vscode} />
  </React.StrictMode>,
);
