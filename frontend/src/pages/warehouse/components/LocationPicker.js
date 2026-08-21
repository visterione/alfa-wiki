import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, DoorOpen, Search, X } from 'lucide-react';
import { dropStyle, useAnchoredDrop, usePortalHost } from './dropdownPortal';

/**
 * Выбор кабинета или места хранения по дереву локаций.
 *
 * ── Что было не так ──────────────────────────────────────────────────────────
 *
 * Во всех формах модуля кабинет выбирался обычным <select>, куда дерево
 * укладывалось плоским списком с полным путём в каждой строке:
 * «МЦ Альфа · Главный корпус · 1 эт. · Каб. 1 · Шкаф А1». Таких строк под сотню,
 * различаются они последними двумя словами, а первые тридцать символов у всех
 * одинаковые — глазу не за что зацепиться, и выбор превращался в вычитывание
 * почти одинаковых строк. Набрать номер кабинета было нельзя: браузер ищет по
 * началу строки, а начинается она с названия медцентра.
 *
 * ── Что здесь вместо этого ───────────────────────────────────────────────────
 *
 * Одно и то же дерево показано деревом: медцентр → корпус → этаж → кабинет →
 * место хранения. Путь читается вложенностью, а не повторяется в каждой строке,
 * поэтому в строке остаётся только то, чем она отличается от соседних.
 *
 * Сверху — поле ввода, и это главный способ выбора для того, кто знает, что
 * ищет: «12» находит кабинет 12, «шкаф» — все шкафы, «хирург 2» — второй
 * кабинет хирургии. Пока в поле что-то набрано, дерево уступает место плоскому
 * списку найденного с путём мелким шрифтом — при поиске важно не место в
 * иерархии, а сам факт совпадения.
 *
 * Выбранное значение показывается коротко («Каб. 12 · Шкаф А1»), полный путь
 * остаётся в подсказке title: в поле ширины на него всё равно нет, а нужен он
 * раз в жизни — когда номера кабинетов в двух корпусах совпали.
 *
 * ── Режимы ───────────────────────────────────────────────────────────────────
 *
 * mode='room'     — выбирается кабинет, места хранения не показываются вовсе.
 * mode='storage'  — выбирается место хранения; кабинет остаётся веткой дерева.
 * allowRoom       — в режиме мест хранения кабинет тоже можно выбрать целиком
 *                   (там, где сервер сам подставит первое место в кабинете).
 *
 * Наружу всегда отдаётся пара {roomId, storageId}: вызывающему коду не нужно
 * догадываться, чем именно оказался выбранный узел, а формы, которые хранят оба
 * поля, заполняют их одним действием пользователя вместо двух.
 */
