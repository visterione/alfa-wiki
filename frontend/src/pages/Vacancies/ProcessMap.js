/**
 * Схема процесса: что за чем и что одновременно (ver. 8.38).
 *
 * Список шагов отвечает на вопрос «какие шаги есть», но не на вопрос «как они
 * идут». Порядок карточек в конструкторе — не порядок выполнения: его задают
 * зависимости, и четыре шага после согласования идут разом. Понять это по
 * списку можно было только прочитав у каждого шага строку «после: …» и собрав
 * цепочку в голове.
 *
 * Здесь та же самая цепочка нарисована: колонка — это то, что начинается
 * одновременно, стрелка — «ждёт». Сама раскладка ничего не хранит и не
 * настраивается: положение узла — следствие зависимостей, и подвинуть его можно
 * только изменив их. Схема, которую раскладывают руками, расходится с процессом
 * на второй правке.
 *
 * Тот же компонент показывает ход конкретной заявки (`live`): там у шагов есть
 * задачи, и узлы красятся по их состоянию — закрыт, в работе, просрочен, ждёт
 * очереди. Рисовать для заявки вторую такую же схему значило бы держать две
 * раскладки, расходящиеся при первом же изменении.
 *
 * Стрелки рисуются по измеренным координатам узлов, а не по расчётной сетке:
 * высота узла зависит от длины названия и от того, поместился ли исполнитель в
 * строку, и посчитать её заранее нельзя.
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Clock, RotateCcw, User } from 'lucide-react';

/** Подпись вида шага в узле — короче, чем в конструкторе: в карточку 210 px. */
const KIND_LABEL = {
  decision: 'решение',
  manual: 'отметка',
  services_pick: 'услуги',
  form_extra: 'документы'
};

/**
 * Раскладка по волнам.
 *
 * Волна шага — на единицу дальше самого дальнего из тех, кого он ждёт. Значит в
 * одной колонке стоит то, что станет доступно одновременно, а длина схемы — это
 * длина самой длинной цепочки, а не число шагов.
 *
 * Кольцо ловится тем же обходом: шаг, встреченный повторно, пока его собственная
 * волна ещё считается, означает, что шаги ждут друг друга. Считать дальше
 * нечего — схема в этом случае не рисуется, а сохранение процесса всё равно не
 * пройдёт: сервер назовёт сам круг.
 */
function layout(steps) {
  const active = (steps || []).filter(s => !s.archived);
  const byKey = new Map(active.map(s => [s.key, s]));

  const wave = new Map();
  const walking = new Set();
  let looped = false;

  const waveOf = (key) => {
    if (wave.has(key)) return wave.get(key);
    if (walking.has(key)) { looped = true; return 0; }
    walking.add(key);
    const parents = (byKey.get(key)?.after || []).filter(k => byKey.has(k));
    const value = parents.length ? Math.max(...parents.map(waveOf)) + 1 : 0;
    walking.delete(key);
    wave.set(key, value);
    return value;
  };
  active.forEach(s => waveOf(s.key));
  if (looped) return { looped: true, columns: [], links: [] };

  const columns = [];
  active.forEach((step, index) => {
    const at = wave.get(step.key) || 0;
    (columns[at] = columns[at] || []).push({ step, index });
  });
  for (let i = 0; i < columns.length; i += 1) columns[i] = columns[i] || [];

  // Порядок внутри колонки — по среднему положению тех, кого шаг ждёт: так
  // стрелки идут почти горизонтально и пересекаются заметно реже. Шаг без
  // предшественников в этой колонке остаётся там, где стоял в списке.
  const place = new Map();
  columns[0]?.forEach((item, row) => place.set(item.step.key, row));
  for (let i = 1; i < columns.length; i += 1) {
    const weighed = columns[i].map((item, row) => {
      const rows = (item.step.after || []).map(k => place.get(k)).filter(v => v !== undefined);
      return { item, row, bary: rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : row };
    });
    weighed.sort((a, b) => a.bary - b.bary || a.row - b.row);
    columns[i] = weighed.map(w => w.item);
    columns[i].forEach((item, row) => place.set(item.step.key, row));
  }

  const links = [];
  for (const step of active) {
    for (const parent of step.after || []) {
      if (byKey.has(parent)) links.push({ from: parent, to: step.key });
    }
    // Возврат (ver. 8.38) рисуется отдельной линией назад: она проходит под
    // узлами, а не между ними, потому что идёт против общего течения схемы и
    // спутать её с зависимостью нельзя.
    if (step.returnTo && byKey.has(step.returnTo)) {
      links.push({ from: step.key, to: step.returnTo, back: true });
    }
  }

  return { looped: false, columns, links };
}

