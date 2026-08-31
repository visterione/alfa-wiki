/**
 * Мелкие общие элементы модуля: аватарка, бейдж, полоса загрузки, пустое место.
 *
 * Вынесены отдельно, потому что встречаются на всех девяти экранах. Полоса
 * загрузки — самый нагруженный смыслом элемент модуля, и рисовать её в пяти
 * местах по-разному означало бы, что «красный» на разных экранах наступает в
 * разных точках.
 */

import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { userName, loadColor } from '../utils/labels';
import { hoursText } from '../utils/dates';
import { BASE_URL } from '../../../services/api';

function avatarUrl(value) {
  if (!value) return null;
  if (/^data:|^blob:/.test(value)) return value;
  if (/^https?:\/\/localhost(?::\d+)?\//.test(value)) {
    return `${BASE_URL}/${value.replace(/^https?:\/\/localhost(?::\d+)?\//, '')}`;
  }
  if (/^https?:\/\//.test(value)) return value;
  return `${BASE_URL}/${String(value).replace(/^\//, '')}`;
}

export function Avatar({ user, size = 26, title, percent = null }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : avatarUrl(user?.avatar);
  useEffect(() => setFailed(false), [user?.avatar]);
  if (!user) return null;
  const style = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    maxWidth: size,
    maxHeight: size,
    flexBasis: size,
  };
  const face = (
    <span className={`tsk-av ${src ? 'has-image' : 'is-placeholder'}`} style={style} title={title || userName(user)}>
      {src
        ? <img src={src} alt="" onError={() => setFailed(true)} />
        : <User size={Math.max(12, Math.round(size * 0.52))} strokeWidth={1.8} />}
    </span>
  );

  return percent === null || percent === undefined
    ? face
    : <LoadRing percent={percent} size={size}>{face}</LoadRing>;
}

/**
 * Процент от нормы кольцом вокруг аватарки.
 *
 * Раньше он стоял текстом под именем, рядом с командами и должностью, и там его
 * приходилось читать — а это единственное число строки, которое нужно узнавать
 * взглядом, не читая. Кольцо занимает место, которое и так пустует, и красится
 * той же шкалой, что полосы дней: строка целиком получает один цвет, и «кто в
 * завале» видно до того, как глаз дошёл до имени.
 *
 * Дуга обрывается на полном круге, а цвет — нет: у того, кто набрал 150%,
 * кольцо замкнуто и красное, и отличать его от 100% длиной бессмысленно —
 * важно, что предел пройден.
 */
function LoadRing({ percent, size, children }) {
  const outer = size + 9;
  const radius = (outer - 3) / 2;
  const length = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(percent / 100, 1));

  return (
    <span
      className="tsk-avring"
      style={{ width: outer, height: outer }}
      title={`${percent}% от нормы за период`}
    >
      <svg width={outer} height={outer} viewBox={`0 0 ${outer} ${outer}`} aria-hidden="true">
        <circle className="tsk-avring-track" cx={outer / 2} cy={outer / 2} r={radius} />
        <circle
          className="tsk-avring-arc"
          cx={outer / 2}
          cy={outer / 2}
          r={radius}
          stroke={loadColor(percent / 100)}
          strokeDasharray={`${length * filled} ${length}`}
        />
      </svg>
      {children}
    </span>
  );
}

/** Стопка аватарок с нахлёстом — для задач на нескольких человек. */
export function AvatarStack({ users = [], size = 22, max = 4 }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="tsk-avs">
      {shown.map((u, index) => <Avatar key={u?.id || index} user={u} size={size} />)}
      {rest > 0 && <span className="tsk-av tsk-av-rest" style={{ width: size, height: size }}>+{rest}</span>}
    </span>
  );
}

export function Badge({ tone = 'muted', children, title }) {
  return <span className={`tsk-badge tsk-badge-${tone}`} title={title}>{children}</span>;
}

