/**
 * Конструктор анкеты (ver. 8.20).
 *
 * Анкета собирается из блоков, блок — из полей, блоки разложены по шагам
 * мастера. Ровно та структура, что лежит в шаблоне, без промежуточного
 * представления: редактор правит то же самое, что уедет в базу, и расходиться
 * им негде.
 *
 * Одно отличие от хранимого вида — шаг. В базе шаг держит список своих блоков
 * (`steps[].blocks`), а здесь блок помнит, в каком он шаге: так порядок блоков
 * внутри шага — это просто их порядок в общем списке, а обратное преобразование
 * занимает четыре строки в toStored().
 *
 * ── Один список вместо двух (ver. 8.36) ─────────────────────────────────────
 *
 * Сначала шаги и блоки правились порознь: сверху список шагов, ниже — плоский
 * список всех блоков, и у каждого выпадающий список «в каком я шаге». Собрать
 * по такому экрану картину анкеты было нельзя: чтобы понять, что человек увидит
 * на втором шаге, приходилось прочитать все блоки и сверить их выпадающие
 * списки. Теперь список один и вложенный — шаг, внутри его блоки, внутри поля,
 * — и он устроен так же, как то, что увидит кандидат.
 *
 * Выпадающий список «в каком шаге» у блока при этом остался: перетаскивание
 * между шагами здесь стоило бы дороже, чем экономит, а перенести блок нужно
 * редко.
 *
 * Ключи полей человек может не придумывать: они переводятся из подписи
 * («Дата рождения» → `dataRozhdeniya`). Придумывать латинские имена для
 * тридцати полей — работа, которая ничего не даёт: ключ виден только здесь.
 * Поправить его всё равно можно, и иногда нужно — по ключу поле узнают в
 * выгрузке.
 *
 * Наши файлы у поля (ver. 8.34) уезжают на сервер сразу, а не вместе с анкетой:
 * анкета сохраняется кнопкой и целиком, и класть в тот же запрос двоичные файлы
 * значило бы пересылать их при каждой правке подписи у соседнего поля. Поэтому
 * «убрать» у прикреплённого файла отцепляет его от поля, а с диска его уберёт
 * сохранение анкеты — там видно, что на файл больше никто не ссылается.
 */

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, Plus, Trash2, Repeat, Paperclip
} from 'lucide-react';

import { vacancies as api } from '../../services/api';

// ── Ключи из подписей ──────────────────────────────────────────────────────

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

/**
 * Подпись → ключ. Первое слово строчными, остальные с большой буквы, как
 * называются поля во всём остальном проекте.
 */
