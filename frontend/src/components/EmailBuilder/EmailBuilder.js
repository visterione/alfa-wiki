/**
 * Конструктор писем (ver. 8.43).
 *
 * ── Устройство ───────────────────────────────────────────────────────────────
 *
 * Письмо — это список СЕКЦИЙ: письмо → секция → колонка → блок. Секция рисует
 * полосу во всю ширину окна почты, внутри неё содержимое держится в своих
 * 600 пикселях. Ровно на этом стоит почти любой почтовый макет: тёмная шапка от
 * края до края, белое тело, серый подвал. Плоским списком блоков такого не
 * собрать — именно поэтому документ и перешёл на вторую версию.
 *
 * Письма первой версии открываются как были: toV2 заворачивает каждый их блок
 * в секцию нулевой толщины, и вид не меняется ни на пиксель.
 *
 * ── Что здесь есть ───────────────────────────────────────────────────────────
 *
 * Палитра из двух частей (структуры и блоки), перетаскивание и тех и других на
 * холст, выбор секции / колонки / блока с разными наборами свойств, три режима
 * просмотра (холст, холст рядом с письмом, только письмо), масштаб холста,
 * отмена действий, горячие клавиши.
 *
 * ── Чего намеренно нет ───────────────────────────────────────────────────────
 *
 * Секции внутри секций: вложенные таблицы в письме держатся на честном слове и
 * первыми разъезжаются в почтовом клиенте. Свободного расположения блоков тоже
 * нет — письмо это вертикальная лента, и попытка сделать из неё холст
 * презентации кончается вёрсткой, которую не переживёт ни один клиент.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Plus, Copy, Trash2, ChevronUp, ChevronDown, GripVertical,
  Monitor, Smartphone, Undo2, Redo2, AlertTriangle, Loader2,
  Columns3, Rows3, ZoomIn, ZoomOut, Paintbrush, Bookmark,
  MousePointerSquareDashed,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { email as emailApi } from '../../services/api';
import BlockView, { pad, bgStyle, cardStyle, OWNS_GRADIENT } from './BlockView';
import Inspector from './Inspector';
import {
  BLOCK_TYPES, PALETTE, SETTINGS_FIELDS, DECOR_FIELDS,
  SECTION_PRESETS, SECTION_FIELDS, COLUMN_FIELDS,
  DEFAULT_SETTINGS, createBlock, createSection, createDesign, cloneBlock,
  withIds, toV2, styleKeysOf, stripIds, mapAllBlocks, allBlocks,
} from './blocks';
import { ensureDocumentFonts } from './fonts';
import './EmailBuilder.css';

// ── Работа с документом ─────────────────────────────────────────────────────
//
// Документ неизменяем: каждая правка собирает новый объект. Это не догма ради
// догмы — на неизменяемости держится и отмена действий, и то, что React
// понимает, какую часть холста перерисовывать.

const setSections = (d, sections) => ({ ...d, sections });

const patchSection = (d, si, patch) => setSections(
  d,
  d.sections.map((x, i) => (i === si ? { ...x, ...patch } : x)),
);

const patchColumn = (d, si, ci, patch) => patchSection(d, si, {
  columns: d.sections[si].columns.map((c, i) => (i === ci ? { ...c, ...patch } : c)),
});

const setBlocks = (d, si, ci, blocks) => patchColumn(d, si, ci, { blocks });

const blocksAt = (d, si, ci) => d.sections?.[si]?.columns?.[ci]?.blocks || [];

/** Совпадает ли выделение. Сравнение по полям, а не по ссылке. */
const sameSel = (a, b) => Boolean(a && b)
  && a.kind === b.kind && a.si === b.si && a.ci === b.ci && a.bi === b.bi;

const colDropId = (si, ci) => `col-${si}-${ci}`;
const parseColDropId = (id) => {
  const [, si, ci] = id.split('-');
  return { si: Number(si), ci: Number(ci) };
};

