/**
 * Тексты писем кандидату и их превью (ver. 8.21).
 *
 * Слева — то, что правят: тема, заголовок и текст. Справа — само письмо, каким
 * его увидит кандидат, собранное тем же кодом, что и настоящее. Превью,
 * нарисованное отдельно, разошлось бы с письмом на первой же правке вёрстки, и
 * человек правил бы текст, глядя не на то, что уедет.
 *
 * Вёрстка при этом не редактируется: она выстрадана под почтовые клиенты —
 * таблицы, инлайновые стили, отсутствие флексбокса, — и отдать её в редактор
 * значит чинить письма после каждой правки. Кнопка, код и подписи мелким
 * шрифтом собираются кодом; они одинаковы для любой должности.
 *
 * Пустое поле означает «берём умолчание», а не «письмо без текста»: стереть
 * свою правку и вернуться к исходному тексту можно, не вспоминая его.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, RotateCcw, Mail } from 'lucide-react';

import { vacancies as api } from '../../services/api';

export default function EmailsEditor({ vacancyId, meta, emails, onSaved }) {
  const letters = meta.letters || [];
  const [active, setActive] = useState(letters[0]?.key || '');
  const [own, setOwn] = useState(() => JSON.parse(JSON.stringify(emails || {})));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const letter = letters.find(l => l.key === active);
  const mine = own[active] || {};

  const loadPreview = useCallback(async () => {
    if (!active) return;
    try {
      const { data } = await api.emailPreview(vacancyId, active);
      setPreview(data);
    } catch {
      setPreview(null);
    }
  }, [vacancyId, active]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const dirty = JSON.stringify(own) !== JSON.stringify(emails || {});

  const set = (field, value) => {
    setOwn(prev => {
      const next = { ...prev, [active]: { ...(prev[active] || {}), [field]: value } };
      // Совпало с умолчанием — значит правки нет: не держим в базе копию того,
      // что и так лежит в коде.
      if (value.trim() === '' || value === letter[field]) delete next[active][field];
      if (!Object.keys(next[active]).length) delete next[active];
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.saveEmails(vacancyId, { emails: own });
      toast.success('Тексты сохранены');
      await onSaved?.();
      await loadPreview();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const resetLetter = () => {
    setOwn(prev => {
      const next = { ...prev };
      delete next[active];
      return next;
    });
  };

  if (!letter) return <div className="vac-empty">Писем нет.</div>;

  return (
    <div className="vac-mail">
      <nav className="vac-mail-list">
        {letters.map(item => (
          <button
            key={item.key}
            className={item.key === active ? 'is-on' : ''}
            onClick={() => setActive(item.key)}
          >
            <Mail size={14} />
            <span>{item.name}</span>
            {own[item.key] && <i className="vac-dot" title="Текст изменён" />}
          </button>
        ))}
      </nav>

      <div className="vac-mail-edit">
        <label className="vac-lab is-wide">
          Тема письма
          <input
            className="vac-input"
            value={mine.subject ?? letter.subject}
            onChange={e => set('subject', e.target.value)}
          />
        </label>

        <label className="vac-lab is-wide">
          Заголовок в шапке
          <input
            className="vac-input"
            value={mine.title ?? letter.title}
            onChange={e => set('title', e.target.value)}
          />
        </label>

        <label className="vac-lab is-wide">
          Текст
          <textarea
            className="vac-input"
            rows={7}
            value={mine.body ?? letter.body}
            onChange={e => set('body', e.target.value)}
          />
        </label>

        <div className="vac-hint">
          Пустая строка между абзацами делает новый абзац. Ссылка, кнопка, код и
          подписи мелким шрифтом подставляются сами — их редактировать не нужно.
        </div>

        <div className="vac-editor-acts">
          <button className="vac-btn" disabled={busy || !dirty} onClick={save}>
            <Save size={14} />Сохранить
          </button>
          <button
            className="vac-btn is-ghost"
            disabled={busy || !own[active]}
            onClick={resetLetter}
            title="Вернуть исходный текст этого письма"
          >
            <RotateCcw size={14} />Вернуть как было
          </button>
        </div>
      </div>

      <div className="vac-mail-preview">
        <div className="vac-mail-preview-head">
          <span className="vac-sub">Так это увидит кандидат</span>
          {dirty && <span className="vac-badge vac-badge-warn">после сохранения</span>}
        </div>
        {preview ? (
          // Письмо показывается в iframe с собственным документом: его вёрстка
          // рассчитана на почтовый клиент и на странице портала без изоляции
          // подхватила бы наши стили, показав не то, что уедет человеку.
          <iframe
            title="Превью письма"
            className="vac-mail-frame"
            sandbox=""
            srcDoc={preview.html}
          />
        ) : (
          <div className="vac-empty">Превью не собралось</div>
        )}
      </div>
    </div>
  );
}
