/**
 * Материалы для рассылки.
 *
 * Ссылка на анкету одна и постоянная — её отправляют сразу нескольким врачам,
 * вешают в вакансию и показывают по QR на собеседовании. Нигде в базе она не
 * лежит: это просто адрес, и собирает его бэкенд из PUBLIC_BASE_URL.
 *
 * Всё собрано в одну визитку, а не разложено по блокам «ссылка», «QR» и
 * «инструкция»: показывают её целиком — с экрана, с распечатки или в письме.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Download, Printer, Send, AlertTriangle } from 'lucide-react';

import { onboarding as api } from '../../services/api';
import './Onboarding.css';

export default function OnboardingMaterials() {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

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
      toast.error('Браузер не дал скопировать — выделите адрес вручную');
    }
  };

  const download = (kind) => {
    const link = document.createElement('a');
    if (kind === 'svg') {
      const blob = new Blob([data.qrSvg], { type: 'image/svg+xml' });
      link.href = URL.createObjectURL(blob);
      link.download = 'anketa-qr.svg';
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }
    link.href = data.qrPng;
    link.download = 'anketa-qr.png';
    link.click();
  };

  /**
   * Печатается только визитка. Печатать раздел целиком бессмысленно: на лист
   * уедут навигация и меню портала.
   */
  const print = () => window.print();

  const invite = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      await api.invite({ email: email.trim() });
      toast.success(`Приглашение отправлено на ${email.trim()}`);
      setEmail('');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось отправить приглашение');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {!data.baseConfigured && (
        <div className="onb-alert">
          <AlertTriangle size={16} />
          <div>
            <b>Адрес портала не задан</b>
            Ссылка собрана из умолчания. Пока в <code>.env</code> не прописан PUBLIC_BASE_URL,
            печатать QR рано — сначала проверьте, что адрес открывается снаружи.
          </div>
        </div>
      )}

      <div className="onb-vcard">
        <div className="onb-vcard-qr" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />
        <div className="onb-vcard-body">
          <div className="onb-vcard-kicker">Сеть медицинских центров «Альфа»</div>
          <h2>Анкета врача</h2>
          <p>Наведите камеру или откройте ссылку — анкета заполняется с телефона и сохраняется по ходу.</p>
          <div className="onb-vcard-url">{data.url}</div>
        </div>
      </div>

      <div className="onb-acts" style={{ marginTop: 14 }}>
        <button className="onb-btn is-sm" onClick={copy}><Copy size={13} /> Копировать ссылку</button>
        <button className="onb-btn is-sm" onClick={print}><Printer size={13} /> Печать</button>
        <button className="onb-btn is-sm" onClick={() => download('svg')}><Download size={13} /> SVG</button>
        <button className="onb-btn is-sm" onClick={() => download('png')}><Download size={13} /> PNG</button>
      </div>

      <form className="onb-invite" onSubmit={invite}>
        <div className="onb-sect">Отправить кандидату</div>
        <div className="onb-invite-row">
          <input
            className="onb-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="doctor@example.com"
            required
          />
          <button className="onb-btn is-primary is-sm" type="submit" disabled={sending || !email.trim()}>
            <Send size={13} /> {sending ? 'Отправляем…' : 'Отправить'}
          </button>
        </div>
        <div className="onb-sub">
          Письмо со ссылкой на анкету. Заявка появится, когда врач подтвердит адрес и начнёт заполнять.
        </div>
      </form>

      {/* Печатается только визитка — тем же слоем, что и документ-анкета. */}
      <div className="onb-print-root">
        <div className="onb-vcard is-print">
          <div className="onb-vcard-qr" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />
          <div className="onb-vcard-body">
            <div className="onb-vcard-kicker">Сеть медицинских центров «Альфа»</div>
            <h2>Анкета врача</h2>
            <p>Наведите камеру телефона на код или откройте ссылку.</p>
            <div className="onb-vcard-url">{data.url}</div>
          </div>
        </div>
      </div>
    </>
  );
}
