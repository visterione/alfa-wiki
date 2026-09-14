/**
 * Массовая правка прав (ver. 8.31).
 *
 * ── Задача ───────────────────────────────────────────────────────────────────
 *
 * Появился новый раздел — и его надо открыть сорока людям. До этого окна это
 * означало сорок карточек, в каждой один и тот же тумблер. На сороковой карточке
 * внимание кончается, кто-то остаётся без доступа, и выясняется это его жалобой
 * через неделю.
 *
 * ── Главное решение: точечная правка, а не набор прав ────────────────────────
 *
 * Соблазн сделать «шаблон прав регистратора» и раскатать его на всех
 * регистраторов велик, но это другая функция, и она стирает всё, что настраивали
 * людям поимённо за два года. Здесь каждый пункт дерева по умолчанию стоит в
 * положении «не трогать», и в запрос уезжают только те, которые тронули явно.
 * Не «поставить такие права», а «этим людям изменить вот это, остальное оставить
 * как есть».
 *
 * Поэтому у пункта на один шаг больше, чем в карточке: кроме «включить» и
 * «выключить» есть прочерк, и это его исходное положение. Свести их в два
 * состояния нельзя — «выключить» и «не трогать» здесь противоположны по смыслу,
 * а выглядели бы одинаково.
 *
 * ── Отбор ────────────────────────────────────────────────────────────────────
 *
 * Роль и медцентр складываются сужением: «регистраторы Альфа Дети» — это десять
 * человек, а не все регистраторы сети плюс все врачи филиала. Расширяющее ИЛИ
 * здесь почти всегда ошибка, а замечают её уже после применения.
 *
 * Найденных видно поимённо, и любого можно снять галкой: отбор по справочнику
 * никогда не совпадает со списком в голове до последнего человека, а применять
 * вслепую то, что нельзя посмотреть, — как раз то, от чего это окно должно
 * избавлять.
 *
 * Суперадминистраторов в списке нет: им и так открыто всё, и запись что-то
 * изменила бы только на случай будущего снятия флага — то есть подействовала бы
 * отложенно и незаметно.
 */

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Eye, Lock, Minus, PenLine, Search, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { users as usersApi } from '../../services/api';
import { buildBulkTree, buildPatch, flattenNodes } from './permissionCatalogue';
import './BulkPermissions.css';

// «1 правка», «2 правки», «5 правок» — цифра без слова в подвале читается как
// номер, а не как количество.
function pluralEdits(n) {
  const mod100 = n % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'правок';
  if (mod10 === 1) return 'правка';
  if (mod10 >= 2 && mod10 <= 4) return 'правки';
  return 'правок';
}

const LEVEL_VIEW = {
  block: { icon: Lock,    title: 'Закрыть',        color: '#9ca3af' },
  read:  { icon: Eye,     title: 'Только чтение',  color: '#d97706' },
  edit:  { icon: PenLine, title: 'Редактирование', color: '#16a34a' },
};

/**
 * Положение пункта. Прочерк — не «выключено», а «этого пункта правка не
 * касается»; он стоит первым и подсвечен нейтрально, чтобы отличаться от
 * действия, а не выглядеть третьим действием.
 */
function NodeControl({ node, value, onChange }) {
  const options = node.kind === 'level'
    ? ['block', 'read', 'edit'].map(key => ({ key, ...LEVEL_VIEW[key] }))
    : [
      { key: false, icon: X,     title: 'Выключить', color: '#9ca3af' },
      { key: true,  icon: Check, title: 'Включить',  color: '#16a34a' },
    ];

  return (
    <div className="bulk-control">
      <button
        type="button"
        className={`bulk-opt skip ${value === undefined ? 'on' : ''}`}
        title="Не трогать"
        onClick={() => onChange(undefined)}
      ><Minus size={12} /></button>
      {options.map(opt => {
        const Icon = opt.icon;
        return (
          <button
            key={String(opt.key)}
            type="button"
            className={`bulk-opt ${value === opt.key ? 'on' : ''}`}
            style={value === opt.key ? { background: opt.color, borderColor: opt.color } : undefined}
            title={opt.title}
            onClick={() => onChange(opt.key)}
          ><Icon size={12} /></button>
        );
      })}
    </div>
  );
}

