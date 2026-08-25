/**
 * Анкета врача как документ.
 *
 * Раньше карточка показывала пары «ключ — значение» списком, и человек, который
 * решает допуск, читал их как таблицу настроек, а не как сведения о враче.
 * Здесь то же самое собрано документом: шапка с именем и специальностью, дальше
 * разделы с тонкими линейками — так его и читают, и печатают.
 *
 * Разделы приходят с сервера из той же схемы, по которой рисуется сама анкета,
 * поэтому документ показывает ровно то, что человеку положено видеть на его
 * шаге: пустые разделы не рисуются вовсе.
 */

import React from 'react';
import { formatPhone, weekdaysText, timeRangeText } from '../Anketa/fields';

export default function ApplicationCV({ data, fileHref }) {
  const app = data.application;
  const form = app.form || {};
  const labels = data.labels || {};
  const photo = (app.files || []).find(f => f.kind === 'photo');

  const sections = (data.sections || [])
    .map(section => ({
      ...section,
      rows: section.repeat
        ? (form[section.key] || []).filter(row => Object.values(row).some(Boolean))
        : section.fields
            .map(field => ({
              key: field.key,
              label: labels[field.key] || field.key,
              value: fieldText(field.type, form[field.key]),
            }))
            .filter(row => row.value !== '')
    }))
    .filter(section => section.rows.length);

  return (
    <article className="onb-cv">
      <header className="onb-cv-head">
        {photo && (
          <img className="onb-cv-photo" src={fileHref(photo)} alt="" />
        )}
        <div className="onb-cv-ident">
          <h1>{app.fullName || 'Имя не указано'}</h1>
          {Boolean((app.professions || []).length) && (
            <div className="onb-cv-prof">{app.professions.map(p => p.name).join(' · ')}</div>
          )}
          <dl className="onb-cv-meta">
            {data.medCenter && <><dt>Филиал</dt><dd>{data.medCenter.name}</dd></>}
            {app.startDate && <><dt>Выход на работу</dt><dd>{dateRu(app.startDate)}</dd></>}
            {form.birthDate && <><dt>Дата рождения</dt><dd>{dateRu(form.birthDate)}</dd></>}
            {app.phone && <><dt>Телефон</dt><dd>{formatPhone(app.phone)}</dd></>}
            {app.email && <><dt>Почта</dt><dd>{app.email}</dd></>}
          </dl>
        </div>
        <div className="onb-cv-stamp">{dateRu(app.submittedAt || app.createdAt)}</div>
      </header>

      {sections.map(section => (
        <section className="onb-cv-sect" key={section.key}>
          <h2>{section.title}</h2>

          {section.repeat ? (
            <ul className="onb-cv-list">
              {section.rows.map((row, index) => (
                <li key={index}>{repeatRow(section.key, row)}</li>
              ))}
            </ul>
          ) : (
            <dl className="onb-cv-pairs">
              {section.rows.map(row => (
                <React.Fragment key={row.key}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </section>
      ))}

      {!sections.length && (
        <p className="onb-cv-empty">Для вашего шага сведений из анкеты не требуется.</p>
      )}
    </article>
  );
}

/**
 * Значение поля в виде, пригодном для чтения. Дни недели хранятся номерами, а
 * интервал приёма объектом — печатать их как есть нельзя.
 */
function fieldText(type, value) {
  if (value === undefined || value === null || value === '') return '';
  if (type === 'weekdays') return weekdaysText(value);
  if (type === 'timerange') return timeRangeText(value);
  if (type === 'phone') return formatPhone(value);
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return String(value);
}

/**
 * Строка повторяемого блока. У каждого блока свой порядок чтения: у образования
 * год ведёт, у ресурсов — подпись со ссылкой. Общая склейка через « · » давала
 * «2008 · РязГМУ · Лечебное дело · Рязань» и читалась как список тегов.
 */
function repeatRow(key, row) {
  if (key === 'education' || key === 'qualification') {
    return (
      <>
        <span className="onb-cv-year">{row.year || '—'}</span>
        <span>
          <b>{row.institution}</b>
          {row.specialty ? `, ${row.specialty}` : ''}
          {row.city ? ` · ${row.city}` : ''}
        </span>
      </>
    );
  }
  if (key === 'certificates') {
    return (
      <>
        <span className="onb-cv-year">до {row.validUntil || '—'}</span>
        <span><b>{row.specialization}</b></span>
      </>
    );
  }
  if (key === 'papers') {
    return (
      <>
        <span className="onb-cv-year">{row.year || '—'}</span>
        <span>
          <b>{row.topic || row.publication}</b>
          {row.topic && row.publication ? ` · ${row.publication}` : ''}
        </span>
      </>
    );
  }
  if (key === 'conferences') {
    return (
      <>
        <span className="onb-cv-year">{row.year || '—'}</span>
        <span>
          <b>{row.event}</b>
          {row.place ? ` · ${row.place}` : ''}
          {row.extra ? ` · ${row.extra}` : ''}
        </span>
      </>
    );
  }
  if (key === 'resources') {
    return (
      <>
        <span className="onb-cv-year">{row.label || 'ссылка'}</span>
        <span>
          {row.url
            ? <a href={withProtocol(row.url)} target="_blank" rel="noreferrer">{row.url}</a>
            : '—'}
        </span>
      </>
    );
  }
  return <span>{Object.values(row).filter(Boolean).join(' · ')}</span>;
}

function withProtocol(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function dateRu(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
