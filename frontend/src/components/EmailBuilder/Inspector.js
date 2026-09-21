/**
 * Панель свойств конструктора писем (ver. 8.43).
 *
 * Полей здесь нет — есть типы полей. Что показать для конкретного блока,
 * описано в blocks.js, а этот файл умеет отрисовать описание. Благодаря этому
 * новый блок не тянет за собой новую панель: хватает записи в описании.
 *
 * Когда не выбран ни один блок, показываются настройки письма целиком. Панель
 * не пустует никогда — пустая панель справа читается как «здесь ничего нет»,
 * хотя общие настройки нужны как раз чаще всего.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker from 'emoji-picker-react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Upload, Trash2, Link2, Loader2, Plus, ChevronUp, ChevronDown, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { email } from '../../services/api';
import { previewSrc, gradientCss } from './BlockView';
import { FONTS, SAFE_FONT_KEYS, WEB_FONT_KEYS, fontStack, ensureWebFont } from './fonts';
import { GROUPS, groupOfField } from './blocks';
import { EMAIL_ICONS, ICON_GROUPS, ICON_BY_KEY } from './icons';

// Четвёртый вариант — «по ширине». В письме он есть только у текста: атрибут
// align на ячейке justify не принимает, и рендерер отдаёт туда обычное «влево».
const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };

/**
 * Поле цвета.
 *
 * Рядом с палитрой стоит текстовое поле: маркетологу чаще нужно вбить цвет из
 * фирменного стиля кодом, чем искать его пипеткой. Кнопка сброса есть не у
 * всех цветов — там, где сброс означает «как в письме», это полезно, а там, где
 * цвет обязателен, пустое значение нарисовало бы блок прозрачным.
 */
