import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Boxes, EyeOff, Package, Play, RefreshCw, Ruler, SlidersHorizontal, X,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Проверка разбора перед созданием объектов.
 *
 * ── Почему проверка, а не ввод (ver. 7.14) ───────────────────────────────────
 *
 * До 7.14 на этом месте стоял экран, где человек проходил 54 ветки дерева 1С и
 * каждой назначал кабинет. Назначал не потому, что ветка равна кабинету — она
 * ему не равна, — а потому что без записи сопоставления не спрашивался словарь
 * предметов. Кабинет при этом всё равно перебивался «Размещением». Работа
 * состояла в том, чтобы ответить не на тот вопрос ради того, чтобы включить
 * ответ на нужный.
 *
 * Словарь закрывает все 2992 строки выгрузки и с ver. 7.14 работает сам. Вводить
 * здесь больше нечего — но и убирать экран нельзя: материализация НЕОБРАТИМА
 * (отката нет, инвентарные номера идут из монотонного счётчика и назад не
 * отматываются), и это единственное место, где видно, что произойдёт.
 *
 * ── Почему группировка по правилам, а не по дереву ───────────────────────────
 *
 * Проверять надо то, что приняло решение. Решение принимает правило словаря,
 * поэтому строки собраны по правилам: «правило „стол“ → 47 позиций карточками
 * на 312 000 ₽» пробегается глазами, а три тысячи строк — нет. Дерево 1С к
 * решению больше не причастно и на экране не участвует.
 *
 * ── Почему один путь к необратимому действию ─────────────────────────────────
 *
 * Кнопка одна и ведёт через предпросмотр: сначала показывается, что получится и
 * что будет пропущено, и только оттуда запускается создание. Две кнопки рядом,
 * различающиеся одним словом, для операции без отката — приглашение нажать не ту.
 */

