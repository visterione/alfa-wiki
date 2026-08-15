import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Boxes, ChevronDown, ChevronRight, Info, Package, Play, RefreshCw, X,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Разбор ведомости: во что превращается каждая ветка дерева 1С.
 *
 * Экран строится вокруг одного действия — «эта ветка лежит в этом кабинете».
 * Всё остальное портал выводит сам: строку дороже порога делает карточкой с
 * инвентарным номером и QR, дешевле — остатком на полке. Требовать решения по
 * каждой из 2992 строк значило бы не разобрать ведомость никогда, поэтому
 * решение принимается по ветке, а строки его наследуют.
 *
 * Наследование показано явно, отдельным значением «наследует» в списке: без
 * него пустой выпадающий список у вложенной ветки читался бы как «не разобрано»,
 * хотя родитель её уже закрыл.
 *
 * Изменения сохраняются сразу, без кнопки «Сохранить». Разбор — это полсотни
 * мелких решений подряд, и кнопка после каждого превратила бы работу в
 * упражнение на внимательность.
 */

const KINDS = [
  { value: 'auto', label: 'Авто: дорогое — карточкой, дешёвое — остатком' },
  { value: 'asset', label: 'Всё карточками оборудования' },
  { value: 'material', label: 'Всё остатками материалов' },
  { value: 'ignore', label: 'Не учитывать' },
];

const money = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

function flattenRooms(tree) {
  const out = [];
  for (const mc of tree?.medCenters || []) {
    for (const r of mc.rooms || []) {
      out.push({
        id: r.id, storages: r.storages || [],
        label: `${mc.name} · Каб. ${r.number}${r.name && r.name !== r.number ? ` — ${r.name}` : ''}`,
      });
    }
    for (const b of mc.buildings || []) {
      for (const f of b.floors || []) {
        for (const r of f.rooms || []) {
          out.push({
            id: r.id,
            storages: r.storages || [],
            label: `${b.name} · ${f.number} эт. · Каб. ${r.number}${r.name && r.name !== r.number ? ` — ${r.name}` : ''}`,
          });
        }
      }
    }
  }
  return out;
}