export default function LocationPicker({
  tree,
  mode = 'storage',
  allowRoom = false,
  roomId = '',
  storageId = '',
  onPick,
  placeholder = 'Не выбрано',
  disabled = false,
  filterRoom,
  filterStorage,
  emptyText = 'Подходящих мест нет',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const boxRef = useRef(null);
  const dropRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const portalHost = usePortalHost();
  // Панель живёт порталом с фиксированными координатами — почему именно так,
  // рассказано в dropdownPortal.js.
  const place = useAnchoredDrop(boxRef, open, { maxHeight: 420 });

  const roots = useMemo(
    () => buildBranches(tree, { mode, allowRoom, filterRoom, filterStorage }),
    [tree, mode, allowRoom, filterRoom, filterStorage]
  );

  // Плоский список того, что вообще можно выбрать, — он же список для поиска.
  const pickable = useMemo(() => collectPickable(roots), [roots]);

  // Название медцентра в свёрнутом виде показываем, только когда медцентров
  // несколько: в сети из одного центра оно стоит во всех строках и не различает
  // ничего, а место в поле занимает.
  const manyCenters = (tree?.medCenters || []).length > 1;

  const selected = useMemo(() => {
    if (storageId) return pickable.find(n => n.storageId === storageId) || null;
    if (roomId) return pickable.find(n => n.type === 'room' && n.roomId === roomId) || null;
    return null;
  }, [pickable, roomId, storageId]);

  // Клик мимо закрывает список — иначе он висит поверх соседних полей и
  // перехватывает нажатия по ним. Список живёт в портале, поэтому «мимо» — это
  // мимо обоих: и поля, и самого списка.
  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (event) => {
      const inField = boxRef.current?.contains(event.target);
      const inDrop = dropRef.current?.contains(event.target);
      if (!inField && !inDrop) setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    return () => document.removeEventListener('mousedown', onDocument);
  }, [open]);

  // Дерево и выбранный узел читаются в момент открытия, а не через зависимости
  // эффекта: фильтры прилетают из вызывающих форм новыми функциями на каждый
  // рендер, дерево вместе с ними пересобирается, и эффект-по-зависимостям
  // схлопывал бы обратно всё, что человек только что раскрыл руками.
  const rootsRef = useRef(roots);
  const selectedRef = useRef(selected);
  rootsRef.current = roots;
  selectedRef.current = selected;

  // При открытии раскрываем ветку до выбранного значения: список, открывшийся на
  // свёрнутых медцентрах, прячет как раз то, что человек уже выбрал и хочет
  // поправить. Маленькое дерево раскрываем целиком — щёлкать по треугольникам
  // там, где всё помещается на экран, незачем.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setCursor(0);
    const branches = rootsRef.current;
    const next = new Set();
    if (countRows(branches, true) <= 30) {
      forEachBranch(branches, node => { if (node.children.length) next.add(node.key); });
    } else if (branches.length === 1) {
      next.add(branches[0].key);
    }
    for (const key of selectedRef.current?.ancestors || []) next.add(key);
    setExpanded(next);
  }, [open]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return flatten(roots, 0, expanded);

    const tokens = needle.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const node of pickable) {
      if (!tokens.every(token => node.haystack.includes(token))) continue;
      scored.push({ node, rank: rankOf(node, needle) });
    }
    scored.sort((a, b) => a.rank - b.rank || a.node.sort - b.node.sort);
    return scored.slice(0, 60).map(s => ({ ...s.node, depth: 0, flat: true }));
  }, [roots, pickable, expanded, q]);

  useEffect(() => { setCursor(0); }, [q]);

  // Подсветка стрелками должна оставаться в поле зрения: список прокручиваемый,
  // и без этого курсор уходил за нижний край, а страница стояла на месте.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const toggle = (key) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const choose = (node) => {
    if (!node.pickable) return toggle(node.key);
    onPick({ roomId: node.roomId, storageId: node.storageId || '', node });
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor(i => Math.min(i + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(i => Math.max(i - 1, 0));
    } else if (event.key === 'ArrowRight') {
      const row = rows[cursor];
      if (row?.children?.length && !expanded.has(row.key)) { event.preventDefault(); toggle(row.key); }
    } else if (event.key === 'ArrowLeft') {
      const row = rows[cursor];
      if (row?.children?.length && expanded.has(row.key)) { event.preventDefault(); toggle(row.key); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (rows[cursor]) choose(rows[cursor]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`wh-combo wh-locpick ${disabled ? 'is-disabled' : ''}`} ref={boxRef}>
      <button type="button" className="wh-combo__value" disabled={disabled}
              title={selected ? selected.fullPath : undefined}
              onClick={() => setOpen(v => !v)}>
        <span className={selected ? 'wh-locpick__value' : 'wh-combo__placeholder'}>
          {selected ? shortLabel(selected, manyCenters) : placeholder}
        </span>
        {selected && !disabled ? (
          <span className="wh-combo__clear" role="button" tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onPick({ roomId: '', storageId: '', node: null }); }}>
            <X size={13} />
          </span>
        ) : (
          <ChevronDown size={14} />
        )}
      </button>

      {open && place && createPortal((
        <div className="wh-combo__drop wh-locpick__drop" ref={dropRef}
             style={dropStyle(place)}>
          <div className="wh-combo__search">
            <Search size={14} />
            <input ref={inputRef} value={q} autoFocus
                   placeholder="Номер кабинета, шкаф, корпус…"
                   onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} />
          </div>
          <div className="wh-combo__list wh-locpick__list" ref={listRef}
               style={{ maxHeight: place.maxHeight }}>
            {rows.map((row, index) => {
              const isOpen = expanded.has(row.key);
              const isPicked = row.pickable
                && (row.storageId ? row.storageId === storageId
                  : row.type === 'room' && !storageId && row.roomId === roomId);
              return (
                <button type="button" key={row.key}
                        className={[
                          'wh-locpick__row',
                          row.pickable ? '' : 'is-branch',
                          // Медцентр — верх раздела: он отбивает длинный список
                          // на куски, и в стилях у него своя подложка.
                          !row.flat && row.depth === 0 ? 'is-root' : '',
                          index === cursor ? 'is-cursor' : '',
                          isPicked ? 'is-picked' : '',
                        ].join(' ')}
                        style={{ paddingLeft: 10 + (row.depth || 0) * 15 }}
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => choose(row)}>
                  <span className="wh-locpick__twist">
                    {row.children?.length
                      ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                      : row.type === 'storage' ? null : <DoorOpen size={12} />}
                  </span>
                  <span className="wh-locpick__label">{row.label}</span>
                  {/* Путь дописывается только в результатах поиска: в дереве его
                      уже рассказала вложенность. Кабинет вынесен из пути и стоит
                      сразу за названием: именно он отличает найденные строки
                      друг от друга («Шкаф А1» есть в трёх кабинетах), и урезать
                      многоточием надо не его, а общее начало пути. */}
                  {row.flat && row.roomLabel && (
                    <span className="wh-locpick__room">{row.roomLabel}</span>
                  )}
                  {row.flat && <span className="wh-locpick__path">{row.groupPath}</span>}
                  {row.type === 'room' && row.storageCount > 0 && !row.flat && (
                    <span className="wh-locpick__count">{row.storageCount}</span>
                  )}
                  {/* Галочка, а не только цвет: подсветка занята курсором, и
                      когда он стоит не на выбранной строке, две одинаково
                      подкрашенные строки не отличить — которая уже выбрана, а
                      которую сейчас выберет Enter. */}
                  {isPicked && <Check className="wh-locpick__check" size={14} />}
                </button>
              );
            })}
            {!rows.length && <div className="wh-combo__empty">{q.trim() ? 'Ничего не нашлось' : emptyText}</div>}
            {rows.length === 60 && (
              <div className="wh-combo__more">Показаны первые 60 — уточните запрос</div>
            )}
          </div>
        </div>
      ), portalHost)}
    </div>
  );
}

