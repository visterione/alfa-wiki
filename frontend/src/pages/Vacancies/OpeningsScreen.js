/**
 * Вакансии: публикации шаблонов по филиалам (ver. 8.20).
 *
 * Вакансия — это шаблон, выставленный в конкретном медцентре: заголовок,
 * описание и место работы. Анкета и процесс у неё общие с шаблоном, поэтому
 * здесь правится только то, что читает кандидат, и признак «набор открыт».
 *
 * Шаблон и филиал после создания не меняются. Заявка хранит и то и другое
 * своими колонками — по филиалу считаются исполнители каждого шага, — и перенос
 * вакансии в соседний медцентр означал бы, что у поданных заявок исполнители
 * остались от прежнего.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, ExternalLink } from 'lucide-react';

import { vacancies as api } from '../../services/api';

export default function OpeningsScreen({ list, templates, medCenters, onChanged }) {
  const [adding, setAdding] = useState(false);
  const published = templates.filter(t => t.isPublished);

  return (
    <>
      <div className="vac-sect">
        <span>Открытые и закрытые вакансии</span>
        {!adding && (
          <button className="vac-btn is-ghost" onClick={() => setAdding(true)} disabled={!published.length}>
            <Plus size={14} />Новая вакансия
          </button>
        )}
      </div>

      {!published.length && (
        <div className="vac-hint">
          Ни один шаблон пока не опубликован, а вакансию можно открыть только по
          опубликованному: иначе отклики пошли бы по полуготовой анкете.
        </div>
      )}

      {adding && (
        <NewOpening
          templates={published}
          medCenters={medCenters}
          onCancel={() => setAdding(false)}
          onCreated={() => { setAdding(false); onChanged(); }}
        />
      )}

      {!list.length && !adding && (
        <div className="vac-empty">
          Вакансий ещё нет.<br />
          Вакансия — это публикация шаблона в конкретном филиале.
        </div>
      )}

      {list.map(item => (
        <OpeningCard key={item.id} item={item} onChanged={onChanged} />
      ))}
    </>
  );
}

function NewOpening({ templates, medCenters, onCancel, onCreated }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id || '');
  // Филиалы без латинского кода не предлагаем: адрес QR строится именно из него,
  // и вакансия в таком филиале была бы открытой, но невидимой.
  const usable = medCenters.filter(mc => mc.code);
  const [medCenterId, setMedCenterId] = useState(usable[0]?.id || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.createOpening({ templateId, medCenterId, title, description });
      toast.success('Вакансия открыта');
      onCreated();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось создать вакансию');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vac-block is-open">
      <div className="vac-block-body" style={{ borderTop: 0, paddingTop: 14 }}>
        <div className="vac-row">
          <label className="vac-lab">
            Должность
            <select className="vac-input" value={templateId} onChange={e => setTemplateId(e.target.value)}>
              {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>

          <label className="vac-lab">
            Филиал
            <select className="vac-input" value={medCenterId} onChange={e => setMedCenterId(e.target.value)}>
              {usable.map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
            </select>
          </label>

          <label className="vac-lab is-wide">
            Заголовок для кандидата
            <input
              className="vac-input"
              value={title}
              placeholder="Врач-терапевт"
              onChange={e => setTitle(e.target.value)}
            />
          </label>
        </div>

        {medCenters.some(mc => !mc.code) && (
          <div className="vac-hint">
            Филиалы без латинского кода в списке не показаны: адрес QR строится
            из него. Код заполняется в справочнике медцентров.
          </div>
        )}

        <label className="vac-lab is-wide">
          Описание — условия, график, требования
          <textarea
            className="vac-input"
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </label>

        <div className="vac-editor-acts">
          <button className="vac-btn" disabled={busy || !title.trim() || !templateId || !medCenterId} onClick={create}>
            Открыть вакансию
          </button>
          <button className="vac-btn is-ghost" disabled={busy} onClick={onCancel}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

function OpeningCard({ item, onChanged }) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description || '');
  const [busy, setBusy] = useState(false);

  const dirty = title !== item.title || description !== (item.description || '');

  const save = async (patch) => {
    setBusy(true);
    try {
      await api.saveOpening(item.id, patch);
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить вакансию «${item.title}»?`)) return;
    setBusy(true);
    try {
      await api.deleteOpening(item.id);
      toast.success('Вакансия удалена');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось удалить');
    } finally {
      setBusy(false);
    }
  };

  const link = item.medCenter?.code
    ? `${window.location.origin}/vacancy/${item.medCenter.code}`
    : null;

  return (
    <div className={`vac-block is-open ${item.isOpen ? '' : 'is-archived'}`}>
      <div className="vac-block-body" style={{ borderTop: 0, paddingTop: 14 }}>
        <div className="vac-row">
          <label className="vac-lab is-wide">
            Заголовок
            <input className="vac-input is-title" value={title} onChange={e => setTitle(e.target.value)} />
          </label>

          <div className="vac-lab">
            Куда и по какой анкете
            <div className="vac-sub" style={{ paddingTop: 6 }}>
              {item.medCenter?.name || '—'} · {item.template?.title || '—'}
            </div>
          </div>

          <label className="vac-check">
            <input
              type="checkbox"
              checked={item.isOpen}
              disabled={busy}
              onChange={e => save({ isOpen: e.target.checked })}
            />
            Набор открыт
          </label>
        </div>

        <label className="vac-lab is-wide">
          Описание
          <textarea className="vac-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        </label>

        <div className="vac-editor-acts">
          <button className="vac-btn" disabled={busy || !dirty} onClick={() => save({ title, description })}>
            Сохранить
          </button>
          {link && (
            <a className="vac-btn is-ghost" href={link} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />Открыть как кандидат
            </a>
          )}
          <button className="vac-btn is-ghost is-danger" disabled={busy} onClick={remove}>
            <Trash2 size={14} />Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