export default function WarehouseOsvMapping({ access, tree, onDone }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [branchLines, setBranchLines] = useState(null);

  const rooms = useMemo(() => flattenRooms(tree), [tree]);
  const canEdit = Boolean(access?.capabilities?.canImportOsv);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await warehouseApi.osvMapping();
      setData(payload);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить разбор');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (node, patch) => {
    setSavingKey(node.path);
    try {
      await warehouseApi.saveOsvMapping({
        account: data.import.account,
        pathPrefix: node.path,
        name: node.name,
        kind: node.mapping?.kind || 'auto',
        roomId: node.mapping?.roomId || null,
        storageId: node.mapping?.storageId || null,
        assetThreshold: node.mapping?.assetThreshold ?? null,
        ...patch,
      });
      await load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally { setSavingKey(null); }
  };

  const clear = async (node) => {
    if (!node.mapping) return;
    setSavingKey(node.path);
    try {
      await warehouseApi.deleteOsvMapping(node.mapping.id);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сбросить');
    } finally { setSavingKey(null); }
  };

  const run = async (dryRun) => {
    setRunning(true);
    try {
      const { data: result } = await warehouseApi.materializeOsv(data.import.id, { dryRun });
      setReport({ ...result, dryRun });
      if (!dryRun) {
        toast.success('Объекты созданы');
        await load();
        await onDone?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось выполнить');
    } finally { setRunning(false); }
  };

  // Свёрнутая ветка прячет вложенные: узлы идут в порядке файла, поэтому хватает
  // пропуска всего, что глубже, до первого узла того же уровня.
  const visible = useMemo(() => {
    const nodes = data?.nodes || [];
    const out = [];
    let hiddenAbove = null;
    for (const node of nodes) {
      if (hiddenAbove !== null) {
        if (node.level > hiddenAbove) continue;
        hiddenAbove = null;
      }
      out.push(node);
      if (collapsed.has(node.path)) hiddenAbove = node.level;
    }
    return out;
  }, [data, collapsed]);

  const toggle = path => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  if (loading) return <div className="wh-table__loading"><div className="loading-spinner" /></div>;

  if (!data?.import) {
    return (
      <div className="wh-empty">
        Нет принятого снимка. Загрузите ведомость на вкладке «Снимок» и примите её.
      </div>
    );
  }

  const t = data.totals;
  const mapped = t.material + t.asset + t.ignore;
  const total = mapped + t.unmapped;
  const percent = total ? Math.round((mapped / total) * 100) : 0;

  return (
    <div className="wh-osv-map">
      <div className="wh-panel">
        <div className="wh-panel__head">
          <div className="wh-panel__title">
            Разобрано {mapped} из {total} позиций · {percent}%
          </div>
          <div className="wh-panel__actions">
            <button className="wh-btn wh-btn--ghost wh-btn--sm" onClick={load}>
              <RefreshCw size={13} /> Обновить
            </button>
            {canEdit && (
              <>
                <button className="wh-btn wh-btn--secondary wh-btn--sm"
                        onClick={() => run(true)} disabled={running || !mapped}>
                  Проверить
                </button>
                <button className="wh-btn wh-btn--primary wh-btn--sm"
                        onClick={() => run(false)} disabled={running || !mapped}>
                  <Play size={13} /> {running ? 'Создаю…' : 'Создать объекты'}
                </button>
              </>
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
            {/* Сколько решил словарь, а сколько досталось порогу цены. Без этой
                цифры непонятно, стоит ли идти размечать слова: разбор выглядит
                одинаково и при пустом словаре, и при заполненном. */}
            <span className="wh-muted">
              по словарю: {t.byDictionary}, по цене: {t.byThreshold}
            </span>
          </div>
        </div>
      </div>

      <div className="wh-note wh-note--subtle">
        <Info size={15} />
        <div>
          Достаточно выбрать кабинет — остальное портал решит сам: позиция дороже{' '}
          {money(data.defaultThreshold)} ₽ за единицу станет карточкой с инвентарным номером
          и QR, дешевле — остатком на полке. Вложенные ветки наследуют выбор родителя,
          пока им не задан свой.
        </div>
      </div>

      <div className="wh-table-wrap wh-table-wrap--tall">
        <table className="wh-table wh-table--compact">
          <thead>
            <tr>
              <th>Ветка ведомости</th>
              <th className="wh-num">Позиций</th>
              <th className="wh-num">Сумма, ₽</th>
              <th>Кабинет</th>
              <th>Что это</th>
              <th className="wh-num">Порог, ₽</th>
              <th className="wh-num">Разобрано</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((node) => {
              const isCollapsed = collapsed.has(node.path);
              const own = node.mapping;
              const busy = savingKey === node.path;
              const done = node.stats.lines - node.stats.unmapped;
              return (
                <tr key={node.id} className="wh-tree__group">
                  <td className="wh-tree__cell" style={{ paddingLeft: 10 + node.level * 16 }}
                      onClick={() => toggle(node.path)}>
                    <button className="wh-tree__toggle" tabIndex={-1}>
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <span className="wh-tree__label">{node.name}</span>
                  </td>
                  <td className="wh-num">{node.stats.lines}</td>
                  <td className="wh-num">{money(node.closingSum)}</td>
                  <td>
                    <select className="wh-osv-map__select" disabled={!canEdit || busy}
                            value={own?.roomId || ''}
                            onChange={(e) => {
                              const roomId = e.target.value;
                              if (!roomId && own) return clear(node);
                              return save(node, { roomId });
                            }}>
                      <option value="">— наследует —</option>
                      {rooms.map(r => (
                        <option key={r.id} value={r.id}
                                disabled={!r.storages.length}>
                          {r.label}{r.storages.length ? '' : ' (нет мест хранения)'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="wh-osv-map__select" disabled={!canEdit || busy || !own}
                            value={own?.kind || 'auto'}
                            onChange={e => save(node, { kind: e.target.value })}>
                      {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                  </td>
                  <td className="wh-num">
                    {own?.kind === 'auto' && (
                      <input className="wh-osv-map__threshold" type="number" step="1000"
                             disabled={!canEdit || busy}
                             defaultValue={own.assetThreshold ?? data.defaultThreshold}
                             title="Порог: дороже — карточка, дешевле — остаток"
                             onBlur={(e) => {
                               const value = e.target.value === '' ? null : Number(e.target.value);
                               if (value !== (own.assetThreshold === null ? data.defaultThreshold : Number(own.assetThreshold))) {
                                 save(node, { assetThreshold: value });
                               }
                             }} />
                    )}
                  </td>
                  <td className="wh-num">
                    {node.stats.lines === 0 ? '—' : (
                      <span className={node.stats.unmapped ? 'wh-muted' : 'wh-ok'}>
                        {done} / {node.stats.lines}
                      </span>
                    )}
                  </td>
                  <td className="wh-num">
                    <button className="wh-btn wh-btn--link wh-btn--sm"
                            onClick={() => setBranchLines({ node })}>
                      позиции
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {report && <ReportModal report={report} onClose={() => setReport(null)} />}

      {branchLines && (
        <BranchLines node={branchLines.node} importId={data.import.id} account={data.import.account}
                     canEdit={canEdit} threshold={data.defaultThreshold}
                     onClose={() => setBranchLines(null)} onChanged={load} />
      )}
    </div>
  );
}

/**
 * Позиции одной ветки: что именно стало карточкой, что остатком и почему.
 *
 * Без этого списка разделение выглядит произволом. Разделяет цена за единицу в
 * КОНКРЕТНОЙ строке, а не название товара, — и одна и та же вещь в разных ветках
 * 1С стоит по-разному (это партии: разное время закупки, разная амортизация).
 * Поэтому «Облучатель МЕГИДЕЗ» может быть карточкой за 14 044 ₽ на Астраханской
 * и остатком по 5 162 ₽ в новом корпусе. Пока цены не видно рядом, это выглядит
 * ошибкой программы.
 */
function BranchLines({ node, importId, account, canEdit, threshold, onClose, onChanged }) {
  const [lines, setLines] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await warehouseApi.osvMappingLines({ importId, path: node.path });
      setLines(data.lines);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить позиции');
    }
  }, [importId, node.path]);

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

  const label = { asset: 'карточками', material: 'остатком', ignore: 'не учитывать', unmapped: 'не разобрано' };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">{node.name}</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-note wh-note--subtle">
            <Info size={15} />
            <div>
              Сторону выбирает цена за единицу в этой строке, а не название: порог{' '}
              {money(node.mapping?.assetThreshold ?? threshold)} ₽. Одна и та же вещь в разных
              ветках 1С числится по разной балансовой стоимости — это партии, — поэтому она
              может оказаться и карточкой, и остатком. Здесь любую строку можно переставить
              вручную.
            </div>
          </div>
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
                      <td>{line.name}</td>
                      <td className="wh-num">{line.closingQty}</td>
                      <td className="wh-num">{money(line.unitCost)}</td>
                      <td className="wh-num">{money(line.closingSum)}</td>
                      <td>
                        <span className={line.kind === 'asset' ? 'wh-ok' : 'wh-muted'}>
                          {label[line.kind]}
                        </span>
                        {line.scope === 'line' && <span className="wh-cell-sub">задано вручную</span>}
                      </td>
                      <td>
                        <select className="wh-osv-map__select" disabled={!canEdit || busyKey === line.lineKey}
                                value={line.scope === 'line' ? line.kind : ''}
                                onChange={e => override(line, e.target.value)}>
                          <option value="">по правилу ветки</option>
                          <option value="asset">карточкой оборудования</option>
                          <option value="material">остатком материала</option>
                          <option value="ignore">не учитывать</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                  {!lines.length && (
                    <tr><td colSpan={6} className="wh-empty">
                      В этой ветке нет собственных позиций — только вложенные ветки.
                    </td></tr>
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
 * Отчёт о прогоне. Показывается и для проверки, и для настоящего запуска: разница
 * между ними в одном слове, и путать их нельзя — второй создаёт объекты.
 */
function ReportModal({ report, onClose }) {
  const rows = [
    ['Создано позиций номенклатуры', report.nomenclatureCreated],
    ['Создано карточек оборудования', report.assetsCreated],
    ['Строк прихода материалов', report.stockReceipts],
    ['Уже было создано раньше', report.alreadyDone],
  ];
  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">{report.dryRun ? 'Проверка' : 'Готово'}</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          {report.dryRun ? (
            <div className="wh-note wh-note--subtle">
              <Info size={15} />
              <div>
                Ничего не создано. По разобранным веткам получится{' '}
                {report.totals.asset} позиций карточками ({report.totals.assetUnits} единиц)
                и {report.totals.material} позиций остатками.
              </div>
            </div>
          ) : (
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
          )}

          {/* Сломанное выражение словаря не роняет разбор, но и молчать о нём
              нельзя: правило просто не сработало, и без этой строки человек
              считал бы, что оно применилось. */}
          {Boolean(report.brokenRules?.length) && (
            <div className="wh-alert wh-alert--warning">
              <AlertTriangle size={15} />
              <div>
                Правила словаря не сработали, потому что не разбираются:{' '}
                {report.brokenRules.map(b => `«${b.pattern}»`).join(', ')}.
              </div>
            </div>
          )}

          {Boolean(report.problems?.length) && (
            <>
              <div className="wh-subhead"><AlertTriangle size={15} /> Пропущено: {report.problems.length}</div>
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
          <button className="wh-btn wh-btn--primary" onClick={onClose}>Понятно</button>
        </div>
      </div>
    </div>
  );
}