/**
 * Дерево локаций в форму, удобную для отрисовки: у каждого узла есть путь до
 * него, признак «можно выбрать» и заранее собранная строка для поиска.
 *
 * Ветки, в которых после фильтров не осталось ни одного выбираемого узла,
 * выбрасываются: пустой этаж, который нельзя раскрыть, — это строка, по которой
 * человек щёлкнет и не поймёт, почему ничего не произошло.
 */
function buildBranches(tree, { mode, allowRoom, filterRoom, filterStorage }) {
  let order = 0;

  const makeRoom = (room, path, ancestors) => {
    if (filterRoom && !filterRoom(room)) return null;
    const label = `Каб. ${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}`;
    const key = `room:${room.id}`;
    const node = {
      key, type: 'room', roomId: room.id, storageId: '', room,
      label, path, ancestors, children: [],
      pickable: mode === 'room' || allowRoom,
      sort: order++,
    };

    if (mode === 'storage') {
      const roomAncestors = [...ancestors, key];
      for (const storage of room.storages || []) {
        if (filterStorage && !filterStorage(storage, room)) continue;
        node.children.push({
          key: `st:${storage.id}`, type: 'storage',
          roomId: room.id, storageId: storage.id, room, storage,
          label: storage.name, path: [...path, label], ancestors: roomAncestors,
          children: [], pickable: true, sort: order++,
        });
      }
      node.storageCount = node.children.length;
      if (!node.children.length && !node.pickable) return null;
    }
    return node;
  };

  const roots = [];
  for (const mc of tree?.medCenters || []) {
    const mcKey = `mc:${mc.id}`;
    const mcNode = {
      key: mcKey, type: 'group', label: mc.name, path: [], ancestors: [],
      children: [], pickable: false, sort: order++,
    };

    // Кабинеты без этажа висят прямо на медцентре — так их отдаёт дерево, и
    // выдумывать им корпус здесь нельзя.
    for (const room of mc.rooms || []) {
      const node = makeRoom(room, [mc.name], [mcKey]);
      if (node) mcNode.children.push(node);
    }

    for (const building of mc.buildings || []) {
      const bKey = `bld:${building.id}`;
      const bNode = {
        key: bKey, type: 'group', label: building.name, path: [mc.name],
        ancestors: [mcKey], children: [], pickable: false, sort: order++,
      };
      for (const floor of building.floors || []) {
        const fKey = `fl:${floor.id}`;
        const fLabel = `${floor.number} этаж${floor.name ? ` — ${floor.name}` : ''}`;
        const fNode = {
          key: fKey, type: 'group', label: fLabel, path: [mc.name, building.name],
          ancestors: [mcKey, bKey], children: [], pickable: false, sort: order++,
        };
        for (const room of floor.rooms || []) {
          const node = makeRoom(room, [mc.name, building.name, fLabel], [mcKey, bKey, fKey]);
          if (node) fNode.children.push(node);
        }
        if (fNode.children.length) bNode.children.push(fNode);
      }
      if (bNode.children.length) mcNode.children.push(bNode);
    }

    if (mcNode.children.length) roots.push(mcNode);
  }
  return roots;
}