const money = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const num = (value) => {
  const n = Number(value || 0);
  return n % 1 === 0 ? n.toLocaleString('ru-RU') : n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

const MATCH_LABEL = { head: 'по ведущему слову', contains: 'по подстроке', regex: 'выражение' };

const KIND_LABEL = {
  asset: 'карточками оборудования',
  material: 'остатками материалов',
  ignore: 'не учитывать',
  unmapped: 'не разобрано',
};

const KIND_ICON = { asset: Package, material: Boxes, ignore: EyeOff };

/** Чем решено — заголовок группы. */
function GroupReason({ group }) {
  if (group.source === 'none') {
    return (
      <>
        <span className="wh-warn"><AlertTriangle size={13} /> Словарь не знает этих названий</span>
        {Boolean(group.samples?.length) && (
          <div className="wh-cell-sub wh-muted">{group.samples.join(' · ')}</div>
        )}
      </>
    );
  }

  if (group.source === 'fraction') {
    return (
      <>
        <span><Ruler size={13} /> Дробное количество</span>
        <div className="wh-cell-sub wh-muted">
          Метры и миллилитры — инвентарный номер на них не выдаётся ни по какому правилу
        </div>
      </>
    );
  }

  if (group.source === 'line' || group.source === 'branch') {
    return (
      <>
        <span><SlidersHorizontal size={13} /> Задано вручную</span>
        <div className="wh-cell-sub wh-muted">
          {group.manualName || (group.source === 'branch' ? 'сопоставление ветки' : 'исключение по строке')}
        </div>
      </>
    );
  }

  return (
    <>
      <span>Правило «{group.pattern}»</span>
      <div className="wh-cell-sub wh-muted">
        {MATCH_LABEL[group.matchType] || group.matchType}
        {group.note ? ` · ${group.note}` : ''}
      </div>
    </>
  );
}

export default function WarehouseOsvReview({ access, onDone, onOpenDictionary }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [running, setRunning] = useState(false);
  const [groupLines, setGroupLines] = useState(null);

  const canEdit = Boolean(access?.capabilities?.canImportOsv);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await warehouseApi.osvReview();
      setData(payload);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить разбор');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const check = async () => {
    setRunning(true);
    try {
      const { data: result } = await warehouseApi.materializeOsv(data.import.id, { dryRun: true });
      setPreview(result);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось посчитать');
    } finally { setRunning(false); }
  };

  const commit = async () => {
    setRunning(true);
    try {
      const { data: result } = await warehouseApi.materializeOsv(data.import.id, { dryRun: false });
      setPreview({ ...result, done: true });
      toast.success('Объекты созданы');
      await load();
      await onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось выполнить');
    } finally { setRunning(false); }
  };

  if (loading) return <div className="wh-table__loading"><div className="loading-spinner" /></div>;

  if (!data?.import) {
    return (
      <div className="wh-empty">
        Нет принятого снимка. Загрузите ведомость на вкладке «Снимок» и примите её.
      </div>
    );
  }

  const t = data.totals;
  const decided = t.material + t.asset + t.ignore;
  const total = decided + t.unmapped;
  const percent = total ? Math.round((decided / total) * 100) : 0;
  const alreadyDone = data.materialized.assets + data.materialized.nomenclature > 0;

  return (
    <div className="wh-osv-map wh-review">
      <div className="wh-panel">
        <div className="wh-panel__head">
          <div className="wh-panel__title">
            Способ учёта определён у {decided} из {total} позиций · {percent}%
          </div>
          <div className="wh-panel__actions">
            <button className="wh-btn wh-btn--ghost wh-btn--sm" onClick={load}>
              <RefreshCw size={13} /> Обновить
            </button>
            {canEdit && (
              <button className="wh-btn wh-btn--primary wh-btn--sm"
                      onClick={check} disabled={running || !decided}>
                <Play size={13} /> {running ? 'Считаю…' : 'Проверить и создать'}
              </button>
            )}
          </div>
        </div>
        <div className="wh-panel__body">
          <div className="wh-osv-map__bar">
            <div className="wh-osv-map__fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="wh-osv-map__legend">
            <span><Package size={13} /> карточками: {t.asset} позиций / {t.assetUnits} ед.</span>
            <span><Boxes size={13} /> остатками: {t.material}</span>
            <span className="wh-muted">не учитывать: {t.ignore}</span>
            <span className={t.unmapped ? 'wh-warn' : 'wh-ok'}>не разобрано: {t.unmapped}</span>
            <span className="wh-muted">на сумму {money(t.sumMapped)} ₽</span>
            <span className={t.unplacedUnits ? 'wh-warn' : 'wh-ok'}>
              размещено {num(t.placedUnits)} ед., ждёт размещения {num(t.unplacedUnits)}
            </span>
          </div>
        </div>
      </div>

      {/* Разобранный снимок — не ошибка, но и не повод нажимать «создать» не
          глядя: повторный прогон достроит недостающее, а откатить созданное
          нечем. */}
      {alreadyDone && (
        <div className="wh-alert wh-alert--info">
          <AlertTriangle size={15} />
          <div>
            Снимок уже разбирали: создано {data.materialized.assets} карточек и{' '}
            {data.materialized.nomenclature} позиций номенклатуры. Повторный запуск
            добавит только недостающее — созданное он не тронет и не удалит.
          </div>
        </div>
      )}

      {Boolean(data.brokenRules?.length) && (
        <div className="wh-alert wh-alert--warning">
          <AlertTriangle size={15} />
          <div>
            Правила словаря не сработали, потому что не разбираются:{' '}
            {data.brokenRules.map(b => `«${b.pattern}»`).join(', ')}.
          </div>
        </div>
      )}

      {Boolean(t.unplacedUnits) && (
        <div className="wh-note wh-note--subtle">
          <AlertTriangle size={15} />
          <div>
            Неразмещённые единицы разбор пропустит: инвентарный номер содержит код
            специальности отделения и после выдачи не меняется, поэтому карточка
            не создаётся, пока неизвестен кабинет. Разложить их — на вкладке «Размещение».
          </div>
        </div>
      )}

      <div className="wh-table-wrap wh-table-wrap--tall">
        <table className="wh-table wh-table--compact">
          <thead>
            <tr>
              <th>Чем решено</th>
              <th>Что получится</th>
              <th className="wh-num">Позиций</th>
              <th className="wh-num">Единиц</th>
              <th className="wh-num">Сумма, ₽</th>
              <th className="wh-num">Размещено, ед.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group) => {
              const Icon = KIND_ICON[group.kind];
              return (
                <tr key={group.key} className={group.source === 'none' ? 'wh-row--open' : ''}>
                  <td><GroupReason group={group} /></td>
                  <td>
                    <span className={group.kind === 'unmapped' ? 'wh-warn' : ''}>
                      {Icon && <Icon size={13} />} {KIND_LABEL[group.kind]}
                    </span>
                    {Boolean(group.categories?.length) && (
                      <div className="wh-cell-sub wh-muted">{group.categories.join(', ')}</div>
                    )}
                    {group.mixedKind && (
                      <div className="wh-cell-sub wh-warn">внутри группы решения разошлись</div>
                    )}
                  </td>
                  <td className="wh-num">{group.lines}</td>
                  <td className="wh-num">{num(group.units)}</td>
                  <td className="wh-num">{money(group.sum)}</td>
                  <td className="wh-num">
                    {group.kind === 'ignore' || group.kind === 'unmapped' ? '—' : (
                      <span className={group.unplacedUnits ? 'wh-muted' : 'wh-ok'}>
                        {num(group.placedUnits)} / {num(group.placedUnits + group.unplacedUnits)}
                      </span>
                    )}
                  </td>
                  <td className="wh-num">
                    {group.source === 'none' && onOpenDictionary ? (
                      <button className="wh-btn wh-btn--link wh-btn--sm" onClick={onOpenDictionary}>
                        в словарь
                      </button>
                    ) : null}
                    <button className="wh-btn wh-btn--link wh-btn--sm"
                            onClick={() => setGroupLines(group)}>
                      позиции
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {preview && (
        <RunModal report={preview} running={running} canEdit={canEdit}
                  onRun={commit} onClose={() => setPreview(null)} />
      )}

      {groupLines && (
        <GroupLines group={groupLines} importId={data.import.id} account={data.import.account}
                    canEdit={canEdit}
                    onClose={() => setGroupLines(null)} onChanged={load} />
      )}
    </div>
  );
}

/**
 * Позиции одной группы: на чём именно сработала общая причина.
 * Здесь же задаётся исключение — но только по строке: правило на ветку накрыло
 * бы соседние позиции, о которых человек в этот момент не думает.
 */
function GroupLines({ group, importId, account, canEdit, onClose, onChanged }) {
  const [lines, setLines] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await warehouseApi.osvReviewLines({ importId, group: group.key });
      setLines(data.lines);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить позиции');
    }
  }, [importId, group.key]);

  useEffect(() => { load(); }, [load]);

  const override = async (line, kind) => {
    setBusyKey(line.lineKey);
    try {
      if (kind === '') {
        if (line.mappingId) await warehouseApi.deleteOsvMapping(line.mappingId);
      } else {
        await warehouseApi.saveOsvMapping({ account, lineKey: line.lineKey, name: line.name, kind });
      }
      await load();
      await onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally { setBusyKey(null); }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">
            {group.source === 'rule' ? `Правило «${group.pattern}»` : 'Позиции группы'}
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          {!lines && <div className="wh-table__loading"><div className="loading-spinner" /></div>}
          {lines && (
            <div className="wh-table-wrap wh-table-wrap--tall">
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr>
                    <th>Позиция</th>
                    <th className="wh-num">Кол-во</th>
                    <th className="wh-num">Цена за ед.</th>
                    <th className="wh-num">Сумма</th>
                    <th>Сейчас</th>
                    <th>Переопределить</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.lineKey}>
                      <td>
                        {line.name}
                        <div className="wh-cell-sub wh-muted">{line.pathText || '—'}</div>
                      </td>
                      <td className="wh-num">{num(line.closingQty)}</td>
                      <td className="wh-num">{money(line.unitCost)}</td>
                      <td className="wh-num">{money(line.closingSum)}</td>
                      <td>
                        <span className={line.kind === 'asset' ? 'wh-ok' : 'wh-muted'}>
                          {KIND_LABEL[line.kind]}
                        </span>
                        {line.scope === 'line' && <span className="wh-cell-sub">задано вручную</span>}
                      </td>
                      <td>
                        <select className="wh-osv-map__select"
                                disabled={!canEdit || busyKey === line.lineKey}
                                value={line.scope === 'line' ? line.kind : ''}
                                onChange={e => override(line, e.target.value)}>
                          <option value="">по словарю предметов</option>
                          <option value="asset">карточкой оборудования</option>
                          <option value="material">остатком материала</option>
                          <option value="ignore">не учитывать</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                  {!lines.length && (
                    <tr><td colSpan={6} className="wh-empty">В этой группе нет позиций.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Предпросмотр и запуск в одном окне.
 *
 * Кнопка запуска живёт ЗДЕСЬ, а не на экране: до неё нельзя добраться, не увидев
 * сначала, сколько объектов появится и что будет пропущено. Для действия без
 * отката порядок «сначала посмотри» должен быть устройством, а не привычкой.
 */
function RunModal({ report, running, canEdit, onRun, onClose }) {
  const rows = [
    ['Создано позиций номенклатуры', report.nomenclatureCreated],
    ['Создано карточек оборудования', report.assetsCreated],
    ['Строк прихода материалов', report.stockReceipts],
    ['Уже было создано раньше', report.alreadyDone],
    ['Пропущено без кабинета', report.skippedUnplaced],
  ];

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">{report.done ? 'Готово' : 'Что произойдёт'}</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          {report.done ? (
            <table className="wh-table wh-table--compact">
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}><td>{label}</td><td className="wh-num"><b>{value}</b></td></tr>
                ))}
                {report.documentNumber && (
                  <tr><td>Приходный документ</td><td className="wh-num wh-mono">{report.documentNumber}</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <>
              <div className="wh-hint">
                Ничего ещё не создано. Появится{' '}
                <b>{report.totals.assetUnits} карточек оборудования</b> с инвентарными
                номерами по {report.totals.asset} позициям и остатки по{' '}
                {report.totals.material} позициям.
              </div>
              {Boolean(report.skippedUnplaced) && (
                <div className="wh-note wh-note--warn">
                  <AlertTriangle size={15} />
                  <div>
                    {report.skippedUnplaced} позиций пропустим: у них не выбран кабинет.
                    Это не поломка — карточку нельзя создать раньше, чем известно место.
                    Разложить их можно на «Размещении» и запустить ещё раз, созданное
                    повторный запуск не тронет.
                  </div>
                </div>
              )}
              <div className="wh-alert wh-alert--warning">
                <AlertTriangle size={15} />
                <div>
                  Отмены нет. Инвентарные номера выдаются из сквозного счётчика и
                  после выдачи не меняются — удалить созданные карточки и вернуть
                  номера обратно портал не умеет.
                </div>
              </div>
            </>
          )}

          {Boolean(report.problems?.length) && (
            <>
              <div className="wh-subhead">
                <AlertTriangle size={15} /> Будет пропущено: {report.problems.length}
              </div>
              <div className="wh-table-wrap">
                <table className="wh-table wh-table--compact">
                  <tbody>
                    {report.problems.slice(0, 40).map((p, i) => (
                      <tr key={i}>
                        <td>{p.name}<div className="wh-cell-sub wh-muted">{p.pathText}</div></td>
                        <td className="wh-warn">{p.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="wh-modal__foot">
          {report.done ? (
            <button className="wh-btn wh-btn--primary" onClick={onClose}>Понятно</button>
          ) : (
            <>
              <button className="wh-btn wh-btn--ghost" onClick={onClose}>Отмена</button>
              <button className="wh-btn wh-btn--primary" disabled={!canEdit || running} onClick={onRun}>
                <Play size={14} /> {running ? 'Создаю…' : 'Создать объекты'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
