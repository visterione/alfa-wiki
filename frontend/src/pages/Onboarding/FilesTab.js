/**
 * Файлы заявки.
 *
 * Раньше это были три ссылки подряд с именами вроде «IMG_2481.jpg» — понять,
 * где портрет, а где диплом, можно было только скачав. Врач присылает их по
 * отдельности и каждый под своим вопросом, так что тип файла у нас есть — надо
 * было просто его показать.
 *
 * Превью рисуем сразу: картинку — самой картинкой, PDF — его первой страницей
 * через <object>. Браузер умеет её отрисовать без библиотек, а если не умеет,
 * внутри остаётся запасная подпись со ссылкой.
 */

import React from 'react';
import { FileText, Image as ImageIcon, ExternalLink } from 'lucide-react';

import './Onboarding.css';

// Порядок — как в анкете: сначала лицо, потом документы.
const KINDS = [
  { key: 'photo', title: 'Портретное фото', hint: 'Для бейджа и карточки на сайте' },
  { key: 'diploma', title: 'Диплом', hint: 'Скан документа об образовании' },
  { key: 'certificate', title: 'Сертификаты', hint: 'Действующие сертификаты специалиста' },
];

export default function FilesTab({ files = [], fileHref }) {
  if (!files.length) {
    return <div className="onb-empty">К заявке не приложено файлов</div>;
  }

  const groups = KINDS
    .map(kind => ({ ...kind, items: files.filter(file => file.kind === kind.key) }))
    .filter(group => group.items.length);

  // Тип, которого нет в списке, всё равно показываем — иначе файл просто
  // исчезнет из карточки, и никто не заметит.
  const known = new Set(KINDS.map(k => k.key));
  const rest = files.filter(file => !known.has(file.kind));
  if (rest.length) groups.push({ key: 'other', title: 'Прочее', hint: null, items: rest });

  return (
    <>
      {groups.map(group => (
        <section className="onb-fgroup" key={group.key}>
          <header>
            <b>{group.title}</b>
            {group.items.length > 1 && <span>{group.items.length}</span>}
            {group.hint && <small>{group.hint}</small>}
          </header>

          <div className="onb-fgrid">
            {group.items.map(file => (
              <FileCard key={file.id} file={file} href={fileHref(file)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function FileCard({ file, href }) {
  const isImage = (file.mimeType || '').startsWith('image/');
  const isPdf = file.mimeType === 'application/pdf';

  return (
    <figure className="onb-fcard">
      <a className="onb-fcard-view" href={href} target="_blank" rel="noreferrer">
        {isImage && <img src={href} alt={file.originalName || ''} loading="lazy" />}

        {isPdf && (
          /* Прокрутку и панель просмотрщика убираем параметрами: карточке нужна
             первая страница, а не встроенная читалка. */
          <object data={`${href}#page=1&view=FitH&toolbar=0&navpanes=0`} type="application/pdf">
            <span className="onb-fcard-fallback"><FileText size={22} /> PDF</span>
          </object>
        )}

        {!isImage && !isPdf && (
          <span className="onb-fcard-fallback"><FileText size={22} /> Файл</span>
        )}

        <span className="onb-fcard-open"><ExternalLink size={13} /></span>
      </a>

      <figcaption>
        <span title={file.originalName}>{file.originalName || file.filename}</span>
        <small>
          {isImage ? <ImageIcon size={11} /> : <FileText size={11} />}
          {sizeText(file.size)}
        </small>
      </figcaption>
    </figure>
  );
}

function sizeText(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
