/**
 * Материалы для рассылки.
 *
 * Ссылка на анкету одна и постоянная — её отправляют сразу нескольким врачам,
 * вешают в вакансию и показывают по QR на собеседовании. Нигде в базе она не
 * лежит: это просто адрес, и собирает его бэкенд из PUBLIC_BASE_URL.
 *
 * Экран нужен ровно потому, что иначе этот адрес приходится узнавать у
 * разработчика, а QR — рисовать в стороннем сервисе.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Download, Printer, AlertTriangle } from 'lucide-react';

import { onboarding as api } from '../../services/api';
import './Onboarding.css';

export default function OnboardingMaterials() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.materials()
      .then(({ data: res }) => setData(res))
      .catch(() => toast.error('Не удалось собрать материалы'));
  }, []);

  if (!data) return <div className="onb-empty">Загружаем…</div>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.url);
      toast.success('Ссылка скопирована');
    } catch {
      toast.error('Браузер не дал скопировать — выделите вручную');
    }
  };

  const downloadSvg = () => {
    const blob = new Blob([data.qrSvg], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'anketa-qr.svg';
    link.click();
    URL.revokeObjectURL(href);
  };

  const downloadPng = () => {
    const link = document.createElement('a');
    link.href = data.qrPng;
    link.download = 'anketa-qr.png';
    link.click();
  };

  /**
   * Печать — отдельным окном с одним QR и адресом. Печатать раздел целиком
   * бессмысленно: на лист уедут навигация и меню портала.
   */
  const print = () => {
    const win = window.open('', '_blank', 'width=600,height=800');
    if (!win) return toast.error('Браузер заблокировал окно печати');
    win.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
      <title>Анкета врача</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
               text-align: center; padding: 48px 24px; }
        h1 { font-size: 24px; margin: 0 0 6px; }
        p { color: #555; margin: 0 0 32px; font-size: 15px; }
        svg { width: 320px; height: 320px; }
        .url { margin-top: 24px; font-size: 15px; word-break: break-all; }
      </style></head><body>
      <h1>Анкета врача</h1>
      <p>Сеть медицинских центров «Альфа»</p>
      ${data.qrSvg}
      <div class="url">${data.url}</div>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <>
      {!data.baseConfigured && (
        <div className="onb-empty is-compact is-left">
          <div className="onb-step-head">
            <AlertTriangle size={15} color="var(--error)" />
            <b>Адрес портала не задан</b>
          </div>
          Ссылка собрана из умолчания. Пока в <code>.env</code> не прописан
          PUBLIC_BASE_URL, печатать QR рано — проверьте, что адрес ниже открывается снаружи.
        </div>
      )}

      <div className="onb-mat">
        <div className="onb-qr" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />

        <div>
          <div className="onb-sect">Ссылка на анкету</div>
          <div className="onb-link">
            <span>{data.url}</span>
            <button className="onb-btn is-sm" onClick={copy}><Copy size={13} /> Копировать</button>
          </div>

          <div className="onb-sect">QR-код</div>
          <div className="onb-acts">
            <button className="onb-btn is-sm" onClick={print}><Printer size={13} /> Печать</button>
            <button className="onb-btn is-sm" onClick={downloadSvg}><Download size={13} /> SVG</button>
            <button className="onb-btn is-sm" onClick={downloadPng}><Download size={13} /> PNG</button>
          </div>

          <div className="onb-sect">Как это работает</div>
          <ul className="onb-check">
            <li className="is-done">Ссылка одна и постоянная — её можно отправить сразу нескольким врачам</li>
            <li className="is-done">Каждое заполнение формы создаёт отдельную заявку</li>
            <li className="is-done">Повторная анкета на тот же адрес продолжает начатую, а не заводит вторую</li>
          </ul>
        </div>
      </div>
    </>
  );
}
