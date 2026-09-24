/**
 * Ссылки и QR вакансии (ver. 8.21).
 *
 * Их две, и они для разных случаев.
 *
 * Прямая ведёт сразу в эту анкету — её отправляют конкретному человеку в
 * переписке или письмом. Промежуточный экран со списком ему только мешает: он
 * уже знает, на что откликается.
 *
 * Филиальная ведёт на список вакансий медцентра — это табличка в регистратуре,
 * одна на все должности. Она не меняется при добавлении вакансий, поэтому
 * напечатанное однажды продолжает работать.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link2, QrCode, Building2, Mail } from 'lucide-react';

import { vacancies as api } from '../../services/api';

export default function ShareTab({ vacancy }) {
  const [materials, setMaterials] = useState(null);
  const [branch, setBranch] = useState(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [own, mc] = await Promise.all([
        api.openingMaterials(vacancy.id),
        vacancy.medCenter?.code ? api.materials(vacancy.medCenter.code) : Promise.resolve({ data: null })
      ]);
      setMaterials(own.data);
      setBranch(mc.data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось собрать ссылки');
    }
  }, [vacancy.id, vacancy.medCenter?.code]);

  useEffect(() => { load(); }, [load]);

  const sendInvite = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      await api.sendInvite(vacancy.id, { email });
      toast.success(`Ссылка отправлена на ${email.trim()}`);
      setEmail('');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось отправить письмо');
    } finally {
      setSending(false);
    }
  };

  if (!materials) return <div className="vac-empty">Собираем…</div>;

  return (
    <>
      {vacancy.status !== 'open' && (
        <div className="vac-hint">
          Набор не открыт: по ссылкам кандидат увидит «набор закрыт». Сами
          ссылки настоящие — печатать можно заранее.
        </div>
      )}

      <div className="vac-sect">
        <span><Link2 size={13} /> Прямая ссылка на эту вакансию</span>
      </div>
      <Share
        materials={materials}
        fileName={`vakansiya-${vacancy.publicCode}`}
        note="Отправьте её человеку лично — откроется сразу анкета."
      />
      <form className="vac-invite" onSubmit={sendInvite}>
        <label className="vac-lab">
          Отправить ссылку на вакансию по электронной почте
          <input
            className="vac-input"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="name@example.com"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </label>
        <button className="vac-btn" type="submit" disabled={sending || vacancy.status !== 'open'}>
          <Mail size={14} />{sending ? 'Отправляем…' : 'Отправить приглашение'}
        </button>
        {vacancy.status !== 'open' && (
          <div className="vac-hint">Отправить приглашение можно после открытия набора.</div>
        )}
      </form>

      {branch && (
        <>
          <div className="vac-sect">
            <span><Building2 size={13} /> Ссылка филиала — все вакансии {vacancy.medCenter?.name}</span>
          </div>
          <Share
            materials={branch}
            fileName={`filial-${vacancy.medCenter?.code}`}
            note="Это табличка в регистратуре: одна на все вакансии медцентра, при добавлении новых не меняется."
          />
        </>
      )}
    </>
  );
}

function Share({ materials, fileName, note }) {
  return (
    <div className="vac-qr">
      <img src={materials.qrPng} alt="QR-код" />
      <div className="vac-qr-side">
        <span className="vac-link">{materials.url}</span>
        <div className="vac-sub">{note}</div>
        <div className="vac-editor-acts">
          <button
            className="vac-btn is-ghost"
            onClick={() => {
              navigator.clipboard?.writeText(materials.url);
              toast.success('Ссылка скопирована');
            }}
          >
            Скопировать ссылку
          </button>
          {/* Для печати отдаём вектор: на бумаге растр с экранными 512 px
              выглядит мылом, а эти QR именно печатают. */}
          <a
            className="vac-btn is-ghost"
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(materials.qrSvg)}`}
            download={`${fileName}.svg`}
          >
            <QrCode size={14} />Скачать для печати
          </a>
        </div>
        {!materials.baseConfigured && (
          <div className="vac-hint">
            PUBLIC_BASE_URL на сервере не задан — адрес собран по умолчанию.
            Печатать стоит после того, как его настроят.
          </div>
        )}
      </div>
    </div>
  );
}
