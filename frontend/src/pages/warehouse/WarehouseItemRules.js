import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Check, Info, RefreshCw, Regex, Search, Trash2, X,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Словарь предметов: чем является позиция ведомости.
 *
 * ── Почему экран устроен как список слов, а не как список правил ─────────────
 *
 * Правила — это результат работы, а не сама работа. Работа состоит в том, чтобы
 * пройти ведомость и сказать, что в ней лежит; и единственный способ сделать это
 * за обозримое время — идти по ведущим словам названий, а не по строкам. Разных
 * слов 622 на 2992 строки, при этом первые полсотни закрывают половину
 * ведомости, первые двести — четыре пятых.
 *
 * Поэтому главная таблица здесь — слова снимка, отсортированные по числу строк, с
 * ценой вопроса рядом. Человек видит, что одно решение про «шкаф» закрывает 129
 * строк на 8,5 млн ₽, и идёт сверху вниз, пока не надоест: недоразмеченный
 * словарь работает, просто оставшееся достаётся порогу цены, как было раньше.
 *
 * ── Почему сохранение без кнопки ─────────────────────────────────────────────
 *
 * Ровно по той же причине, что и на экране разбора: это полсотни мелких решений
 * подряд, и кнопка после каждого превратила бы работу в упражнение на
 * внимательность.
 *
 * ── Почему примеры названий в таблице обязательны ────────────────────────────
 *
 * По слову «набор» невозможно решить, что это: в ведомости это и «Набор
 * инструментов для операций на носовой перегородке» за 97 280 ₽, и «Набор
 * расширителей гинекол. №3-10». Без трёх живых названий рядом разметка
 * превращается в угадывание.
 */

// Способ учёта. Формулировки намеренно описывают последствие, а не механику:
// человек выбирает не значение поля, а то, что произойдёт с вещью.
const ACCOUNTING = [
  { value: 'auto',     label: 'По цене: дорогое — карточкой' },
  { value: 'asset',    label: 'Всегда карточкой' },
  { value: 'material', label: 'Всегда остатком' },
  { value: 'ignore',   label: 'Не заводить' },
];

const MATCH_LABEL = {
  head: 'ведущее слово',
  contains: 'подстрока',
  regex: 'выражение',
};

const money = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const num = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 });

