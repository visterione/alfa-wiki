/**
 * Вкладка «Основное» (ver. 8.36).
 *
 * То, что кандидат читает до анкеты: зарплата и условия. Зарплата стоит первой —
 * в списке вакансий и на странице отклика её тоже видят раньше описания, и
 * порядок здесь совпадает с тем, в каком это читают. Раньше оба поля жили в
 * шапке редактора, и шапка от этого разрослась — описание на пять абзацев
 * занимало половину экрана над всеми остальными вкладками, хотя правят его раз
 * в жизни вакансии. Теперь в шапке остаётся только название: по нему понятно,
 * что открыто, а остальное лежит там же, где и всё прочее, — на своей вкладке.
 *
 * Название при этом не переехало намеренно: оно одновременно и заголовок
 * страницы, и поле. Убрать его во вкладку значит показать редактор, по которому
 * не видно, какую вакансию правишь.
 */

import React from 'react';

import AutoTextarea from './AutoTextarea';
import SalaryField from './SalaryField';

export default function MainTab({
  description, onDescription,
  salary, onSalary, meta,
  // У шаблона зарплаты нет: заготовка должности общая на сеть, а платят в
  // филиалах по-разному.
  withSalary = true,
  descriptionLabel = 'Описание для кандидата',
  descriptionPlaceholder = 'Условия, график, требования. Пустая строка делает новый абзац — кандидат увидит текст так же, как вы его набрали',
  descriptionHint
}) {
  return (
    <div className="vac-main-tab">
      {withSalary && (
        <>
          <div className="vac-sect"><span>Зарплата</span></div>
          <SalaryField meta={meta} value={salary} onChange={onSalary} />
        </>
      )}

      <div className="vac-sect"><span>{descriptionLabel}</span></div>
      <AutoTextarea
        className="vac-input is-prose"
        minRows={6}
        value={description}
        placeholder={descriptionPlaceholder}
        onChange={e => onDescription(e.target.value)}
      />

      {descriptionHint && <div className="vac-hint">{descriptionHint}</div>}
    </div>
  );
}