/** Всё, что можно выбрать, одним списком — он же индекс для поиска. */
function collectPickable(roots) {
  const out = [];
  forEachBranch(roots, (node) => {
    if (!node.pickable) return;
    const parentPath = node.path.join(' · ');
    // У места хранения последняя ступень пути — кабинет; он показывается
    // отдельно от остального пути и не урезается.
    const isStorage = node.type === 'storage';
    out.push({
      ...node,
      roomLabel: isStorage ? node.path[node.path.length - 1] : '',
      groupPath: (isStorage ? node.path.slice(0, -1) : node.path).join(' · '),
      fullPath: [...node.path, node.label].join(' · '),
      haystack: `${parentPath} ${node.label} ${node.room?.number || ''}`.toLowerCase(),
    });
  });
  return out;
}

function forEachBranch(nodes, fn) {
  for (const node of nodes) {
    fn(node);
    if (node.children?.length) forEachBranch(node.children, fn);
  }
}

function countRows(nodes, deep) {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (deep && node.children?.length) total += countRows(node.children, deep);
  }
  return total;
}

function flatten(nodes, depth, expanded, out = []) {
  for (const node of nodes) {
    out.push({ ...node, depth });
    if (node.children?.length && expanded.has(node.key)) {
      flatten(node.children, depth + 1, expanded, out);
    }
  }
  return out;
}

/**
 * Насколько строка отвечает запросу. Точный номер кабинета — всегда первым:
 * номер набирают, когда знают его наверняка, и «12» не должно тонуть среди
 * «120», «212» и «Каб. 3 · Шкаф 12».
 */
function rankOf(node, needle) {
  const number = String(node.room?.number || '').toLowerCase();
  const label = node.label.toLowerCase();
  if (number === needle) return 0;
  if (label.startsWith(needle)) return 1;
  if (number.startsWith(needle)) return 2;
  if (label.includes(needle)) return 3;
  return 4;
}

/**
 * Короткая подпись выбранного: кабинет и место хранения. Медцентр добавляется
 * только когда их несколько — иначе одинаковые номера кабинетов в двух корпусах
 * не различить, а в сети из одного центра это лишнее слово.
 */
function shortLabel(node, manyCenters) {
  const parts = [];
  if (manyCenters && node.path[0]) parts.push(node.path[0]);
  if (node.type === 'storage') parts.push(node.path[node.path.length - 1], node.label);
  else parts.push(node.label);
  return parts.join(' · ');
}
