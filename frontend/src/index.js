import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Невидимое окно выгрузки для печати запускает html-страницу мимо App: там
// сокет, уведомления и весь каркас портала, а окну нужна только сама
// страница (см. pages/PrintRender.js). Окно узнаём по параметру, а не по
// своему пути: адрес у него обычный /page/<slug>, потому что шаблоны
// html-страниц берут slug из адреса и без него показывают набор по умолчанию.
if (new URLSearchParams(window.location.search).has('alfa-print')) {
  import('./pages/PrintRender').then(({ default: runPrintRender }) => {
    runPrintRender(document.getElementById('root'));
  });
} else {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <App />
  );
}