/**
 * Полоса загрузки дня.
 *
 * Норма отмечена пунктиром, а не краем полосы: у каждого она своя, и без метки
 * две строки таблицы с одинаковой длиной заливки означали бы совершенно разное.
 * Переработка рисуется отдельным сегментом за пунктиром — иначе она упёрлась бы
 * в край и перестала расти визуально ровно там, где становится важной.
 *
 * Выполненная часть заштрихована внутри заливки, а не вычтена из неё: сделанная
 * работа время потратила, и день от неё пустым не становится. Разница между
 * «восемь часов ещё предстоят» и «восемь часов уже отработаны» видна штриховкой.
 *
 * Цвет заливки считается здесь из часов и нормы, а не приходит готовым классом с
 * бэкенда: `color` в ответе — это три ступени (запас/плотно/переработка), а
 * полоса красится непрерывной шкалой, см. loadColor.
 */
export function LoadBar({ hours, done, norm, onVacation, onDayOff, compact }) {
  if (onVacation) {
    return (
      <div className={`tsk-bar tsk-bar-vac ${compact ? 'is-compact' : ''}`} title="Отпуск">
        <span className="tsk-bar-vac-label">отпуск</span>
      </div>
    );
  }
  // Выходной заштрихован, а не подписан мелким серым словом под пустой полосой.
  // В таблице на тридцать один столбец такая подпись терялась, и месяц читался
  // как сплошной ряд одинаково пустых дней — а разница между «свободен» и «его
  // сегодня нет» ровно та, ради которой на эту таблицу и смотрят. Часы в
  // выходной всё-таки бывают (кто-то вышел), поэтому полоса рисуется поверх
  // штриховки, а не вместо неё.
  if (onDayOff) {
    return (
      <div className={`tsk-bar tsk-bar-off ${compact ? 'is-compact' : ''}`}
        title={hours > 0 ? `Выходной, но занято ${hoursText(hours)}` : 'Выходной'}>
        {hours > 0 && (
          // Нормы в выходной нет, сравнивать не с чем — поэтому длина отмеряется
          // от условных восьми часов: она говорит «сколько», а не «сколько из».
          <div className="tsk-bar-fill" style={{
            width: `${Math.min(hours / 8, 1) * 100}%`,
            background: 'var(--text-tertiary)',
          }} />
        )}
      </div>
    );
  }
  if (norm === null || norm === undefined) {
    return <div className={`tsk-bar ${compact ? 'is-compact' : ''}`} title="Норма не задана" />;
  }

  // Шкала до 1,4 нормы: переработка должна быть видна, но не растягивать
  // спокойные дни в тонкую полоску.
  const scale = Math.max(norm * 1.4, 1);
  const fill = Math.min((hours || 0) / scale, 1) * 100;
  const doneFill = Math.min((done || 0) / scale, 1) * 100;
  const normAt = (norm / scale) * 100;

  // Выходной приходит с нормой 0: сравнивать не с чем, поэтому такой день не
  // красится шкалой вовсе — иначе любой час в субботу выглядел бы переработкой.
  const ratio = norm > 0 ? (hours || 0) / norm : null;

  return (
    <div
      className={`tsk-bar ${compact ? 'is-compact' : ''}`}
      title={ratio === null
        ? `${hoursText(hours)} — норма на этот день не задана`
        : `${hoursText(hours)} из ${hoursText(norm)} — ${Math.round(ratio * 100)}% нормы${
          done > 0 ? `, выполнено ${hoursText(done)}` : ''}`}
    >
      <div
        className="tsk-bar-fill"
        style={{ width: `${fill}%`, background: ratio === null ? 'var(--text-tertiary)' : loadColor(ratio) }}
      />
      {doneFill > 0 && <div className="tsk-bar-done" style={{ width: `${doneFill}%` }} />}
      <div className="tsk-bar-norm" style={{ left: `${normAt}%` }} />
    </div>
  );
}

export function Empty({ children, compact }) {
  return <div className={`tsk-empty ${compact ? 'is-compact' : ''}`}>{children}</div>;
}

export function Spinner({ text = 'Загружаем…' }) {
  return <div className="tsk-empty is-compact">{text}</div>;
}

/**
 * Пояснение сбоку или снизу экрана.
 *
 * В модуле много решений, которые без объяснения читаются как странность:
 * почему «мой день» отдельно от «графика», почему процент считается от суммы
 * норм, почему закрытая команда не показывается строкой «нет доступа».
 * Объяснять это в интерфейсе дешевле, чем отвечать на один и тот же вопрос.
 */
export function Note({ children }) {
  return <div className="tsk-note">{children}</div>;
}