/** Состояние шага у живой заявки. В конструкторе шагов в работе нет вовсе. */
function stateOf(step, live) {
  if (!live) return '';
  if (step.task?.completedAt) return 'done';
  if (!step.task) return 'wait';
  return step.task.overdue ? 'late' : 'open';
}

export default function ProcessMap({ steps, assignees, live = false, onPick }) {
  const { looped, columns, links } = useMemo(() => layout(steps), [steps]);

  const canvas = useRef(null);
  const nodes = useRef(new Map());
  const [drawn, setDrawn] = useState([]);

  // Пересчитывать стрелки нужно и когда поменялась схема, и когда просто
  // изменилась ширина полотна: колонки переносятся, а узлы меняют высоту.
  const shape = useMemo(
    () => links.map(l => `${l.from}>${l.to}`).join('|') + '#' + columns.map(c => c.length).join(','),
    [links, columns]
  );

  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root) return undefined;

    const measure = () => {
      const base = root.getBoundingClientRect();
      const box = (key) => {
        const el = nodes.current.get(key);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: r.left - base.left,
          right: r.right - base.left,
          bottom: r.bottom - base.top,
          middle: r.top - base.top + r.height / 2
        };
      };

      const floor = root.getBoundingClientRect().height;

      setDrawn(links.map(link => {
        const from = box(link.from);
        const to = box(link.to);
        if (!from || !to) return null;

        // Возврат идёт справа налево — низом полотна, чтобы не пересекать
        // прямые связи: там, где обе линии соединяют одну пару узлов, они иначе
        // легли бы одна на другую.
        //
        // Ломаной, а не кривой: у кривой Безье контрольные точки лежали бы на
        // нижней дорожке, но сама линия до неё не доходит и читается как
        // диагональ через пол-схемы — именно так первая версия и выглядела.
        if (link.back) {
          const lane = floor - 10;
          // Оба поворота вниз и вверх идут по зазорам между колонками, а не
          // сквозь них: иначе линия пересекает чужие узлы и читается как связь
          // с ними.
          const xa = Math.max(6, from.left - 28);
          const xb = Math.max(6, to.left - 28);
          const r = 8; // прямой угол здесь смотрится чужеродно
          return {
            id: `${link.from}<${link.to}`,
            back: true,
            d: [
              `M ${from.left} ${from.middle}`,
              `H ${xa + r}`, `Q ${xa} ${from.middle} ${xa} ${from.middle + r}`,
              `V ${lane - r}`, `Q ${xa} ${lane} ${xa - r} ${lane}`,
              `H ${xb + r}`, `Q ${xb} ${lane} ${xb} ${lane - r}`,
              `V ${to.middle + r}`, `Q ${xb} ${to.middle} ${xb + r} ${to.middle}`,
              `H ${to.left - 2}`
            ].join(' ')
          };
        }

        // Изгиб — половина промежутка, но не больше 34 px: у соседних колонок
        // линия остаётся почти прямой, у дальних не превращается в петлю.
        const bend = Math.max(12, Math.min(34, (to.left - from.right) / 2));
        return {
          id: `${link.from}>${link.to}`,
          d: `M ${from.right} ${from.middle} C ${from.right + bend} ${from.middle}, ${to.left - bend} ${to.middle}, ${to.left} ${to.middle}`,
          far: to.left - from.right > 200
        };
      }).filter(Boolean));
    };

    measure();
    // Наблюдаем и полотно, и сами узлы: название в две строки меняет высоту
    // узла, а высоту полотна — только если этот узел в самой длинной колонке.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const node of nodes.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [shape, links]);

  if (looped) {
    return (
      <div className="vac-errors">
        <AlertTriangle size={15} />
        <div>Шаги ждут друг друга по кругу — пока это не поправить, порядок не определён и схему нарисовать нечем.</div>
      </div>
    );
  }

  if (!columns.length) return null;

  return (
    <div className="vac-map">
      <div className="vac-map-scroll">
        <div className="vac-map-canvas" ref={canvas}>
          <svg className="vac-map-links" aria-hidden="true">
            <defs>
              <marker id="vac-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M 0 0 L 7 3.5 L 0 7 z" />
              </marker>
              <marker id="vac-arrow-back" className="is-back" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M 0 0 L 7 3.5 L 0 7 z" />
              </marker>
            </defs>
            {drawn.map(link => (
              <path
                key={link.id}
                className={`vac-map-link ${link.far ? 'is-far' : ''} ${link.back ? 'is-back' : ''}`}
                d={link.d}
                markerEnd={link.back ? 'url(#vac-arrow-back)' : 'url(#vac-arrow)'}
              />
            ))}
          </svg>

          {columns.map((column, at) => (
            <div className="vac-map-col" key={at}>
              <div className="vac-map-col-head">
                {at === 0 ? 'старт' : `${at + 1}-я очередь`}
                {column.length > 1 && <span className="vac-map-par">одновременно</span>}
              </div>
              {column.map(({ step }) => (
                <MapNode
                  key={step.key}
                  step={step}
                  live={live}
                  assignees={assignees}
                  onPick={onPick}
                  hold={el => { if (el) nodes.current.set(step.key, el); else nodes.current.delete(step.key); }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="vac-map-legend">
        Колонка — то, что идёт одновременно, стрелка — «ждёт закрытия»,
        линия понизу — возврат работы назад.
        {!live && ' Порядок задаётся полем «Появляется после» в карточке шага.'}
      </div>
    </div>
  );
}

function MapNode({ step, live, assignees, onPick, hold }) {
  const state = stateOf(step, live);

  // Кто делает шаг. В конструкторе это назначенные люди (их-то и проверяют,
  // глядя на схему), у живой заявки — тот, кто её закрыл или взял.
  let who = null;
  let warn = false;
  if (step.scope === 'candidate') {
    who = 'кандидат';
  } else if (live) {
    const task = step.task;
    who = task?.completer?.displayName || task?.claimer?.displayName
      || (task && !task.assigneeIds?.length ? 'некому' : null);
    warn = Boolean(task && !task.assigneeIds?.length && !task.completedAt);
  } else if (assignees?.knownKeys) {
    const { current } = assignees.forStep(step.key, step.scope);
    if (!current.length) { who = 'не назначен'; warn = assignees.knownKeys.has(step.key); }
    else if (current.length === 1) who = current[0].user?.displayName || current[0].user?.username || '—';
    else who = `${current[0].user?.displayName || '—'} +${current.length - 1}`;
  }

  // Шаг, который ничего не ждёт и не является решением, не появится никогда:
  // открывает его закрытие предшественника, а предшественника нет. На схеме это
  // видно и так — узел стоит в первой колонке без единой стрелки, — но молчать
  // об этом означало бы оставить человека гадать, почему он там.
  const orphan = step.kind !== 'decision' && !(step.after || []).length;

  return (
    <button
      type="button"
      ref={hold}
      className={`vac-node ${state ? `is-${state}` : ''} ${orphan ? 'is-orphan' : ''}`}
      onClick={onPick ? () => onPick(step) : undefined}
      title={onPick ? 'Открыть карточку шага' : undefined}
    >
      <span className="vac-node-top">
        <span className="vac-node-kind">{KIND_LABEL[step.kind] || 'отметка'}</span>
        {state === 'done' && <Check size={12} className="vac-node-ok" />}
        {(state === 'open' || state === 'late') && <Clock size={12} className={state === 'late' ? 'vac-node-late' : ''} />}
        {!live && step.slaHours ? <span className="vac-node-sla">{step.slaHours} ч</span> : null}
      </span>

      <b className="vac-node-title">{step.title || step.key}</b>

      {who && (
        <span className={`vac-node-who ${warn ? 'is-warn' : ''}`}>
          <User size={11} />{who}
        </span>
      )}

      {orphan && <span className="vac-node-flag">не появится</span>}

      {step.returnTo && (
        <span className="vac-node-back">
          <RotateCcw size={11} />может вернуть назад
        </span>
      )}
    </button>
  );
}