function TreeGroup({ group, values, setValue, expanded, toggleExpand }) {
  const open = !!expanded[group.id];
  // Счётчик тронутого в свёрнутой группе: иначе забытая правка в закрытой ветке
  // обнаруживается только на шаге подтверждения, а то и после применения.
  const touched = flattenNodes([group]).filter(n => values[n.id] !== undefined).length;

  return (
    <div className="bulk-group">
      <button type="button" className={`bulk-group-head ${open ? 'open' : ''}`} onClick={() => toggleExpand(group.id)}>
        <ChevronDown size={15} className="chev" />
        <span>{group.label}</span>
        {touched > 0 && <span className="bulk-count">{touched}</span>}
      </button>

      {open && (
        <div className="bulk-group-body">
          {group.items.map(item => item.isSubGroup ? (
            <div className="bulk-sub" key={item.id}>
              <button
                type="button"
                className={`bulk-sub-head ${expanded[item.id] ? 'open' : ''}`}
                onClick={() => toggleExpand(item.id)}
              >
                <ChevronDown size={13} className="chev" />
                <span>{item.label}</span>
                {item.items.filter(n => values[n.id] !== undefined).length > 0 && (
                  <span className="bulk-count">{item.items.filter(n => values[n.id] !== undefined).length}</span>
                )}
              </button>
              {expanded[item.id] && item.items.map(leaf => (
                <div className="bulk-row" key={leaf.id}>
                  {leaf.color && <span className="bulk-dot" style={{ background: leaf.color }} />}
                  <span className="bulk-row-label">{leaf.label}</span>
                  <NodeControl node={leaf} value={values[leaf.id]} onChange={v => setValue(leaf.id, v)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="bulk-row" key={item.id}>
              {item.color && <span className="bulk-dot" style={{ background: item.color }} />}
              <span className="bulk-row-label">{item.label}</span>
              <NodeControl node={item} value={values[item.id]} onChange={v => setValue(item.id, v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BulkPermissions({ userList, roleList, medCenterList, whCatalogue, onClose, onApplied }) {
  const [roleIds, setRoleIds] = useState([]);
  const [centerIds, setCenterIds] = useState([]);
  const [search, setSearch] = useState('');
  const [excluded, setExcluded] = useState(() => new Set());
  const [values, setValues] = useState({});
  const [expanded, setExpanded] = useState({ admin: true });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const tree = useMemo(() => buildBulkTree(whCatalogue), [whCatalogue]);
  // Лист запоминается вместе с разделом, в котором лежит: «Кабинеты» есть и на
  // складе, и в статистике, и в списке подтверждения одно слово без раздела
  // ничего не значило бы.
  const nodeById = useMemo(() => {
    const map = new Map();
    for (const group of tree) {
      for (const node of flattenNodes([group])) map.set(node.id, { ...node, group: group.label });
    }
    return map;
  }, [tree]);

  const filtersOn = roleIds.length > 0 || centerIds.length > 0 || search.trim().length > 0;

  // Роль и медцентр — сужение, а не расширение: см. комментарий к модулю.
  const matched = useMemo(() => {
    if (!filtersOn) return [];
    const needle = search.trim().toLocaleLowerCase('ru');
    return (userList || []).filter(u => {
      if (u.isAdmin || u.isActive === false) return false;
      if (roleIds.length) {
        const own = (u.roles || []).map(r => r.id);
        if (u.roleId) own.push(u.roleId);
        if (!roleIds.some(id => own.includes(id))) return false;
      }
      if (centerIds.length) {
        const own = (u.medCenters || []).map(m => m.id);
        if (!centerIds.some(id => own.includes(id))) return false;
      }
      if (needle) {
        const hay = `${u.displayName || ''} ${u.username || ''} ${u.position || ''}`.toLocaleLowerCase('ru');
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [userList, roleIds, centerIds, search, filtersOn]);

  const selected = matched.filter(u => !excluded.has(u.id));
  const changes = Object.entries(values).filter(([, v]) => v !== undefined);

  const setValue = (id, value) => setValues(prev => {
    const next = { ...prev };
    if (value === undefined) delete next[id]; else next[id] = value;
    return next;
  });

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleChip = (list, setList, id) =>
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const describe = ([id, value]) => {
    const node = nodeById.get(id);
    if (!node) return null;
    const what = node.kind === 'level' ? LEVEL_VIEW[value].title : (value ? 'Включить' : 'Выключить');
    return `${node.group} · ${node.label} — ${what.toLowerCase()}`;
  };

  const apply = async () => {
    setBusy(true);
    try {
      const patch = buildPatch(tree, values);
      const { data } = await usersApi.bulkPermissions({ userIds: selected.map(u => u.id), patch });
      toast.success(`Права изменены: ${data.total} чел.`);
      onApplied?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось применить права');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bulk-modal">
        <header className="bulk-head">
          <h2>Массовая правка прав</h2>
          <span className="bulk-head-note">
            Меняется только отмеченное — остальные права выбранных людей остаются как были
          </span>
          <button className="bulk-close" onClick={onClose} title="Закрыть"><X size={18} /></button>
        </header>

        <div className="bulk-body">
          {/* ── Кому ──────────────────────────────────────────────────────── */}
          <section className="bulk-col">
            <h3><Users size={15} /> Кому</h3>

            <div className="bulk-field">
              <label>Роли</label>
              <div className="bulk-chips">
                {(roleList || []).map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className={`bulk-chip ${roleIds.includes(r.id) ? 'on' : ''}`}
                    onClick={() => toggleChip(roleIds, setRoleIds, r.id)}
                  >{r.name}</button>
                ))}
              </div>
            </div>

            <div className="bulk-field">
              <label>Медцентры</label>
              <div className="bulk-chips">
                {(medCenterList || []).map(mc => (
                  <button
                    key={mc.id}
                    type="button"
                    className={`bulk-chip ${centerIds.includes(mc.id) ? 'on' : ''}`}
                    onClick={() => toggleChip(centerIds, setCenterIds, mc.id)}
                  >{mc.name}</button>
                ))}
              </div>
            </div>

            <div className="bulk-search">
              <Search size={15} />
              <input
                placeholder="Поиск по имени или логину"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="bulk-people-head">
              {filtersOn
                ? <>Найдено {matched.length}, применим к <strong>{selected.length}</strong></>
                : 'Выберите роль или медцентр — либо найдите человека поиском'}
              {matched.length > 0 && (
                <button
                  type="button"
                  className="bulk-link"
                  onClick={() => setExcluded(excluded.size ? new Set() : new Set(matched.map(u => u.id)))}
                >{excluded.size ? 'Отметить всех' : 'Снять всех'}</button>
              )}
            </div>

            <div className="bulk-people">
              {matched.map(u => (
                <label key={u.id} className={`bulk-person ${excluded.has(u.id) ? 'off' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!excluded.has(u.id)}
                    onChange={() => setExcluded(prev => {
                      const next = new Set(prev);
                      if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                      return next;
                    })}
                  />
                  <span className="bulk-person-name">{u.displayName || u.username}</span>
                  <span className="bulk-person-meta">
                    {[(u.roles || []).map(r => r.name).join(', '),
                      (u.medCenters || []).map(m => m.name).join(', ')].filter(Boolean).join(' · ')}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* ── Что изменить ──────────────────────────────────────────────── */}
          <section className="bulk-col">
            <h3>Что изменить</h3>
            <div className="bulk-legend">
              <span><Minus size={11} /> не трогать</span>
              <span><X size={11} /> выключить</span>
              <span><Check size={11} /> включить</span>
              <span><Lock size={11} /> закрыть</span>
              <span><Eye size={11} /> чтение</span>
              <span><PenLine size={11} /> правка</span>
            </div>

            <div className="bulk-tree">
              {tree.map(group => (
                <TreeGroup
                  key={group.id}
                  group={group}
                  values={values}
                  setValue={setValue}
                  expanded={expanded}
                  toggleExpand={toggleExpand}
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="bulk-foot">
          <span className="bulk-foot-state">
            {changes.length === 0
              ? 'Ни одно право не отмечено'
              : `${changes.length} ${pluralEdits(changes.length)} · ${selected.length} чел.`}
          </span>
          <button className="bulk-btn" onClick={onClose}>Отмена</button>
          <button
            className="bulk-btn primary"
            disabled={!changes.length || !selected.length}
            onClick={() => setConfirming(true)}
          >Применить…</button>
        </footer>

        {/* Подтверждение перечисляет правки словами и называет число людей.
            Отменить массовую правку нечем: прежние значения нигде не хранятся,
            и вернуть их можно только руками по карточкам — поэтому последний
            шаг показывает ровно то, что уедет на сервер. */}
        {confirming && (
          <div className="bulk-confirm">
            <div className="bulk-confirm-card">
              <h3>Применить к {selected.length} чел.?</h3>
              <ul>
                {changes.map(entry => <li key={entry[0]}>{describe(entry)}</li>)}
              </ul>
              <p className="bulk-confirm-note">
                Остальные права этих людей не изменятся. Обратного хода нет —
                прежние значения нигде не сохраняются.
              </p>
              <div className="bulk-confirm-actions">
                <button className="bulk-btn" onClick={() => setConfirming(false)} disabled={busy}>Назад</button>
                <button className="bulk-btn primary" onClick={apply} disabled={busy}>
                  {busy ? 'Применяем…' : 'Да, применить'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