export function keyFromLabel(label, taken = new Set()) {
  const words = String(label || '')
    .toLowerCase()
    .split(/[^а-яёa-z0-9]+/i)
    .filter(Boolean)
    .map(word => [...word].map(ch => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch)).join(''))
    .filter(Boolean);

  let base = words
    .map((word, index) => (index ? word[0].toUpperCase() + word.slice(1) : word))
    .join('')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 40);

  if (!base || !/^[a-zA-Z]/.test(base)) base = `pole${base}`.slice(0, 40);

  // Тёзки ловит и сервер, но подставлять заведомо занятый ключ, чтобы человек
  // потом читал про это в ошибке сохранения, незачем.
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}${n++}`.slice(0, 40);
  return key;
}

// ── Чем строка редактора остаётся собой ────────────────────────────────────
//
// React отличает элементы списка по key, а ключи шагов, блоков и полей человек
// здесь правит руками — и у поля ключ ещё и переводится из подписи на каждое
// нажатие клавиши. Пока key брался из них, ввод одной буквы означал новый key,
// React выбрасывал старый узел и ставил на его место новый, и фокус пропадал
// после первого же символа: набрать название поля было нельзя в принципе.
//
// Поэтому у каждой строки есть свой идентификатор, живущий только в редакторе:
// он раздаётся при загрузке и при создании, никуда не сохраняется (toStored его
// снимает) и не меняется, что бы человек ни печатал. По нему же запоминается,
// какие блоки раскрыты, — иначе правка ключа схлопывала бы карточку, внутри
// которой в этот момент стоит курсор.
let seq = 0;
export function uid() {
  seq += 1;
  return `u${seq}`;
}

/** Все ключи анкеты в одном пространстве имён — простые поля и повторяемые блоки. */
function takenKeys(blocks) {
  const out = new Set();
  for (const block of blocks) {
    if (block.repeat) out.add(block.key);
    else for (const field of block.fields) out.add(field.key);
  }
  return out;
}

// ── Преобразование в хранимый вид и обратно ────────────────────────────────

/**
 * Анкета из базы в вид, который правит редактор.
 *
 * `previous` — черновик, который был на экране до перечитывания. Идентификаторы
 * строк, чьи ключи не поменялись, переносятся из него: по ним запоминается, что
 * раскрыто, и без этого каждое «Сохранить» схлопывало бы все открытые блоки —
 * сохраняют-то посреди работы, а не в конце.
 */
export function fromStored(form, previous) {
  const known = new Map();
  for (const step of previous?.steps || []) known.set(`s:${step.key}`, step._uid);
  for (const block of previous?.blocks || []) {
    known.set(`b:${block.key}`, block._uid);
    for (const field of block.fields || []) known.set(`f:${block.key}.${field.key}`, field._uid);
  }
  const keep = (id) => known.get(id) || uid();

  const steps = (form?.steps || []).map(s => ({ key: s.key, title: s.title, _uid: keep(`s:${s.key}`) }));
  const stepByBlock = new Map();
  for (const step of form?.steps || []) {
    for (const blockKey of step.blocks || []) stepByBlock.set(blockKey, step.key);
  }
  const blocks = (form?.blocks || []).map(block => ({
    ...block,
    _uid: keep(`b:${block.key}`),
    fields: (block.fields || []).map(f => ({ ...f, _uid: keep(`f:${block.key}.${f.key}`) })),
    stepKey: stepByBlock.get(block.key) || steps[0]?.key || ''
  }));
  return { blocks, steps, consentVersion: form?.consentVersion || '' };
}

/**
 * Обратно в хранимый вид. Заодно снимает служебные поля редактора — `stepKey`
 * у блока и `_uid` у всех троих: в базе им делать нечего, а при сравнении
 * «изменилось ли» они дали бы правку на ровном месте.
 */
export function toStored(draft) {
  return {
    blocks: draft.blocks.map(({ stepKey, _uid, fields, ...block }) => ({
      ...block,
      fields: (fields || []).map(({ _uid: fieldUid, ...field }) => field)
    })),
    // Порядок блоков внутри шага — это порядок в общем списке: он и есть
    // порядок, в котором человек их увидит.
    steps: draft.steps.map(({ _uid, ...step }) => ({
      ...step,
      blocks: draft.blocks.filter(b => b.stepKey === step.key).map(b => b.key)
    })),
    consentVersion: draft.consentVersion || ''
  };
}

// ── Редактор ───────────────────────────────────────────────────────────────

export default function FormBuilder({ draft, meta, attachments = [], onAttach, onChange }) {
  const [open, setOpen] = useState(() => new Set());

  const toggle = (key) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const patch = (changes) => onChange({ ...draft, ...changes });

  // Блоки шага вместе с их местами в общем списке: порядок внутри шага — это
  // порядок в draft.blocks, и чтобы двигать блок стрелками, нужны оба индекса.
  const blocksOf = (stepKey) => draft.blocks
    .map((block, index) => ({ block, index }))
    .filter(item => item.block.stepKey === stepKey);

  const setBlock = (index, block) => {
    const blocks = draft.blocks.slice();
    blocks[index] = block;
    patch({ blocks });
  };

  const removeBlock = (index) => {
    patch({ blocks: draft.blocks.filter((_, i) => i !== index) });
  };

  /** Перестановка блока внутри своего шага: меняется местами с соседом по шагу. */
  const moveBlock = (stepKey, position, delta) => {
    const group = blocksOf(stepKey);
    const target = position + delta;
    if (target < 0 || target >= group.length) return;

    const blocks = draft.blocks.slice();
    const here = group[position].index;
    const there = group[target].index;
    [blocks[here], blocks[there]] = [blocks[there], blocks[here]];
    patch({ blocks });
  };

  /**
   * Новый блок встаёт сразу за последним блоком своего шага, а не в конец
   * общего списка: иначе добавленный в первый шаг блок оказался бы в хранимом
   * порядке после всех остальных, и кандидат увидел бы его последним.
   */
  const addBlock = (stepKey) => {
    const key = keyFromLabel('Новый блок', takenKeys(draft.blocks));
    const block = {
      key,
      _uid: uid(),
      title: 'Новый блок',
      fields: [{
        key: keyFromLabel('Новое поле', takenKeys(draft.blocks)),
        _uid: uid(),
        label: 'Новое поле',
        type: 'text'
      }],
      stepKey
    };

    const group = blocksOf(stepKey);
    const at = group.length ? group[group.length - 1].index + 1 : draft.blocks.length;
    const blocks = draft.blocks.slice();
    blocks.splice(at, 0, block);

    patch({ blocks });
    setOpen(prev => new Set(prev).add(key));
  };

  // ── Шаги ────────────────────────────────────────────────────────────────

  const setStep = (index, step) => {
    const steps = draft.steps.slice();
    const before = steps[index].key;
    steps[index] = step;
    // Ключ шага живёт только внутри анкеты, никаких заявок он не держит,
    // поэтому переименование безопасно — но блоки надо перецепить.
    const blocks = before === step.key
      ? draft.blocks
      : draft.blocks.map(b => (b.stepKey === before ? { ...b, stepKey: step.key } : b));
    patch({ steps, blocks });
  };

  const addStep = () => {
    const key = keyFromLabel('Новый шаг', new Set(draft.steps.map(s => s.key)));
    patch({ steps: [...draft.steps, { key, _uid: uid(), title: 'Новый шаг' }] });
  };

  const moveStep = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = draft.steps.slice();
    [steps[index], steps[target]] = [steps[target], steps[index]];
    patch({ steps });
  };

  const removeStep = (index) => {
    const step = draft.steps[index];
    const steps = draft.steps.filter((_, i) => i !== index);
    // Блоки удалённого шага не пропадают вместе с ним: они переезжают в первый
    // оставшийся. Иначе человек, убрав шаг, молча терял бы пять блоков анкеты.
    const fallback = steps[0]?.key || '';
    const blocks = draft.blocks.map(b => (b.stepKey === step.key ? { ...b, stepKey: fallback } : b));
    patch({ steps, blocks });
  };

  return (
    <div className="vac-builder">
      {draft.steps.map((step, stepIndex) => {
        const group = blocksOf(step.key);

        return (
          <section className="vac-stepgroup" key={step._uid || stepIndex}>
            <div className="vac-stepgroup-head">
              <span className="vac-stepgroup-no">{stepIndex + 1}</span>

              <input
                className="vac-input is-title"
                value={step.title}
                placeholder="Название шага — «О себе», «Документы»"
                onChange={e => setStep(stepIndex, { ...step, title: e.target.value })}
              />
              <input
                className="vac-input is-key"
                value={step.key}
                placeholder="ключ"
                onChange={e => setStep(stepIndex, { ...step, key: e.target.value.trim() })}
              />

              {!group.length && <span className="vac-badge vac-badge-warn">пустой шаг</span>}

              <button className="vac-icon" title="Выше" disabled={stepIndex === 0} onClick={() => moveStep(stepIndex, -1)}>
                <ChevronUp size={14} />
              </button>
              <button
                className="vac-icon"
                title="Ниже"
                disabled={stepIndex === draft.steps.length - 1}
                onClick={() => moveStep(stepIndex, 1)}
              >
                <ChevronDown size={14} />
              </button>
              <button
                className="vac-icon is-danger"
                title={draft.steps.length > 1 ? 'Удалить шаг — блоки перейдут в первый' : 'Последний шаг удалить нельзя'}
                disabled={draft.steps.length < 2}
                onClick={() => removeStep(stepIndex)}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="vac-stepgroup-body">
              {group.map(({ block, index }, position) => (
                <BlockCard
                  key={block._uid || index}
                  block={block}
                  blocks={draft.blocks}
                  steps={draft.steps}
                  meta={meta}
                  attachments={attachments}
                  onAttach={onAttach}
                  isOpen={open.has(block._uid)}
                  onToggle={() => toggle(block._uid)}
                  onChange={next => setBlock(index, next)}
                  onMoveUp={() => moveBlock(step.key, position, -1)}
                  onMoveDown={() => moveBlock(step.key, position, 1)}
                  onRemove={() => removeBlock(index)}
                  canMoveUp={position > 0}
                  canMoveDown={position < group.length - 1}
                />
              ))}

              <button className="vac-btn is-ghost" onClick={() => addBlock(step.key)}>
                <Plus size={14} />Блок в этот шаг
              </button>
            </div>
          </section>
        );
      })}

      <button className="vac-btn is-ghost is-wide" onClick={addStep}>
        <Plus size={14} />Добавить шаг анкеты
      </button>
    </div>
  );
}

function BlockCard({
  block, blocks, steps, meta, attachments, onAttach, isOpen, onToggle, onChange,
  onMoveUp, onMoveDown, onRemove, canMoveUp, canMoveDown
}) {
  const setField = (index, field) => {
    const fields = block.fields.slice();
    fields[index] = field;
    onChange({ ...block, fields });
  };

  const addField = () => {
    const taken = block.repeat
      ? new Set(block.fields.map(f => f.key))
      : takenKeys(blocks);
    const key = keyFromLabel('Новое поле', taken);
    onChange({ ...block, fields: [...block.fields, { key, _uid: uid(), label: 'Новое поле', type: 'text' }] });
  };

  const moveField = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= block.fields.length) return;
    const fields = block.fields.slice();
    [fields[index], fields[target]] = [fields[target], fields[index]];
    onChange({ ...block, fields });
  };

  const removeField = (index) => {
    onChange({ ...block, fields: block.fields.filter((_, i) => i !== index) });
  };

  return (
    <div className={`vac-block ${isOpen ? 'is-open' : ''}`}>
      <div className="vac-block-head">
        <button className="vac-icon" onClick={onToggle} title={isOpen ? 'Свернуть' : 'Развернуть'}>
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <input
          className="vac-input is-title"
          value={block.title}
          placeholder="Название блока"
          onChange={e => onChange({ ...block, title: e.target.value })}
        />

        <span className="vac-sub">{block.fields.length} пол.</span>

        {block.repeat && (
          <span className="vac-badge vac-badge-info" title="Записей в блоке может быть сколько угодно">
            <Repeat size={11} /> повтор
          </span>
        )}

        <select
          className="vac-input is-narrow"
          value={block.stepKey}
          onChange={e => onChange({ ...block, stepKey: e.target.value })}
          title="Перенести блок в другой шаг"
        >
          {steps.map(s => <option key={s.key} value={s.key}>{s.title || s.key}</option>)}
        </select>

        <button className="vac-icon" title="Выше" disabled={!canMoveUp} onClick={onMoveUp}><ChevronUp size={14} /></button>
        <button className="vac-icon" title="Ниже" disabled={!canMoveDown} onClick={onMoveDown}><ChevronDown size={14} /></button>
        <button className="vac-icon is-danger" title="Удалить блок" onClick={onRemove}><Trash2 size={14} /></button>
      </div>

      {isOpen && (
        <div className="vac-block-body">
          <div className="vac-row">
            <label className="vac-lab">
              Ключ блока
              <input
                className="vac-input is-key"
                value={block.key}
                onChange={e => onChange({ ...block, key: e.target.value.trim() })}
              />
            </label>
            <label className="vac-lab is-wide">
              Подсказка под заголовком
              <input
                className="vac-input"
                value={block.hint || ''}
                placeholder="необязательно"
                onChange={e => onChange({ ...block, hint: e.target.value })}
              />
            </label>
            <label className="vac-check" title="Записей в блоке может быть сколько угодно: образование, сертификаты, публикации">
              <input
                type="checkbox"
                checked={Boolean(block.repeat)}
                onChange={e => onChange({ ...block, repeat: e.target.checked })}
              />
              Повторяемый блок
            </label>
          </div>

          <div className="vac-fields">
            {block.fields.map((field, index) => (
              <FieldRow
                key={field._uid || index}
                field={field}
                block={block}
                blocks={blocks}
                meta={meta}
                attachments={attachments}
                onAttach={onAttach}
                onChange={next => setField(index, next)}
                onMoveUp={() => moveField(index, -1)}
                onMoveDown={() => moveField(index, 1)}
                onRemove={() => removeField(index)}
                canMoveUp={index > 0}
                canMoveDown={index < block.fields.length - 1}
              />
            ))}
          </div>

          <button className="vac-btn is-ghost" onClick={addField}><Plus size={14} />Добавить поле</button>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field, block, blocks, meta, attachments, onAttach,
  onChange, onMoveUp, onMoveDown, onRemove, canMoveUp, canMoveDown
}) {
  const [more, setMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const spec = meta.fieldTypes.find(t => t.key === field.type);

  // Ключ переводится из подписи, пока человек его не трогал руками. Как только
  // тронул — оставляем как есть: значит, он ему зачем-то нужен именно такой.
  const [keyTouched, setKeyTouched] = useState(false);

  const setLabel = (label) => {
    if (keyTouched) return onChange({ ...field, label });
    const taken = block.repeat
      ? new Set(block.fields.filter(f => f !== field).map(f => f.key))
      : takenKeys(blocks.map(b => (b === block ? { ...b, fields: b.fields.filter(f => f !== field) } : b)));
    return onChange({ ...field, label, key: keyFromLabel(label, taken) });
  };

  // Роль показывается только тем полям, которым она вообще может подойти:
  // список из пяти пунктов, три из которых всегда серые, читается хуже пустого.
  const roles = block.repeat
    ? []
    : meta.fieldRoles.filter(r => r.types.includes(field.type) || r.key === field.role);

  // Наши образцы, прикреплённые к этому полю. Порядок — тот, в котором их
  // прикладывали; ссылка, которой не нашлось файла, молча выпадает: файл могли
  // удалить, и показывать «файл №a3f9…» кандидату незачем.
  const chosen = (field.attachments || [])
    .map(id => attachments.find(a => a.id === id))
    .filter(Boolean);
  const canAddMore = (field.attachments || []).length < (meta.attachments?.max || 5);

  const attach = async (file) => {
    if (!file || !onAttach) return;
    setUploading(true);
    try {
      const row = await onAttach(file);
      if (row) onChange({ ...field, attachments: [...(field.attachments || []), row.id] });
    } finally {
      setUploading(false);
    }
  };

  // Отцепляем только от поля. Сам файл уберёт сохранение анкеты — на сервере
  // видно, ссылается ли на него ещё кто-нибудь, а здесь лежит несохранённый
  // черновик, и удалять по нему с диска нельзя.
  const detach = (id) => {
    const rest = (field.attachments || []).filter(x => x !== id);
    onChange({ ...field, attachments: rest.length ? rest : undefined });
  };

  return (
    <div className="vac-field">
      <div className="vac-field-main">
        <input
          className="vac-input"
          value={field.label}
          placeholder="Подпись поля"
          onChange={e => setLabel(e.target.value)}
        />

        <select
          className="vac-input is-narrow"
          value={field.type}
          onChange={e => onChange({ ...field, type: e.target.value })}
        >
          {meta.fieldTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        <label className="vac-check" title="Без него анкету не отправить">
          <input
            type="checkbox"
            checked={Boolean(field.required)}
            onChange={e => onChange({ ...field, required: e.target.checked })}
          />
          Обязательное
        </label>

        <button className="vac-icon" title="Ещё" onClick={() => setMore(v => !v)}>
          {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button className="vac-icon" title="Выше" disabled={!canMoveUp} onClick={onMoveUp}><ChevronUp size={14} /></button>
        <button className="vac-icon" title="Ниже" disabled={!canMoveDown} onClick={onMoveDown}><ChevronDown size={14} /></button>
        <button className="vac-icon is-danger" title="Удалить поле" onClick={onRemove}><Trash2 size={14} /></button>
      </div>

      {more && (
        <div className="vac-field-more">
          <label className="vac-lab">
            Ключ
            <input
              className="vac-input is-key"
              value={field.key}
              onChange={e => { setKeyTouched(true); onChange({ ...field, key: e.target.value.trim() }); }}
            />
          </label>

          {Boolean(roles.length) && (
            <label className="vac-lab">
              Роль
              <select
                className="vac-input"
                title={roles.find(r => r.key === field.role)?.hint || 'Чем поле является для движка'}
                value={field.role || ''}
                onChange={e => onChange({ ...field, role: e.target.value || undefined })}
              >
                <option value="">— обычное поле —</option>
                {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
          )}

          {spec?.numeric && (
            <>
              <label className="vac-lab is-tiny">
                Не меньше
                <input
                  className="vac-input" type="number" value={field.min ?? ''}
                  onChange={e => onChange({ ...field, min: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </label>
              <label className="vac-lab is-tiny">
                Не больше
                <input
                  className="vac-input" type="number" value={field.max ?? ''}
                  onChange={e => onChange({ ...field, max: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </label>
            </>
          )}

          {spec?.lengthMax && (
            <label className="vac-lab is-tiny">
              Длина, не больше
              <input
                className="vac-input" type="number" value={field.max ?? ''}
                onChange={e => onChange({ ...field, max: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </label>
          )}

          {spec?.accept && (
            <label className="vac-lab">
              Что принимаем
              <select
                className="vac-input"
                value={field.accept || ''}
                onChange={e => onChange({ ...field, accept: e.target.value || undefined })}
              >
                <option value="">Любой файл</option>
                <option value="image">Только картинки</option>
                <option value="doc">Документы и сканы</option>
              </select>
            </label>
          )}

          <label className="vac-lab is-wide">
            Подсказка
            <input
              className="vac-input"
              value={field.hint || ''}
              placeholder="необязательно"
              onChange={e => onChange({ ...field, hint: e.target.value })}
            />
          </label>

          {/* Наш файл для кандидата: образец заявления, памятка, бланк
              согласия. Стоит у поля, а не отдельным списком, потому что
              заполненное по образцу человек прикладывает ровно сюда же. */}
          <div className="vac-lab is-block">
            Наши файлы для кандидата
            <div className="vac-samples">
              {chosen.map(item => (
                <span className="vac-sample" key={item.id}>
                  <Paperclip size={12} />
                  <a href={api.attachmentUrl(item.id)} target="_blank" rel="noreferrer">{item.title}</a>
                  <small>{fileSize(item.size)}</small>
                  <button type="button" title="Убрать от поля" onClick={() => detach(item.id)}>×</button>
                </span>
              ))}

              {canAddMore && (
                <label
                  className={`vac-btn is-ghost is-file ${uploading ? 'is-busy' : ''}`}
                  title={`${meta.attachments?.hint || 'Файл для кандидата'}. До ${meta.attachments?.maxSizeMb || 20} МБ`}
                >
                  <input
                    type="file"
                    disabled={uploading}
                    onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; attach(file); }}
                  />
                  <Paperclip size={13} />
                  {uploading ? 'Загружаем…' : 'Прикрепить файл'}
                </label>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

/** Размер файла для строки рядом с названием. */
function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