function ColorField({ value, onChange, clearable }) {
  const current = value || '';
  return (
    <div className="eb-color">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#000000'}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className="eb-input"
        value={current}
        placeholder={clearable ? 'как в письме' : '#000000'}
        onChange={(e) => onChange(e.target.value)}
      />
      {clearable && current && (
        <button type="button" className="eb-icon-btn" onClick={() => onChange(undefined)} title="Сбросить">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Загрузка картинки.
 *
 * В документе хранится относительный путь (`/uploads/…`), а не полный адрес:
 * так письмо переживает смену домена портала, а превратить путь в адрес — дело
 * одной строки в рендерере. Поэтому здесь берётся именно `data.url`, каким его
 * отдал загрузчик, без BASE_URL.
 *
 * Вес показывается сразу и не случайно. Картинка в письме — это то, что
 * получатель качает по мобильному интернету, и узнать про лишние пять мегабайт
 * лучше при загрузке, чем из жалоб на то, что письмо «долго открывается».
 */
function ImageField({ value, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Это не картинка');
    setBusy(true);
    try {
      const { data } = await email.uploadImage(file);
      onChange(data.url);
      setInfo(data);
      toast.success(`Картинка загружена${data.shrunk ? `, ужата до ${data.width}px` : ''} · ${Math.round(data.bytes / 1024)} КБ`);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить картинку');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eb-image-field">
      {value ? (
        <div className="eb-image-thumb">
          <img src={previewSrc(value)} alt="" />
          <button type="button" className="eb-icon-btn" onClick={() => onChange('')} title="Убрать"><Trash2 size={13} /></button>
        </div>
      ) : null}
      <button type="button" className="eb-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 size={14} className="eb-spin" /> : <Upload size={14} />}
        {value ? 'Заменить' : 'Загрузить'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }}
      />
      <input
        className="eb-input"
        value={value || ''}
        placeholder="или вставьте адрес картинки"
        onChange={(e) => onChange(e.target.value)}
      />
      {/* Вес и ширина ушли в уведомление при загрузке: в панели это был ещё
          один абзац текста, а узнать их нужно один раз. */}
    </div>
  );
}

/** Отступы блока. Четыре числа, потому что в письме они живут на ячейке. */
function PaddingField({ value, onChange }) {
  const v = value || {};
  const set = (side) => (e) => {
    const n = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0);
    onChange({ ...v, [side]: n });
  };
  return (
    <div className="eb-padding">
      {[['top', 'сверху'], ['right', 'справа'], ['bottom', 'снизу'], ['left', 'слева']].map(([side, label]) => (
        <label key={side}>
          <input type="number" className="eb-input" value={v[side] ?? ''} onChange={set(side)} min={0} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Повторяющиеся поля: услуги, ссылки на соцсети.
 *
 * Список правится целиком, а не поэлементно: наружу уходит новый массив, и
 * документ письма остаётся таким же неизменяемым, как везде в конструкторе.
 * Возня с индексами живёт здесь и не расползается по блокам.
 */
function ListField({ field, value, onChange }) {
  const items = Array.isArray(value) ? value : [];

  const patch = (i, key, v) => onChange(items.map((item, idx) => (idx === i ? { ...item, [key]: v } : item)));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const move = (i, delta) => {
    const to = i + delta;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };

  return (
    <div className="eb-list">
      {items.map((item, i) => (
        <div className="eb-list-item" key={i}>
          <div className="eb-list-head">
            <b>{String(item?.[field.titleKey] || '').trim() || `№ ${i + 1}`}</b>
            <span>
              <button type="button" className="eb-icon-btn" onClick={() => move(i, -1)} title="Выше"><ChevronUp size={12} /></button>
              <button type="button" className="eb-icon-btn" onClick={() => move(i, 1)} title="Ниже"><ChevronDown size={12} /></button>
              <button type="button" className="eb-icon-btn" onClick={() => remove(i)} title="Убрать"><Trash2 size={12} /></button>
            </span>
          </div>
          {field.itemFields.map((sub) => (
            <div className="eb-field" key={sub.key}>
              <label className="eb-field-label">{sub.label}</label>
              <Field field={sub} value={item?.[sub.key]} onChange={(v) => patch(i, sub.key, v)} />
            </div>
          ))}
        </div>
      ))}
      <button type="button" className="eb-btn" onClick={() => onChange([...items, field.newItem()])}>
        <Plus size={14} /> {field.addLabel || 'Добавить'}
      </button>
    </div>
  );
}

/**
 * Метки перехода.
 *
 * Три поля вместо одного текстового: собранная руками строка
 * «?utm_source=...&utm_medium=...» рано или поздно приезжает с лишним знаком
 * вопроса или потерянным амперсандом, и ломается вся аналитика рассылки, о чём
 * узнают через месяц.
 */
function UtmField({ value, onChange }) {
  const v = value || {};
  const set = (key) => (e) => {
    const next = { ...v, [key]: e.target.value };
    // Пустая тройка полей — это «меток нет», а не «метки пустые»: иначе
    // рендерер честно повесил бы на ссылки хвост из ничего.
    const filled = ['source', 'medium', 'campaign'].some(k => String(next[k] || '').trim());
    onChange(filled ? next : null);
  };
  return (
    <div className="eb-utm">
      {[['source', 'источник (utm_source)', 'email'], ['medium', 'канал (utm_medium)', 'newsletter'], ['campaign', 'кампания (utm_campaign)', 'akcia-sentyabr']].map(([key, label, ph]) => (
        <label key={key}>
          <input className="eb-input" value={v[key] || ''} placeholder={ph} onChange={set(key)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Заготовки градиентов.
 *
 * Нужны не для красоты списка: собрать приятный градиент из трёх точек с
 * прозрачностью — отдельное умение, и маркетолог, которому нужно письмо к
 * понедельнику, этим заниматься не станет. С заготовки начинают и правят под
 * себя, а не смотрят на два чёрных квадрата и закрывают панель.
 */
const GRADIENT_PRESETS = [
  { name: 'Фирменный', value: { type: 'linear', angle: 135, stops: [{ color: '#007AFF', at: 0 }, { color: '#5856D6', at: 100 }] } },
  { name: 'Рассвет', value: { type: 'linear', angle: 135, stops: [{ color: '#FF3B30', at: 0 }, { color: '#FF9500', at: 50 }, { color: '#FFCC00', at: 100 }] } },
  { name: 'Мята', value: { type: 'linear', angle: 135, stops: [{ color: '#34C759', at: 0 }, { color: '#30D5C8', at: 100 }] } },
  { name: 'Сумерки', value: { type: 'linear', angle: 160, stops: [{ color: '#1C1C1E', at: 0 }, { color: '#3A3A5C', at: 60 }, { color: '#5856D6', at: 100 }] } },
  { name: 'Мягкий свет', value: { type: 'radial', shape: 'ellipse', position: 'top', stops: [{ color: '#FFFFFF', at: 0 }, { color: '#F2F2F7', at: 100 }] } },
  { name: 'Растворение', value: { type: 'linear', angle: 90, stops: [{ color: '#007AFF', at: 0, alpha: 0 }, { color: '#007AFF', at: 50 }, { color: '#007AFF', at: 100, alpha: 0 }] } },
];

const GRADIENT_TYPES = [['linear', 'Линейный'], ['radial', 'Радиальный'], ['conic', 'Конический']];
const GRADIENT_POSITIONS = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'];

/**
 * Редактор градиента.
 *
 * Точек может быть сколько угодно, у каждой свой цвет, прозрачность и
 * положение. Порядок точек в списке значения не имеет — и рендерер, и холст
 * сортируют их по положению: человек двигает ползунки, а не следит за
 * очерёдностью в массиве.
 *
 * Выключен — это null, а не объект с пустыми полями. Градиент «из ничего в
 * ничто» рендерер честно навесил бы на блок, и получилась бы прозрачная дыра.
 */
function GradientField({ value, onChange }) {
  const g = value || null;
  const on = Boolean(g);
  const stops = Array.isArray(g?.stops) && g.stops.length >= 2
    ? g.stops
    : (g?.from && g?.to ? [{ color: g.from, at: 0 }, { color: g.to, at: 100 }] : []);

  const set = (patch) => onChange({ ...(g || {}), ...patch, stops });
  const setStops = (next) => onChange({ ...(g || {}), stops: next });

  const patchStop = (i, key, v) => setStops(stops.map((st, idx) => (idx === i ? { ...st, [key]: v } : st)));

  const addStop = () => {
    // Новая точка встаёт посередине между последними двумя — там, где её
    // почти наверняка и хотят, а не в нуле поверх первой.
    const sorted = [...stops].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2] || { at: 0 };
    setStops([...stops, { color: last?.color || '#000000', at: Math.round(((prev.at ?? 0) + (last?.at ?? 100)) / 2) }]);
  };

  const preview = gradientCss(g) || 'none';

  return (
    <div className="eb-gradient">
      <label className="eb-check">
        <input
          type="checkbox"
          checked={on}
          onChange={() => onChange(on ? null : { ...GRADIENT_PRESETS[0].value })}
        />
        <span>{on ? 'Включён' : 'Выключен'}</span>
      </label>

      {on && (
        <>
          {/* Сам градиент лежит внутри: на контейнере клетчатая подложка, без
              неё полупрозрачная точка неотличима от просто светлой. */}
          <div className="eb-gradient-preview"><span style={{ backgroundImage: preview }} /></div>

          <div className="eb-field">
            <label className="eb-field-label">Заготовки</label>
            <div className="eb-gradient-presets">
              {GRADIENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.name}
                  style={{ backgroundImage: gradientCss(preset.value) }}
                  onClick={() => onChange({ ...preset.value })}
                />
              ))}
            </div>
          </div>

          <div className="eb-field">
            <label className="eb-field-label">Тип</label>
            <select className="eb-input" value={g.type || 'linear'} onChange={(e) => set({ type: e.target.value })}>
              {GRADIENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {(g.type || 'linear') !== 'radial' && (
            <div className="eb-field">
              <label className="eb-field-label">Направление</label>
              <div className="eb-slider">
                <input type="range" min={0} max={360} step={5} value={Number(g.angle) ?? 135} onChange={(e) => set({ angle: Number(e.target.value) })} />
                <b>{Number(g.angle) ?? 135}°</b>
              </div>
            </div>
          )}

          {g.type === 'radial' && (
            <div className="eb-field">
              <label className="eb-field-label">Форма</label>
              <div className="eb-segmented">
                {[['ellipse', 'Овал'], ['circle', 'Круг']].map(([v, l]) => (
                  <button key={v} type="button" className={(g.shape || 'ellipse') === v ? 'active' : ''} onClick={() => set({ shape: v })}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {(g.type === 'radial' || g.type === 'conic') && (
            <div className="eb-field">
              <label className="eb-field-label">Центр</label>
              <select className="eb-input" value={g.position || 'center'} onChange={(e) => set({ position: e.target.value })}>
                {GRADIENT_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}

          <label className="eb-field-label">Точки</label>
          <div className="eb-stops">
            {stops.map((st, i) => (
              <div className="eb-stop" key={i}>
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(st.color || '') ? st.color : '#000000'}
                  onChange={(e) => patchStop(i, 'color', e.target.value)}
                />
                <label>
                  <input type="range" min={0} max={100} value={Number(st.at) ?? 0} onChange={(e) => patchStop(i, 'at', Number(e.target.value))} />
                  <span>{Number(st.at) ?? 0}%</span>
                </label>
                <label>
                  <input type="range" min={0} max={100} value={Number(st.alpha) ?? 100} onChange={(e) => patchStop(i, 'alpha', Number(e.target.value))} />
                  <span>непрозр. {Number(st.alpha) ?? 100}%</span>
                </label>
                {stops.length > 2 && (
                  <button type="button" className="eb-icon-btn" title="Убрать точку" onClick={() => setStops(stops.filter((_, idx) => idx !== i))}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="eb-btn" onClick={addStop}><Plus size={13} /> Точка</button>
          </div>

        </>
      )}
    </div>
  );
}

/**
 * Карточка вокруг содержимого блока: фон, рамка, скругление, тень.
 *
 * Отдельная от фона блока сущность намеренно. Фон блока — полоса во всю ширину
 * письма, карточка — прямоугольник внутри неё. Именно так собирается почти
 * любой почтовый макет, и слив их в одно свойство сделал бы невозможным самый
 * частый приём: цветная полоса, а на ней белая карточка.
 */
function CardField({ value, onChange }) {
  const v = value || null;
  const on = Boolean(v);
  const set = (key) => (val) => onChange({ ...(v || {}), [key]: val });

  return (
    <div className="eb-cardfield">
      <label className="eb-check">
        <input
          type="checkbox"
          checked={on}
          onChange={() => onChange(on ? null : { background: '#FFFFFF', radius: 16, borderWidth: 0, borderColor: '#E5E5EA', shadow: false, padding: 20 })}
        />
        <span>{on ? 'Есть' : 'Нет'}</span>
      </label>
      {on && (
        <>
          <div className="eb-field">
            <label className="eb-field-label">Фон карточки</label>
            <ColorField value={v.background} onChange={set('background')} clearable />
          </div>
          <div className="eb-field">
            <label className="eb-field-label">Градиент карточки</label>
            <GradientField value={v.gradient} onChange={set('gradient')} />
          </div>
          <div className="eb-field">
            <label className="eb-field-label">Скругление</label>
            <div className="eb-slider">
              <input type="range" min={0} max={40} value={Number(v.radius) || 0} onChange={(e) => set('radius')(Number(e.target.value))} />
              <b>{Number(v.radius) || 0}px</b>
            </div>
          </div>
          <div className="eb-field">
            <label className="eb-field-label">Рамка</label>
            <div className="eb-slider">
              <input type="range" min={0} max={8} value={Number(v.borderWidth) || 0} onChange={(e) => set('borderWidth')(Number(e.target.value))} />
              <b>{Number(v.borderWidth) || 0}px</b>
            </div>
          </div>
          {Number(v.borderWidth) > 0 && (
            <div className="eb-field">
              <label className="eb-field-label">Цвет рамки</label>
              <ColorField value={v.borderColor} onChange={set('borderColor')} />
            </div>
          )}
          <div className="eb-field">
            <label className="eb-field-label">Поля внутри</label>
            <div className="eb-slider">
              <input type="range" min={0} max={48} value={Number(v.padding) ?? 20} onChange={(e) => set('padding')(Number(e.target.value))} />
              <b>{Number(v.padding) ?? 20}px</b>
            </div>
          </div>
          <label className="eb-check">
            <input type="checkbox" checked={Boolean(v.shadow)} onChange={(e) => set('shadow')(e.target.checked)} />
            <span>Тень (видна в Apple Mail, в Gmail и Outlook нет)</span>
          </label>
        </>
      )}
    </div>
  );
}

/**
 * Слой поверх страницы, привязанный к кнопке (ver. 8.53).
 *
 * Выпадашка внутри панели свойств обрезается её краем: панель прокручивается,
 * а значит, обязана прятать всё, что из неё вылезло. Поэтому списки, которые
 * не помещаются в поле, рисуются в body, а положение им считают здесь — от
 * кнопки, с прижатием к краям окна. Слой едет за кнопкой при прокрутке: без
 * этого он остаётся висеть там, где его открыли.
 *
 * Возвращает координаты или null, пока их не посчитали, — до первого расчёта
 * слой рисовать нельзя, иначе он мигает в левом верхнем углу.
 */
function usePopover(open, btnRef, popRef, close, width, height) {
  const [at, setAt] = useState(null);

  useEffect(() => {
    if (!open) { setAt(null); return undefined; }

    const place = () => {
      const box = btnRef.current?.getBoundingClientRect();
      if (!box) return;
      const left = Math.min(Math.max(12, box.right - width), Math.max(12, window.innerWidth - width - 12));
      // Снизу, если снизу помещается; иначе сверху; если не помещается нигде —
      // прижимаем к краю окна: обрезанный список лучше списка за экраном.
      const below = window.innerHeight - box.bottom - 12;
      const top = below >= height || below >= box.top
        ? Math.min(box.bottom + 6, window.innerHeight - height - 12)
        : box.top - height - 6;
      setAt({ left, top: Math.max(12, top) });
    };

    place();
    const outside = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const esc = (e) => { if (e.key === 'Escape') close(); };

    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
    };
    // close приходит новой функцией на каждый рендер, и в зависимостях он
    // пересоздавал бы подписки на каждое нажатие клавиши в поиске.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width, height]);

  return at;
}

/**
 * Выбор иконки (ver. 8.53).
 *
 * Набор тот же, что рисует интерфейс портала, — lucide. До этого в пунктах
 * стояли эмодзи, и на них пришла ровно одна претензия, но содержательная:
 * цветной эмодзи в деловом письме выглядит случайным, а набор у каждой почты
 * свой, так что у получателя он ещё и не тот, что видел отправитель. Линейная
 * иконка одинакова везде, потому что в письмо она уезжает картинкой, которую
 * рисует наш же сервер.
 *
 * Список открывается слоем поверх страницы, а не выпадашкой внутри панели.
 * Панель свойств прокручивается и обрезает всё, что вылезло за её край, —
 * прошлый подборщик так и срезало снизу. Слой в body ничем не обрезан, а
 * положение считается от кнопки и прижимается к краям окна.
 */
function IconField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const current = ICON_BY_KEY[value];

  const at = usePopover(open, btnRef, popRef, () => setOpen(false), 320, 380);

  // Поиск идёт и по названию, и по словам-подсказкам: «анализы» должны найти
  // пробирку, хотя в её названии этого слова нет.
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EMAIL_ICONS.filter((i) => {
      if (group !== 'all' && i.group !== group) return false;
      if (!q) return true;
      return i.label.toLowerCase().includes(q) || i.keywords.includes(q) || i.key.includes(q);
    });
  }, [query, group]);

  const Current = current?.Icon;

  return (
    <div className="eb-iconpick">
      <button type="button" className="eb-iconpick-btn" ref={btnRef} onClick={() => setOpen(v => !v)}>
        <span className="eb-iconpick-now">{Current ? <Current size={18} /> : <Search size={16} />}</span>
        <span>{current?.label || 'Выбрать иконку'}</span>
      </button>
      {value && (
        <button type="button" className="eb-icon-btn" title="Убрать" onClick={() => onChange('')}>
          <Trash2 size={12} />
        </button>
      )}
      {open && at && createPortal(
        <div className="eb-iconpop" ref={popRef} style={{ left: at.left, top: at.top }}>
          <div className="eb-iconpop-head">
            <Search size={13} />
            <input
              autoFocus
              className="eb-iconpop-search"
              placeholder="Найти иконку"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="eb-icon-btn" title="Закрыть" onClick={() => setOpen(false)}><X size={13} /></button>
          </div>
          <div className="eb-iconpop-groups">
            <button type="button" className={group === 'all' ? 'active' : ''} onClick={() => setGroup('all')}>Все</button>
            {ICON_GROUPS.map(([id, label]) => (
              <button key={id} type="button" className={group === id ? 'active' : ''} onClick={() => setGroup(id)}>{label}</button>
            ))}
          </div>
          <div className="eb-iconpop-grid">
            {found.map(({ key, Icon, label }) => (
              <button
                key={key}
                type="button"
                title={label}
                className={key === value ? 'active' : ''}
                onClick={() => { onChange(key); setOpen(false); }}
              >
                <Icon size={20} />
              </button>
            ))}
            {!found.length && <div className="eb-iconpop-empty">Ничего не нашлось</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Выбор эмодзи.
 *
 * Набирать эмодзи руками в поле ввода можно только через системную панель, а в
 * ней ещё надо знать, что искать. Подборщик тот же, что в редакторе страниц
 * портала, — он уже стоит в зависимостях и знает русские названия.
 */
function EmojiField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const at = usePopover(open, btnRef, popRef, () => setOpen(false), 280, 340);

  return (
    <div className="eb-emoji">
      <button type="button" className="eb-emoji-btn" ref={btnRef} onClick={() => setOpen(v => !v)}>
        <span>{value || '🙂'}</span>
        <small>{value ? 'Заменить' : 'Выбрать'}</small>
      </button>
      {value && (
        <button type="button" className="eb-icon-btn" title="Убрать" onClick={() => onChange('')}>
          <Trash2 size={12} />
        </button>
      )}
      {open && at && createPortal(
        <div className="eb-emoji-pop" ref={popRef} style={{ left: at.left, top: at.top }}>
          <EmojiPicker
            width={280}
            height={340}
            searchPlaceholder="Поиск"
            previewConfig={{ showPreview: false }}
            onEmojiClick={(e) => { onChange(e.emoji); setOpen(false); }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Выбор шрифта.
 *
 * Каждая строка списка набрана своим шрифтом — иначе выбирать приходится по
 * названию, а названия шрифтов говорят что-то только тем, кто ими занимается.
 * Веб-шрифты вынесены в отдельную группу с предупреждением: они красивее, но
 * Gmail и Outlook их вырежут, и там письмо наберётся запасным из того же стека.
 */
function FontField({ value, onChange, placeholder }) {
  // Веб-шрифт нужно подгрузить в саму страницу конструктора, иначе список
  // покажет Montserrat системным шрифтом и выбирать будет не из чего.
  useEffect(() => { WEB_FONT_KEYS.forEach(ensureWebFont); }, []);

  return (
    <select
      className="eb-input"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={{ fontFamily: value ? fontStack(value) : undefined }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      <optgroup label="Доезжают везде">
        {SAFE_FONT_KEYS.map(key => (
          <option key={key} value={key} style={{ fontFamily: FONTS[key].stack }}>{FONTS[key].label}</option>
        ))}
      </optgroup>
      <optgroup label="Красивее, но не везде">
        {WEB_FONT_KEYS.map(key => (
          <option key={key} value={key} style={{ fontFamily: FONTS[key].stack }}>{FONTS[key].label}</option>
        ))}
      </optgroup>
    </select>
  );
}

function Field({ field, value, onChange, block }) {
  switch (field.type) {
    case 'text':
      return <input className="eb-input" value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;

    case 'link':
      return (
        <div className="eb-link-field">
          <Link2 size={14} />
          <input className="eb-input" value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
        </div>
      );

    case 'code':
      return <textarea className="eb-input eb-code" rows={8} value={value ?? ''} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;

    case 'number':
      return (
        <div className="eb-number">
          <input
            type="number"
            className="eb-input"
            value={value ?? ''}
            min={field.min}
            max={field.max}
            step={field.step || 1}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
          {field.suffix && <span>{field.suffix}</span>}
        </div>
      );

    case 'slider':
      return (
        <div className="eb-slider">
          <input
            type="range"
            min={field.min}
            max={field.max}
            value={Number(value) || field.min}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <b>{Number(value) || field.min}{field.suffix}</b>
        </div>
      );

    case 'color':
      return <ColorField value={value} onChange={onChange} clearable={field.clearable} />;

    case 'image':
      return <ImageField value={value} onChange={onChange} />;

    case 'padding':
      return <PaddingField value={value} onChange={onChange} />;

    case 'list':
      return <ListField field={field} value={value} onChange={onChange} />;

    case 'utm':
      return <UtmField value={value} onChange={onChange} />;

    case 'gradient':
      return <GradientField value={value} onChange={onChange} />;

    case 'emoji':
      return <EmojiField value={value} onChange={onChange} />;

    case 'icon':
      return <IconField value={value} onChange={onChange} />;

    case 'font':
      return <FontField value={value} onChange={onChange} placeholder={field.placeholder} />;

    case 'card':
      return <CardField value={value} onChange={onChange} />;

    case 'align':
      return (
        <div className="eb-segmented">
          {(field.options || ['left', 'center', 'right', 'justify']).map((a) => {
            const Icon = ALIGN_ICONS[a];
            return (
              <button key={a} type="button" className={value === a || (!value && a === 'left') ? 'active' : ''} onClick={() => onChange(a)}>
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      );

    case 'select':
      return (
        <select className="eb-input" value={value ?? field.options[0][0]} onChange={(e) => onChange(e.target.value)}>
          {field.options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      );

    // Число колонок меняет структуру блока, а не одно свойство, поэтому у него
    // собственный тип поля, а не select.
    case 'columnCount': {
      const cols = block?.columns || [];
      return (
        <div className="eb-segmented">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={cols.length === n ? 'active' : ''}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
      );
    }

    case 'columnWidths': {
      const cols = block?.columns || [];
      return (
        <div className="eb-widths">
          {cols.map((col, i) => (
            <label key={i}>
              <input
                type="number"
                className="eb-input"
                min={10}
                max={90}
                value={col.width ?? Math.round(100 / cols.length)}
                onChange={(e) => onChange({ index: i, width: Number(e.target.value) })}
              />
              <span>{i + 1}-я</span>
            </label>
          ))}
        </div>
      );
    }

    default:
      return null;
  }
}

/**
 * Что свёрнуто, помнится на весь сеанс.
 *
 * Не в состоянии компонента: панель пересоздаётся при каждом выборе блока, и
 * свёрнутые «Отступы» разворачивались бы обратно при каждом клике по холсту.
 * Не в localStorage: это не настройка, а положение рук в текущей работе, и
 * переносить его на следующий день незачем.
 */
const collapsed = {};

function Section({ group, fields, values, onChange, block }) {
  const [, force] = useState(0);
  const isOpen = !collapsed[group.key];

  return (
    <section className={`eb-section ${isOpen ? '' : 'closed'}`}>
      <button
        type="button"
        className="eb-section-head"
        onClick={() => { collapsed[group.key] = isOpen; force(n => n + 1); }}
      >
        <ChevronDown size={13} />
        <span>{group.label}</span>
        <small>{fields.length}</small>
      </button>
      {isOpen && (
        <div className="eb-section-body">
          {fields.map((field) => (
            <div className="eb-field" key={field.key}>
              <label className="eb-field-label">{field.label}</label>
              {/*
                Подсказки под полями убраны по просьбе заказчика: редактор
                должен читаться раскладкой, а не текстом. Сами поля `hint` в
                описаниях блоков оставлены — они служат заголовком всплывающей
                подсказки и объясняют решение тому, кто читает код.
              */}
              <Field field={field} value={values?.[field.key]} onChange={(v) => onChange(field.key, v)} block={block} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Панель свойств.
 *
 * Поля разложены по смысловым группам, а не идут одной простынёй. У блока их
 * бывает под двадцать, и в сплошном списке «Отступы» оказываются на третьем
 * экране прокрутки, а «Цвет текста» теряется между «Ссылкой кнопки» и
 * «Скруглением». Порядок групп задан в blocks.js и не меняется от блока к
 * блоку — это и есть то, за счёт чего панелью можно пользоваться не глядя.
 */
export default function Inspector({ fields, values, onChange, block, title, note }) {
  const byGroup = GROUPS
    .map(group => ({ group, items: fields.filter(f => groupOfField(f) === group.key) }))
    .filter(g => g.items.length);

  return (
    <div className="eb-inspector">
      <h4>{title}</h4>
      {byGroup.map(({ group, items }) => (
        <Section
          key={group.key}
          group={group}
          fields={items}
          values={values}
          onChange={onChange}
          block={block}
        />
      ))}
    </div>
  );
}