export default function EmailBuilder({ value, onChange, subject = '', toolbarSlot = null }) {
  const design = useMemo(() => {
    const doc = value && typeof value === 'object' ? value : createDesign();
    // Порядок важен: сначала поднимаем документ до второй версии, потом
    // раздаём недостающие идентификаторы — в том числе новым секциям.
    const normalized = withIds(toV2(doc));
    return {
      ...normalized,
      settings: { ...DEFAULT_SETTINGS, ...(normalized.settings || {}) },
      sections: normalized.sections || [],
    };
  }, [value]);

  const [selected, setSelected] = useState(null);
  const [device, setDevice] = useState('desktop');
  /**
   * Масштаб холста.
   *
   * По умолчанию подбирается сам под ширину колонки: письмо держит свои
   * настоящие 600px (иначе строки переносятся не там, где у получателя), а в
   * узкую колонку не влезает. Горизонтальная прокрутка здесь хуже уменьшения —
   * при ней не видно письма целиком, а это главное, ради чего на холст смотрят.
   *
   * Как только человек нажал «крупнее» или «мельче», подбор выключается: он
   * сказал, какой масштаб хочет. Нажатие на сам процент возвращает автоподбор.
   */
  const [manualZoom, setManualZoom] = useState(null);
  const [fitZoom, setFitZoom] = useState(100);
  const canvasRef = useRef(null);
  const zoom = manualZoom ?? fitZoom;
  const [paletteTab, setPaletteTab] = useState('blocks');
  const [preview, setPreview] = useState({ html: '', warnings: [], loading: false });

  /**
   * Перенос оформления с блока на блок («формат по образцу»).
   *
   * Настроив однажды шрифт, цвета и отступы заголовка, человек не должен
   * повторять это в каждом следующем письме руками по восьми полям. Переносятся
   * только свойства из групп «Текст», «Оформление» и «Отступы» — содержимое
   * остаётся своим, иначе кнопки в письме превратились бы в копии одной.
   */
  /**
   * Выделение нескольких блоков — список идентификаторов, а не позиций.
   *
   * Позиции живут ровно до следующей правки: вставил секцию выше — и «блок 2 в
   * колонке 1» уже другой блок. Идентификатор же привязан к самому блоку и
   * переживает и перестановку, и переезд в другую колонку.
   */
  const [marked, setMarked] = useState([]);

  const [styleClip, setStyleClip] = useState(null);

  /**
   * Сохранённые модули: настроенные секции и блоки для переиспользования.
   *
   * Шапку с логотипом и подвал с контактами собирают один раз и вставляют в
   * каждое письмо. Без этого конструктор заставляет собирать их заново, и через
   * месяц в сети три разных «фирменных» подвала, отличающихся отступами.
   *
   * Модули общие: они лежат в базе и видны всем, у кого есть право на анонсы.
   */
  const [modules, setModules] = useState(null);

  const loadModules = useCallback(async () => {
    try {
      const { data } = await emailApi.getModules();
      setModules(data);
    } catch {
      setModules([]);
    }
  }, []);

  useEffect(() => { loadModules(); }, [loadModules]);

  const saveModule = async (kind, payload, defaultName) => {
    const name = window.prompt(kind === 'section' ? 'Название секции' : 'Название блока', defaultName || '');
    if (name === null) return;
    if (!name.trim()) return toast.error('Название обязательно');
    try {
      // Идентификаторы срезаем: у вставленной копии они должны быть свои,
      // иначе два экземпляра одного модуля в письме окажутся неразличимы.
      await emailApi.saveModule({ name: name.trim(), kind, payload: stripIds(payload) });
      toast.success('Модуль сохранён');
      loadModules();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить модуль');
    }
  };

  const insertModule = (module, at = design.sections.length) => {
    if (module.kind === 'section') {
      const section = withIds({ sections: [module.payload] }).sections[0];
      apply(setSections(design, [...design.sections.slice(0, at), section, ...design.sections.slice(at)]));
      setSelected({ kind: 'section', si: at });
      return;
    }
    // Блок кладём туда же, куда положило бы нажатие по палитре.
    const block = cloneBlock(module.payload);
    if (!design.sections.length) {
      const section = createSection([100]);
      apply(setSections(design, [{ ...section, columns: [{ ...section.columns[0], blocks: [block] }] }]));
      setSelected({ kind: 'block', si: 0, ci: 0, bi: 0 });
      return;
    }
    const target = selected?.kind === 'block'
      ? { si: selected.si, ci: selected.ci, bi: selected.bi + 1 }
      : { si: selected?.si ?? design.sections.length - 1, ci: selected?.ci ?? 0, bi: undefined };
    const list = blocksAt(design, target.si, target.ci);
    const index = target.bi ?? list.length;
    apply(setBlocks(design, target.si, target.ci, [...list.slice(0, index), block, ...list.slice(index)]));
    setSelected({ kind: 'block', si: target.si, ci: target.ci, bi: index });
  };

  // ── Несколько блоков сразу ────────────────────────────────────────────────

  const markedSet = useMemo(() => new Set(marked), [marked]);
  const isMarked = (block) => markedSet.has(block.id);

  /**
   * Клик по блоку с модификатором.
   *
   * Ctrl (Cmd) — добавить или убрать блок из выделения. Shift — выделить
   * подряд от уже выбранного до нажатого, но только внутри одной колонки:
   * «подряд» между колонками ничего не значит, блоки там не соседи.
   */
  const clickBlock = (sel, block, e) => {
    if (styleClip) { pasteStyle(sel.si, sel.ci, sel.bi); return; }

    if (e.metaKey || e.ctrlKey) {
      setMarked(prev => (prev.includes(block.id) ? prev.filter(id => id !== block.id) : [...prev, block.id]));
      setSelected(sel);
      return;
    }

    if (e.shiftKey && selected?.kind === 'block' && selected.si === sel.si && selected.ci === sel.ci) {
      const list = blocksAt(design, sel.si, sel.ci);
      const [from, to] = [selected.bi, sel.bi].sort((a, b) => a - b);
      setMarked(list.slice(from, to + 1).map(b => b.id));
      return;
    }

    setMarked([]);
    setSelected(sel);
  };

  const removeMarked = () => {
    const count = marked.length;
    apply(mapAllBlocks(design, list => list.filter(b => !markedSet.has(b.id))));
    setMarked([]);
    setSelected(null);
    toast.success(count === 1 ? 'Блок удалён' : `Удалено блоков: ${count}`);
  };

  const duplicateMarked = () => {
    // Копия встаёт сразу за оригиналом, а не в конец колонки: выделяли группу
    // подряд идущих блоков, значит и копия должна лечь такой же группой.
    apply(mapAllBlocks(design, list => list.flatMap(b => (markedSet.has(b.id) ? [b, cloneBlock(b)] : [b]))));
    setMarked([]);
  };

  const pasteStyleToMarked = () => {
    if (!styleClip) return;
    apply(mapAllBlocks(design, list => list.map((b) => {
      if (!markedSet.has(b.id)) return b;
      const allowed = new Set(styleKeysOf(b.type));
      const patch = {};
      Object.entries(styleClip.values).forEach(([k, v]) => { if (allowed.has(k)) patch[k] = v; });
      return Object.keys(patch).length ? { ...b, ...patch } : b;
    })));
    toast.success(`Оформление применено к ${marked.length} блокам`);
    setStyleClip(null);
    setMarked([]);
  };

  const removeModule = async (module) => {
    if (!window.confirm(`Удалить модуль «${module.name}»? Письма, где он уже вставлен, не изменятся.`)) return;
    try {
      await emailApi.deleteModule(module.id);
      loadModules();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось удалить модуль');
    }
  };

  const copyStyle = (block) => {
    const keys = styleKeysOf(block.type);
    const values = {};
    keys.forEach((k) => { if (block[k] !== undefined) values[k] = block[k]; });
    setStyleClip({ type: block.type, label: BLOCK_TYPES[block.type]?.label || block.type, values });
    toast.success('Оформление скопировано — нажмите на блок, чтобы применить');
  };

  const pasteStyle = (si, ci, bi) => {
    const target = blocksAt(design, si, ci)[bi];
    if (!target || !styleClip) return;

    // Переносим только те свойства, которые у блока-получателя вообще есть:
    // «поля по бокам» кнопки в абзаце текста означали бы совсем другое.
    const allowed = new Set(styleKeysOf(target.type));
    const patch = {};
    Object.entries(styleClip.values).forEach(([k, v]) => { if (allowed.has(k)) patch[k] = v; });

    if (!Object.keys(patch).length) {
      toast.error(`У блока «${BLOCK_TYPES[target.type]?.label}» нет общих настроек с «${styleClip.label}»`);
      return;
    }
    updateBlock(si, ci, bi, patch);
    toast.success('Оформление применено');
  };

  // История для отмены. В ref, а не в state: перерисовывать холст на каждое
  // сохранение прошлого состояния незачем, а глубина должна быть предсказуемой —
  // документ с картинками иначе съест память вкладки.
  const history = useRef({ past: [], future: [] });

  // Горячие клавиши вешаются один раз, а обработчики пересоздаются вместе с
  // документом. Через ref обработчик всегда зовёт свежую версию.
  const selectedRef = useRef(null);
  const markedRef = useRef([]);
  const actionsRef = useRef({});

  const apply = useCallback((next, { remember = true } = {}) => {
    if (remember) {
      history.current.past.push(design);
      if (history.current.past.length > 50) history.current.past.shift();
      history.current.future = [];
    }
    onChange(next);
  }, [design, onChange]);

  const undo = useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(design);
    onChange(prev);
    setSelected(null);
  }, [design, onChange]);

  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(design);
    onChange(next);
    setSelected(null);
  }, [design, onChange]);

  useEffect(() => { ensureDocumentFonts(design); }, [design]);

  // Ширина колонки меняется от размера окна и от того, свёрнута ли панель
  // свойств, поэтому следим наблюдателем, а не считаем один раз при открытии.
  useEffect(() => {
    const node = canvasRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;

    const letterWidth = design.settings.width || DEFAULT_SETTINGS.width;
    const recalc = () => {
      const styles = getComputedStyle(node);
      const inner = node.clientWidth
        - parseFloat(styles.paddingLeft || 0)
        - parseFloat(styles.paddingRight || 0);
      if (inner <= 0) return;
      // Ниже 40% читать письмо всё равно нельзя — там уже прокрутка честнее.
      setFitZoom(Math.max(40, Math.min(100, Math.floor((inner / letterWidth) * 100))));
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(node);
    return () => observer.disconnect();
  }, [design.settings.width]);

  // ── Секции ────────────────────────────────────────────────────────────────

  const addSection = (widths, at = design.sections.length) => {
    const section = createSection(widths);
    const next = [...design.sections.slice(0, at), section, ...design.sections.slice(at)];
    apply(setSections(design, next));
    setSelected({ kind: 'section', si: at });
  };

  const removeSection = (si) => {
    apply(setSections(design, design.sections.filter((_, i) => i !== si)));
    setSelected(null);
  };

  const duplicateSection = (si) => {
    const copy = JSON.parse(JSON.stringify(design.sections[si]));
    const fresh = withIds({
      sections: [{ ...copy, id: undefined, columns: copy.columns.map(c => ({ ...c, id: undefined, blocks: c.blocks.map(cloneBlock) })) }],
    }).sections[0];
    apply(setSections(design, [...design.sections.slice(0, si + 1), fresh, ...design.sections.slice(si + 1)]));
    setSelected({ kind: 'section', si: si + 1 });
  };

  const moveSection = (si, delta) => {
    const to = si + delta;
    if (to < 0 || to >= design.sections.length) return;
    const next = [...design.sections];
    [next[si], next[to]] = [next[to], next[si]];
    apply(setSections(design, next));
    setSelected({ kind: 'section', si: to });
  };

  // ── Блоки ─────────────────────────────────────────────────────────────────

  const addBlock = (type, si, ci, at) => {
    const block = createBlock(type);
    if (!block) return;
    // В секции из нескольких колонок боковые поля блока не нужны: их уже дала
    // сама секция, а внутри колонки в 268px ещё 48px полей съедают пятую часть
    // строки. Заготовки колонок так и сделаны — блоки, добавленные руками,
    // должны вставать так же, иначе колонка с текстом и колонка с картинкой
    // начинаются с разных отступов.
    const narrow = (design.sections[si]?.columns?.length || 1) > 1;
    if (narrow && block.padding) block.padding = { ...block.padding, left: 0, right: 0 };
    const list = blocksAt(design, si, ci);
    const index = at ?? list.length;
    apply(setBlocks(design, si, ci, [...list.slice(0, index), block, ...list.slice(index)]));
    setSelected({ kind: 'block', si, ci, bi: index });
  };

  /**
   * Куда встанет блок, добавленный нажатием (а не перетаскиванием).
   *
   * Под выделенным блоком, если выделен блок; в конец выделенной секции, если
   * выделена секция; иначе в конец письма. Человек нажимает на блок в палитре,
   * глядя на то место, куда он должен попасть, — и попадать должен туда.
   */
  const addBlockSmart = (type) => {
    if (!design.sections.length) {
      const section = createSection([100]);
      const block = createBlock(type);
      apply(setSections(design, [{ ...section, columns: [{ ...section.columns[0], blocks: [block] }] }]));
      setSelected({ kind: 'block', si: 0, ci: 0, bi: 0 });
      return;
    }
    if (selected?.kind === 'block') return addBlock(type, selected.si, selected.ci, selected.bi + 1);
    if (selected?.kind === 'column') return addBlock(type, selected.si, selected.ci);
    if (selected?.kind === 'section') return addBlock(type, selected.si, 0);
    const si = design.sections.length - 1;
    return addBlock(type, si, 0);
  };

  const updateBlock = (si, ci, bi, patch) => {
    const list = blocksAt(design, si, ci);
    const next = list.map((b, i) => (i === bi ? { ...b, ...patch } : b));
    // Правка текста идёт посимвольно — складывать каждый символ в историю
    // бессмысленно: отмена должна откатывать действие, а не букву.
    apply(setBlocks(design, si, ci, next), { remember: !('html' in patch) });
  };

  const removeBlock = (sel) => {
    const list = blocksAt(design, sel.si, sel.ci);
    apply(setBlocks(design, sel.si, sel.ci, list.filter((_, i) => i !== sel.bi)));
    setSelected(null);
  };

  const duplicateBlock = (sel) => {
    const list = blocksAt(design, sel.si, sel.ci);
    const copy = cloneBlock(list[sel.bi]);
    apply(setBlocks(design, sel.si, sel.ci, [...list.slice(0, sel.bi + 1), copy, ...list.slice(sel.bi + 1)]));
    setSelected({ ...sel, bi: sel.bi + 1 });
  };

  const moveBlock = (sel, delta) => {
    const list = blocksAt(design, sel.si, sel.ci);
    const to = sel.bi + delta;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    [next[sel.bi], next[to]] = [next[to], next[sel.bi]];
    apply(setBlocks(design, sel.si, sel.ci, next));
    setSelected({ ...sel, bi: to });
  };

  selectedRef.current = selected;
  markedRef.current = marked;
  actionsRef.current = { removeBlock, duplicateBlock, removeSection, duplicateSection, removeMarked, duplicateMarked };

  // ── Перетаскивание ────────────────────────────────────────────────────────

  const onDragEnd = ({ source, destination, draggableId, type }) => {
    if (!destination) return;

    if (type === 'section') {
      if (source.droppableId === 'palette-sections') {
        const preset = SECTION_PRESETS.find(p => `new-sec-${p.id}` === draggableId);
        if (preset) addSection(preset.widths, destination.index);
        return;
      }
      if (source.index === destination.index) return;
      const next = [...design.sections];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      apply(setSections(design, next));
      setSelected({ kind: 'section', si: destination.index });
      return;
    }

    // Блок: либо новый из палитры, либо переезд между колонками.
    const to = parseColDropId(destination.droppableId);
    if (Number.isNaN(to.si)) return;

    if (source.droppableId === 'palette-blocks') {
      const blockType = String(draggableId).replace(/^new-/, '');
      if (BLOCK_TYPES[blockType]) addBlock(blockType, to.si, to.ci, destination.index);
      return;
    }

    const from = parseColDropId(source.droppableId);
    if (Number.isNaN(from.si)) return;

    // Тащат блок из выделенной группы — переезжает вся группа. Библиотека
    // перетаскивания анимирует только один блок, и это её предел; результат же
    // должен соответствовать тому, что человек выделил.
    const draggedId = blocksAt(design, from.si, from.ci)[source.index]?.id;
    if (marked.length > 1 && markedSet.has(draggedId)) {
      const group = allBlocks(design).filter(x => markedSet.has(x.block.id)).map(x => x.block);
      const without = mapAllBlocks(design, list => list.filter(b => !markedSet.has(b.id)));
      const target = blocksAt(without, to.si, to.ci);
      // Место вставки считается по списку УЖЕ без переезжающих блоков: иначе
      // при движении внутри одной колонки группа уезжает мимо на свою длину.
      const at = Math.min(destination.index, target.length);
      apply(setBlocks(without, to.si, to.ci, [...target.slice(0, at), ...group, ...target.slice(at)]));
      setSelected({ kind: 'block', si: to.si, ci: to.ci, bi: at });
      return;
    }

    if (from.si === to.si && from.ci === to.ci && source.index === destination.index) return;

    // Два шага через промежуточный документ: сначала вынуть, потом вставить.
    // Одним выражением нельзя — после удаления индексы в целевом списке
    // смещаются, если это тот же самый список.
    const moved = blocksAt(design, from.si, from.ci)[source.index];
    const afterRemove = setBlocks(
      design, from.si, from.ci,
      blocksAt(design, from.si, from.ci).filter((_, i) => i !== source.index),
    );
    const target = blocksAt(afterRemove, to.si, to.ci);
    apply(setBlocks(
      afterRemove, to.si, to.ci,
      [...target.slice(0, destination.index), moved, ...target.slice(destination.index)],
    ));
    setSelected({ kind: 'block', si: to.si, ci: to.ci, bi: destination.index });
  };

  // ── Горячие клавиши ───────────────────────────────────────────────────────

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      if (!el) return false;
      return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { setStyleClip(null); setMarked([]); setSelected(null); return; }
      const sel = selectedRef.current;
      const group = markedRef.current;

      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); return; }
        if (e.key === 'd') {
          // Выделенная группа важнее одиночного блока: она появилась позже и
          // именно её человек видит подсвеченной.
          if (group.length > 1) { e.preventDefault(); actionsRef.current.duplicateMarked(); return; }
          if (sel) {
            e.preventDefault();
            if (sel.kind === 'block') actionsRef.current.duplicateBlock(sel);
            if (sel.kind === 'section') actionsRef.current.duplicateSection(sel.si);
          }
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing()) {
        if (group.length > 1) { e.preventDefault(); actionsRef.current.removeMarked(); return; }
        if (!sel) return;
        e.preventDefault();
        if (sel.kind === 'block') actionsRef.current.removeBlock(sel);
        if (sel.kind === 'section') actionsRef.current.removeSection(sel.si);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Свойства ──────────────────────────────────────────────────────────────

  const updateSetting = (key, val) => apply({ ...design, settings: { ...design.settings, [key]: val } });

  const updateSelectedField = (key, val) => {
    const sel = selected;
    if (!sel) return;

    if (sel.kind === 'section') {
      const section = design.sections[sel.si];

      if (key === 'columnCount') {
        const count = Number(val);
        const current = section.columns || [];
        const width = Math.round(100 / count);

        // Содержимое лишних колонок не пропадает, а переезжает в последнюю
        // оставшуюся. Молча удалить набранный текст при смене раскладки —
        // худшее, что может сделать конструктор.
        const columns = Array.from({ length: count }, (_, i) => ({
          ...(current[i] || {}),
          id: current[i]?.id,
          width,
          blocks: current[i]?.blocks || [],
        }));
        if (current.length > count) {
          const tail = current.slice(count).flatMap(c => c.blocks || []);
          columns[count - 1] = { ...columns[count - 1], blocks: [...columns[count - 1].blocks, ...tail] };
          if (tail.length) toast(`Блоки из лишних колонок (${tail.length}) переехали в последнюю`);
        }
        apply(withIds(patchSection(design, sel.si, { columns, gap: count > 1 ? (section.gap ?? 16) : 0 })));
        return;
      }

      if (key === 'columnWidths') {
        const { index, width } = val;
        apply(patchSection(design, sel.si, {
          columns: section.columns.map((c, i) => (i === index ? { ...c, width } : c)),
        }));
        return;
      }
      apply(patchSection(design, sel.si, { [key]: val }));
      return;
    }

    if (sel.kind === 'column') {
      apply(patchColumn(design, sel.si, sel.ci, { [key]: val }));
      return;
    }

    updateBlock(sel.si, sel.ci, sel.bi, { [key]: val });
  };

  // ── Предпросмотр ──────────────────────────────────────────────────────────
  //
  // Собирается на сервере той же функцией, что и отправка. Задержка — не ради
  // экономии запросов, а чтобы письмо не дёргалось на каждой букве.

  useEffect(() => {
    let cancelled = false;
    setPreview(p => ({ ...p, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const { data } = await emailApi.preview({ design, subject });
        if (!cancelled) setPreview({ html: data.html, warnings: data.warnings || [], loading: false, bytes: data.bytes });
      } catch (error) {
        if (!cancelled) {
          setPreview(p => ({ ...p, loading: false }));
          toast.error(error.response?.data?.error || 'Не удалось собрать предпросмотр');
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [design, subject]);

  // ── Отрисовка ─────────────────────────────────────────────────────────────

  const s = design.settings;

  const inspector = (() => {
    if (selected?.kind === 'section') {
      const section = design.sections[selected.si];
      if (!section) return null;
      return (
        <Inspector
          title={`Секция ${selected.si + 1}`}
          fields={SECTION_FIELDS}
          values={section}
          block={section}
          onChange={updateSelectedField}
        />
      );
    }
    if (selected?.kind === 'column') {
      const col = design.sections[selected.si]?.columns?.[selected.ci];
      if (!col) return null;
      return (
        <Inspector
          title={`Колонка ${selected.ci + 1}`}
          fields={COLUMN_FIELDS}
          values={col}
          block={col}
          onChange={updateSelectedField}
        />
      );
    }
    if (selected?.kind === 'block') {
      const block = blocksAt(design, selected.si, selected.ci)[selected.bi];
      const def = block && BLOCK_TYPES[block.type];
      if (!def) return null;
      return (
        <Inspector
          title={def.label}
          fields={def.fields.concat(DECOR_FIELDS)}
          values={block}
          block={block}
          onChange={updateSelectedField}
        />
      );
    }
    return (
      <>
        <Inspector title="Письмо целиком" fields={SETTINGS_FIELDS} values={s} onChange={updateSetting} />
      </>
    );
  })();

  const renderBlock = (block, si, ci, bi, dragHandle) => {
    const sel = { kind: 'block', si, ci, bi };
    const isSelected = sameSel(selected, sel);
    const def = BLOCK_TYPES[block.type];
    return (
      <div
        className={`eb-block ${isSelected ? 'selected' : ''} ${isMarked(block) ? 'marked' : ''}`}
        style={{ padding: pad(block), ...bgStyle(OWNS_GRADIENT.has(block.type) ? { background: block.background } : block) }}
        onMouseDown={(e) => { e.stopPropagation(); clickBlock(sel, block, e); }}
      >
        <div className="eb-block-bar">
          <span className="eb-block-name">{def?.label || block.type}</span>
          <span className="eb-block-actions">
            <button type="button" onClick={(e) => { e.stopPropagation(); moveBlock(sel, -1); }} title="Выше"><ChevronUp size={13} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); moveBlock(sel, 1); }} title="Ниже"><ChevronDown size={13} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); copyStyle(block); }} title="Перенести оформление на другой блок"><Paintbrush size={13} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); saveModule('block', block, def?.label); }} title="Сохранить как модуль"><Bookmark size={13} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); duplicateBlock(sel); }} title="Копия"><Copy size={13} /></button>
            <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); removeBlock(sel); }} title="Удалить"><Trash2 size={13} /></button>
            {dragHandle}
          </span>
        </div>
        <div style={cardStyle(block.card) || undefined}>
          <BlockView
            block={block}
            settings={s}
            selected={isSelected}
            onChange={(patch) => updateBlock(si, ci, bi, patch)}
          />
        </div>
      </div>
    );
  };

  const renderSection = (section, si, dragHandle) => {
    const isSelected = sameSel(selected, { kind: 'section', si });
    const cols = section.columns || [];
    const gap = Number(section.gap) || 0;
    const weights = cols.map(c => Math.max(1, Number(c.width) || 1));
    const sum = weights.reduce((a, b) => a + b, 0);

    const band = bgStyle(section);
    const inner = bgStyle({
      background: section.innerBackground ?? s.cardBg,
      gradient: section.innerGradient,
    });

    return (
      <div
        className={`eb-band ${isSelected ? 'selected' : ''}`}
        style={band}
        onMouseDown={(e) => { e.stopPropagation(); setSelected({ kind: 'section', si }); }}
      >
        <div className="eb-band-bar">
          <span className="eb-block-name">Секция {si + 1}</span>
          <span className="eb-block-actions">
            <button type="button" onClick={(e) => { e.stopPropagation(); moveSection(si, -1); }} title="Выше"><ChevronUp size={13} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); moveSection(si, 1); }} title="Ниже"><ChevronDown size={13} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); duplicateSection(si); }} title="Копия"><Copy size={13} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); saveModule('section', section, `Секция ${si + 1}`); }} title="Сохранить как модуль"><Bookmark size={13} /></button>
            <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); removeSection(si); }} title="Удалить"><Trash2 size={13} /></button>
            {dragHandle}
          </span>
        </div>

        <div
          className="eb-band-inner"
          style={{
            width: s.width,
            padding: pad({ padding: section.padding || { top: 0, right: 0, bottom: 0, left: 0 } }),
            ...inner,
          }}
        >
          <div className="eb-cols" style={{ gap, alignItems: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[section.valign] || 'flex-start' }}>
            {cols.map((col, ci) => {
              const colSel = { kind: 'column', si, ci };
              return (
                <div
                  key={col.id || ci}
                  className={`eb-col ${sameSel(selected, colSel) ? 'selected' : ''}`}
                  style={{
                    flex: `0 0 calc(${(weights[ci] / sum) * 100}% - ${(gap * (cols.length - 1)) / cols.length}px)`,
                    ...bgStyle(col),
                    padding: col.padding ? pad({ padding: col.padding }) : undefined,
                  }}
                  onMouseDown={(e) => { e.stopPropagation(); setSelected(colSel); }}
                >
                  <Droppable droppableId={colDropId(si, ci)} type="block">
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`eb-col-drop ${snapshot.isDraggingOver ? 'over' : ''}`}
                      >
                        {(col.blocks || []).map((block, bi) => (
                          <Draggable key={block.id || bi} draggableId={block.id || `b-${si}-${ci}-${bi}`} index={bi}>
                            {(dp) => (
                              <div ref={dp.innerRef} {...dp.draggableProps}>
                                {renderBlock(block, si, ci, bi, (
                                  <span className="eb-grip" {...dp.dragHandleProps} title="Перетащить"><GripVertical size={13} /></span>
                                ))}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {!(col.blocks || []).length && !snapshot.isDraggingOver && (
                          <div className="eb-col-empty" />
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const canvas = (
    <div
      ref={canvasRef}
      className={`eb-canvas-wrap ${styleClip ? 'picking' : ''}`}
      onMouseDown={() => { setSelected(null); setMarked([]); }}
    >
      <div className="eb-canvas" style={{ background: s.bodyBg }}>
        {/* Минимум по ширине — ширина письма из настроек, а не зашитые 600:
            письмо можно сделать уже или шире, и холст обязан следовать за ним,
            иначе снова начнёт врать про переносы строк. */}
        <div className="eb-doc" style={{ zoom: `${zoom}%`, minWidth: s.width }}>
          <Droppable droppableId="sections" type="section">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {design.sections.map((section, si) => (
                  <Draggable key={section.id || si} draggableId={section.id || `sec-${si}`} index={si}>
                    {(dp) => (
                      <div ref={dp.innerRef} {...dp.draggableProps}>
                        {/*
                          Тонкая полоска с «плюсом» перед каждой секцией.
                          Перетаскивание точнее, но ради одной секции посередине
                          письма тянуть её через весь холст — лишняя работа.
                          Добавляется секция в одну колонку: число колонок потом
                          меняется в её свойствах.
                        */}
                        <button
                          type="button"
                          className="eb-insert"
                          title="Вставить секцию здесь"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => addSection([100], si)}
                        >
                          <Plus size={13} />
                        </button>
                        {renderSection(section, si, (
                          <span className="eb-grip" {...dp.dragHandleProps} title="Перетащить секцию"><GripVertical size={13} /></span>
                        ))}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
                {design.sections.length > 0 && (
                  <button
                    type="button"
                    className="eb-insert"
                    title="Добавить секцию в конец"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => addSection([100])}
                  >
                    <Plus size={13} />
                  </button>
                )}
                {!design.sections.length && <div className="eb-empty" />}
              </div>
            )}
          </Droppable>

        </div>
      </div>
    </div>
  );

  const previewPane = (
    <div className="eb-preview split">
      <div className={`eb-preview-frame ${device}`}>
        {preview.loading && <div className="eb-preview-loading"><Loader2 size={18} className="eb-spin" /> Собираем письмо…</div>}
        <iframe title="Предпросмотр письма" srcDoc={preview.html} sandbox="" />
      </div>
    </div>
  );

  /*
    Собственной строки инструментов у конструктора больше нет: его кнопки
    уезжают порталом в общую панель окна составления. Две полосы инструментов
    одна под другой — холста и письма — съедали высоту и заставляли искать
    нужное в двух местах.

    Портал, а не подъём состояния наверх: масштаб, отмена и ширина предпросмотра
    принадлежат конструктору, и вынести их в родителя значило бы отдать ему
    половину его внутренностей. Тот же приём, что у инструментов модуля
    «Маркетинг» (pages/Marketing/toolsSlot.js).
  */
  const toolbar = (
    <>
      <div className="eb-zoom">
        <button type="button" className="eb-icon-btn" onClick={() => setManualZoom(Math.max(40, zoom - 10))} title="Мельче"><ZoomOut size={14} /></button>
        <b
          className={manualZoom === null ? 'auto' : ''}
          onClick={() => setManualZoom(null)}
          title={manualZoom === null ? 'Масштаб подобран по ширине' : 'Вернуть подбор по ширине'}
        >
          {zoom}%
        </b>
        <button type="button" className="eb-icon-btn" onClick={() => setManualZoom(Math.min(200, zoom + 10))} title="Крупнее"><ZoomIn size={14} /></button>
      </div>
      <button type="button" className="eb-icon-btn" onClick={undo} title="Отменить (Ctrl+Z)"><Undo2 size={15} /></button>
      <button type="button" className="eb-icon-btn" onClick={redo} title="Вернуть (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
      <div className="eb-segmented">
        <button type="button" className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')} title="Письмо на компьютере"><Monitor size={14} /></button>
        <button type="button" className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')} title="Письмо на телефоне"><Smartphone size={14} /></button>
      </div>
      {preview.warnings.length > 0 && (
        <button
          type="button"
          className="eb-btn eb-btn-slim warn"
          title={preview.warnings.join('\n')}
          onClick={() => toast(preview.warnings.join('\n'), { duration: 8000, icon: '⚠️' })}
        >
          <AlertTriangle size={14} /> {preview.warnings.length}
        </button>
      )}
    </>
  );

  return (
    <div className="eb">
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : null}

      {marked.length > 1 && (
        <div className="eb-clip-bar marked">
          <MousePointerSquareDashed size={14} />
          <span>{marked.length}</span>
          {styleClip && (
            <button type="button" className="eb-btn eb-btn-slim" onClick={pasteStyleToMarked}>
              <Paintbrush size={13} /> Применить оформление
            </button>
          )}
          <button type="button" className="eb-btn eb-btn-slim" onClick={duplicateMarked}><Copy size={13} /> Дублировать</button>
          <button type="button" className="eb-btn eb-btn-slim danger" onClick={removeMarked}><Trash2 size={13} /> Удалить</button>
          <button type="button" className="eb-btn eb-btn-slim" onClick={() => setMarked([])}>Esc</button>
        </div>
      )}

      {styleClip && (
        <div className="eb-clip-bar">
          <Paintbrush size={14} />
          <span>{styleClip.label}</span>
          <button type="button" className="eb-btn eb-btn-slim" onClick={() => setStyleClip(null)}>Esc</button>
        </div>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
          <div className="eb-body split">
            <aside className="eb-palette">
              <div className="eb-palette-tabs">
                <button type="button" className={paletteTab === 'sections' ? 'active' : ''} onClick={() => setPaletteTab('sections')}>
                  {/* «Секции», а не «Структуры»: короче — помещается в колонку —
                      и точнее, потому что создаёт именно секции документа. */}
                  <Rows3 size={13} /> Секции
                </button>
                <button type="button" className={paletteTab === 'blocks' ? 'active' : ''} onClick={() => setPaletteTab('blocks')}>
                  <Columns3 size={13} /> Блоки
                </button>
                <button type="button" className={paletteTab === 'modules' ? 'active' : ''} onClick={() => setPaletteTab('modules')}>
                  {/* Счётчик убран: в колонке 200px три вкладки и так впритык,
                      а число модулей видно сразу, как только вкладка открыта. */}
                  <Bookmark size={13} /> Мои
                </button>
              </div>

              {/*
                Две палитры и два вида перетаскивания. Структура едет в письмо
                между секциями, блок — внутрь колонки; разделены они типом
                (section / block), поэтому перепутать места назначения нельзя
                даже случайно.
              */}
              <div hidden={paletteTab !== 'sections'}>
                <Droppable droppableId="palette-sections" type="section" isDropDisabled>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                      {SECTION_PRESETS.map((preset, i) => (
                        <Draggable key={preset.id} draggableId={`new-sec-${preset.id}`} index={i}>
                          {(dp, snapshot) => (
                            <>
                              <button
                                type="button"
                                className={`eb-structure ${snapshot.isDragging ? 'dragging' : ''}`}
                                ref={dp.innerRef}
                                {...dp.draggableProps}
                                {...dp.dragHandleProps}
                                onClick={() => addSection(preset.widths)}
                              >
                                <span className="eb-structure-preview">
                                  {preset.widths.map((w, k) => <i key={k} style={{ flex: w }} />)}
                                </span>
                                <small>{preset.label}</small>
                              </button>
                              {snapshot.isDragging && (
                                <div className="eb-structure ghost">
                                  <span className="eb-structure-preview">
                                    {preset.widths.map((w, k) => <i key={k} style={{ flex: w }} />)}
                                  </span>
                                  <small>{preset.label}</small>
                                </div>
                              )}
                            </>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>

              <div hidden={paletteTab !== 'blocks'}>
                <Droppable droppableId="palette-blocks" type="block" isDropDisabled>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                      {PALETTE.map((type, i) => {
                        const def = BLOCK_TYPES[type];
                        const Icon = def.icon;
                        return (
                          <Draggable key={type} draggableId={`new-${type}`} index={i}>
                            {(dp, snapshot) => (
                              <>
                                <button
                                  type="button"
                                  className={`eb-palette-item ${snapshot.isDragging ? 'dragging' : ''}`}
                                  ref={dp.innerRef}
                                  {...dp.draggableProps}
                                  {...dp.dragHandleProps}
                                  onClick={() => addBlockSmart(type)}
                                >
                                  <Icon size={16} />
                                  <span><b>{def.label}</b></span>
                                  <Plus size={14} />
                                </button>
                                {snapshot.isDragging && (
                                  <div className="eb-palette-item ghost">
                                    <Icon size={16} />
                                    <span><b>{def.label}</b></span>
                                  </div>
                                )}
                              </>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

              </div>

              {/*
                Модули не перетаскиваются, а вставляются нажатием. Перетаскивание
                здесь потребовало бы третьего типа, который был бы то секцией, то
                блоком в зависимости от записи в базе, — а рассказать библиотеке
                перетаскивания об этом на лету нельзя. Вставка нажатием кладёт
                модуль туда же, куда его положила бы палитра блоков.
              */}
              <div hidden={paletteTab !== 'modules'}>
                {modules === null && <div className="eb-loading-dots" />}
                {modules?.map((module) => (
                  <div key={module.id} className="eb-module">
                    <button type="button" className="eb-module-main" onClick={() => insertModule(module)}>
                      <span className={`eb-module-kind ${module.kind}`}>{module.kind === 'section' ? 'секция' : 'блок'}</span>
                      <b>{module.name}</b>
                      <small>{module.author?.displayName || module.author?.username || ''}</small>
                    </button>
                    <button type="button" className="eb-icon-btn" title="Удалить модуль" onClick={() => removeModule(module)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </aside>

            {canvas}
            {previewPane}

            <aside className="eb-panel">{inspector}</aside>
          </div>
      </DragDropContext>
    </div>
  );
}
