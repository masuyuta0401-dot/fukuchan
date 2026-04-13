import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