export default function WarehouseItemRules({ access, onChanged }) {
  const [data, setData] = useState(null);
  const [rules, setRules] = useState({ rules: [], broken: [] });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [q, setQ] = useState('');
  const [expr, setExpr] = useState(null);

  const canEdit = Boolean(access?.capabilities?.canManageCatalog);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [heads, list, cats] = await Promise.all([
        warehouseApi.itemRuleHeads(),
        warehouseApi.itemRules(),
        warehouseApi.categories(),
      ]);
      setData(heads.data);
      setRules(list.data);
      setCategories(cats.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить словарь');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Правило по ведущему слову ищется по самому слову: сохраняя его, мы кладём в
  // pattern ровно тот текст, который показан в строке таблицы.
  const headRules = useMemo(() => {
    const map = new Map();
    for (const rule of rules.rules || []) {
      if (rule.matchType === 'head') map.set(String(rule.pattern).toLowerCase(), rule);
    }
    return map;
  }, [rules]);

  const exprRules = useMemo(
    () => (rules.rules || []).filter(r => r.matchType !== 'head'),
    [rules],
  );

  const save = async (head, patch) => {
    const current = headRules.get(head) || {};
    setSavingKey(head);
    try {
      await warehouseApi.saveItemRule({
        id: current.id,
        pattern: head,
        matchType: 'head',
        accounting: current.accounting || 'auto',
        categoryId: current.categoryId || null,
        assetThreshold: current.assetThreshold ?? null,
        ...patch,
      });
      await load();
      await onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить правило');
    } finally {
      setSavingKey(null);
    }
  };

  const remove = async (rule) => {
    setSavingKey(rule.pattern);
    try {
      await warehouseApi.deleteItemRule(rule.id);
      await load();
      await onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось удалить правило');
    } finally {
      setSavingKey(null);
    }
  };

  const visible = useMemo(() => {
    const list = data?.heads || [];
    const needle = q.trim().toLowerCase();
    return list.filter((h) => {
      if (onlyOpen && h.covered === h.lines) return false;
      if (!needle) return true;
      return h.head.includes(needle)
        || h.samples.some(s => String(s).toLowerCase().includes(needle));
    });
  }, [data, onlyOpen, q]);

  if (loading) return <div className="wh-table__loading"><div className="loading-spinner" /></div>;

  if (!data?.import) {
    return (
      <div className="wh-empty">
        Нет принятого снимка. Загрузите ведомость на вкладке «Снимок» и примите её —
        словарь размечается по словам из неё.
      </div>
    );
  }

  const t = data.totals;
  const percent = t.lines ? Math.round((t.coveredLines / t.lines) * 100) : 0;

  return (
    <div className="wh-dict">
      <div className="wh-panel">
        <div className="wh-panel__head">
          <div className="wh-panel__title">
            Словарь закрывает {t.coveredLines} из {t.lines} позиций · {percent}%
          </div>
          <div className="wh-panel__actions">
            <button className="wh-btn wh-btn--ghost wh-btn--sm" onClick={load}>
              <RefreshCw size={13} /> Обновить
            </button>
            {canEdit && (
              <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => setExpr({})}>
                <Regex size={13} /> Правило по выражению
              </button>
            )}
          </div>
        </div>
        <div className="wh-panel__body">
          <div className="wh-osv-map__bar">
            <div className="wh-osv-map__fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="wh-osv-map__legend">
            <span>слов размечено: {t.coveredHeads} из {t.heads}</span>
            <span className="wh-muted">на сумму {money(t.coveredSum)} ₽ из {money(t.sum)} ₽</span>
            <span className="wh-muted">правил: {rules.rules.length}</span>
          </div>
        </div>
      </div>

      {Boolean(rules.broken?.length) && (
        <div className="wh-alert wh-alert--warning">
          <AlertTriangle size={15} />
          <div>
            Не разбираются и поэтому не работают: {rules.broken.map(b => `«${b.pattern}»`).join(', ')}.
            Такое правило видно в списке как обычное, но при разборе оно молча
            пропускается — поправьте выражение или удалите его.
          </div>
        </div>
      )}

      <div className="wh-note wh-note--subtle">
        <Info size={15} />
        <div>
          Слова отсортированы по числу позиций: первые полсотни закрывают около
          половины ведомости. Размечать весь список не нужно — неразмеченное
          достанется порогу цены, как и раньше. Категория попадёт в карточку
          оборудования и в номенклатуру, а «как учитывать» решит, появится ли у
          вещи инвентарный номер.
        </div>
      </div>

      <div className="wh-assets__filters">
        <div className="wh-search">
          <Search size={15} />
          <input value={q} placeholder="Слово или название позиции"
                 onChange={e => setQ(e.target.value)} />
        </div>
        <label className="wh-check">
          <input type="checkbox" checked={onlyOpen}
                 onChange={e => setOnlyOpen(e.target.checked)} />
          Только неразмеченные
        </label>
      </div>

      <div className="wh-table-wrap wh-table-wrap--tall">
        <table className="wh-table wh-table--compact">
          <thead>
            <tr>
              <th>Слово и что за ним стоит</th>
              <th className="wh-num">Позиций</th>
              <th className="wh-num">Единиц</th>
              <th className="wh-num">Сумма, ₽</th>
              <th>Что это</th>
              <th>Как учитывать</th>
              <th className="wh-num">Порог, ₽</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => {
              const rule = headRules.get(h.head);
              const busy = savingKey === h.head;
              // Слово может быть закрыто выражением, а не правилом по слову —
              // тогда своего правила у него нет, и предлагать «сбросить» нечего.
              const byOther = !rule && h.covered > 0;
              return (
                <tr key={h.head} className={h.covered === h.lines ? '' : 'wh-row--open'}>
                  <td>
                    <div className="wh-cell-main">{h.head}</div>
                    <div className="wh-cell-sub wh-muted" title={h.samples.join('\n')}>
                      {h.samples[0]}
                    </div>
                    {byOther && (
                      <div className="wh-cell-sub wh-ok">
                        закрыто выражением: {h.rules.map(r => r.pattern).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="wh-num">
                    {h.covered === h.lines
                      ? h.lines
                      : <span className="wh-muted">{h.covered} / {h.lines}</span>}
                  </td>
                  <td className="wh-num">{num(h.units)}</td>
                  <td className="wh-num">{money(h.sum)}</td>
                  <td>
                    <select className="wh-osv-map__select" disabled={!canEdit || busy}
                            value={rule?.categoryId || ''}
                            onChange={e => save(h.head, { categoryId: e.target.value || null })}>
                      <option value="">— не задано —</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.kind === 'fixed' ? '' : ' (материалы)'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="wh-osv-map__select" disabled={!canEdit || busy}
                            value={rule?.accounting || 'auto'}
                            onChange={e => save(h.head, { accounting: e.target.value })}>
                      {ACCOUNTING.map(a => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="wh-num">
                    {(rule?.accounting || 'auto') === 'auto' && (
                      <input className="wh-osv-map__threshold" type="number" step="1000"
                             disabled={!canEdit || busy}
                             defaultValue={rule?.assetThreshold ?? ''}
                             placeholder="общий"
                             title="Порог для этого класса вещей: дороже — карточка, дешевле — остаток"
                             onBlur={(e) => {
                               const value = e.target.value === '' ? null : Number(e.target.value);
                               const was = rule?.assetThreshold == null ? null : Number(rule.assetThreshold);
                               if (value !== was) save(h.head, { assetThreshold: value });
                             }} />
                    )}
                  </td>
                  <td className="wh-num">
                    {rule && canEdit && (
                      <button className="wh-icon-btn wh-icon-btn--danger" title="Убрать правило"
                              disabled={busy} onClick={() => remove(rule)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr><td colSpan={8} className="wh-empty">
                {onlyOpen ? 'Неразмеченных слов не осталось.' : 'Ничего не нашлось.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {Boolean(exprRules.length) && (
        <>
          <div className="wh-subhead"><Regex size={15} /> Правила по выражению</div>
          <div className="wh-table-wrap">
            <table className="wh-table wh-table--compact">
              <thead>
                <tr>
                  <th>Выражение</th><th>Способ</th><th>Что это</th>
                  <th>Как учитывать</th><th>Примечание</th><th />
                </tr>
              </thead>
              <tbody>
                {exprRules.map(rule => (
                  <tr key={rule.id}>
                    <td className="wh-mono">{rule.pattern}</td>
                    <td className="wh-cell-sub">{MATCH_LABEL[rule.matchType]}</td>
                    <td className="wh-cell-sub">{rule.category?.name || '—'}</td>
                    <td className="wh-cell-sub">
                      {ACCOUNTING.find(a => a.value === rule.accounting)?.label}
                    </td>
                    <td className="wh-cell-sub">{rule.note || '—'}</td>
                    <td className="wh-num">
                      {canEdit && (
                        <button className="wh-icon-btn wh-icon-btn--danger" title="Удалить"
                                onClick={() => remove(rule)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {expr && (
        <ExpressionModal categories={categories} onClose={() => setExpr(null)}
                         onSaved={async () => { setExpr(null); await load(); await onChanged?.(); }} />
      )}
    </div>
  );
}

/**
 * Правило по выражению — исключение из общего правила по слову.
 *
 * Выражение сильнее ведущего слова: его и пишут ровно тогда, когда правило по
 * слову ошибается на части строк («электрод» — карточка, но одноразовые
 * электроды расходник). Поэтому здесь обязательна проверка: человек должен
 * увидеть, что именно поймает выражение, до того как оно начнёт действовать на
 * три тысячи строк, а не после разбора.
 */
function ExpressionModal({ categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    pattern: '', matchType: 'contains', accounting: 'auto',
    categoryId: '', assetThreshold: '', note: '',
  });
  const [probe, setProbe] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    if (key === 'pattern' || key === 'matchType') setProbe(null);
  };

  const check = async () => {
    if (!form.pattern.trim()) return;
    setChecking(true);
    try {
      const { data } = await warehouseApi.probeItemRule({
        pattern: form.pattern.trim(), matchType: form.matchType,
      });
      setProbe(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось проверить выражение');
      setProbe(null);
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      await warehouseApi.saveItemRule({
        pattern: form.pattern.trim(),
        matchType: form.matchType,
        accounting: form.accounting,
        categoryId: form.categoryId || null,
        assetThreshold: form.assetThreshold === '' ? null : Number(form.assetThreshold),
        note: form.note || null,
      });
      toast.success('Правило сохранено');
      await onSaved();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">Правило по выражению</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-note wh-note--subtle">
            <Info size={15} />
            <div>
              Выражение сильнее правила по ведущему слову — оно для исключений.
              «Подстрока» ищет кусок текста в названии, «выражение» — регулярное
              выражение. Проверьте, что попадёт, прежде чем сохранять.
            </div>
          </div>

          <div className="wh-form">
            <div className="wh-form__row2">
              <label>Что искать
                <input value={form.pattern} autoFocus
                       placeholder="одноразов"
                       onChange={e => set('pattern', e.target.value)} />
              </label>
              <label>Способ поиска
                <select value={form.matchType} onChange={e => set('matchType', e.target.value)}>
                  <option value="contains">Подстрока в названии</option>
                  <option value="regex">Регулярное выражение</option>
                </select>
              </label>
            </div>
            <div className="wh-form__row2">
              <label>Что это
                <select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
                  <option value="">— не задано —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Как учитывать
                <select value={form.accounting} onChange={e => set('accounting', e.target.value)}>
                  {ACCOUNTING.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </label>
            </div>
            {form.accounting === 'auto' && (
              <label>Порог, ₽
                <input type="number" step="1000" value={form.assetThreshold}
                       placeholder="общий порог модуля"
                       onChange={e => set('assetThreshold', e.target.value)} />
              </label>
            )}
            <label>Примечание
              <input value={form.note} placeholder="Зачем это правило"
                     onChange={e => set('note', e.target.value)} />
            </label>
          </div>

          <div className="wh-panel__actions">
            <button className="wh-btn wh-btn--secondary wh-btn--sm"
                    onClick={check} disabled={checking || !form.pattern.trim()}>
              {checking ? 'Проверяю…' : 'Проверить по снимку'}
            </button>
          </div>

          {probe && (
            <>
              <div className={probe.matched ? 'wh-subhead' : 'wh-alert wh-alert--warning'}>
                {probe.matched
                  ? `Поймает ${probe.matched} из ${probe.total} позиций на ${money(probe.sum)} ₽`
                  : 'Не поймает ни одной позиции — правило не сработает'}
              </div>
              {Boolean(probe.samples?.length) && (
                <div className="wh-table-wrap">
                  <table className="wh-table wh-table--compact">
                    <thead>
                      <tr><th>Позиция</th><th className="wh-num">Кол-во</th><th className="wh-num">Цена за ед.</th></tr>
                    </thead>
                    <tbody>
                      {probe.samples.map((s, i) => (
                        <tr key={i}>
                          <td>{s.name}</td>
                          <td className="wh-num">{num(s.closingQty)}</td>
                          <td className="wh-num">{s.unitCost === null ? '—' : money(s.unitCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit}
                  disabled={saving || !form.pattern.trim()}>
            <Check size={15} /> {saving ? 'Сохраняю…' : 'Сохранить правило'}
          </button>
        </div>
      </div>
    </div>
  );
}
