/**
 * Конструктор анкеты (ver. 8.20).
 *
 * Анкета собирается из блоков, блок — из полей, блоки разложены по шагам
 * мастера. Ровно та структура, что лежит в шаблоне, без промежуточного
 * представления: редактор правит то же самое, что уедет в базу, и расходиться
 * им негде.
 *
 * Одно отличие от хранимого вида — шаг. В базе шаг держит список своих блоков
 * (`steps[].blocks`), а здесь блок помнит, в каком он шаге. Перекладывать блок
 * выпадающим списком в самом блоке человеку понятнее, чем таскать ключи между
 * двумя списками, а обратное преобразование — четыре строки в toStored().
 *
 * Ключи полей человек может не придумывать: они переводятся из подписи
 * («Дата рождения» → `dataRozhdeniya`). Придумывать латинские имена для
 * тридцати полей — работа, которая ничего не даёт: ключ виден только здесь.
 * Поправить его всё равно можно, и иногда нужно — по ключу поле узнают в
 * выгрузке.
 */

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, Plus, Trash2, GripVertical, Repeat
} from 'lucide-react';

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

export function fromStored(form) {
  const steps = (form?.steps || []).map(s => ({ key: s.key, title: s.title }));
  const stepByBlock = new Map();
  for (const step of form?.steps || []) {
    for (const blockKey of step.blocks || []) stepByBlock.set(blockKey, step.key);
  }
  const blocks = (form?.blocks || []).map(block => ({
    ...block,
    fields: (block.fields || []).map(f => ({ ...f })),
    stepKey: stepByBlock.get(block.key) || steps[0]?.key || ''
  }));
  return { blocks, steps, consentVersion: form?.consentVersion || '' };
}

export function toStored(draft) {
  return {
    blocks: draft.blocks.map(({ stepKey, ...block }) => block),
    // Порядок блоков внутри шага — это порядок в общем списке: он и есть
    // порядок, в котором человек их увидит.
    steps: draft.steps.map(step => ({
      ...step,
      blocks: draft.blocks.filter(b => b.stepKey === step.key).map(b => b.key)
    })),
    consentVersion: draft.consentVersion || ''
  };
}

// ── Редактор ───────────────────────────────────────────────────────────────

export default function FormBuilder({ draft, meta, onChange }) {
  const [open, setOpen] = useState(() => new Set());

  const toggle = (key) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const patch = (changes) => onChange({ ...draft, ...changes });

  const setBlock = (index, block) => {
    const blocks = draft.blocks.slice();
    blocks[index] = block;
    patch({ blocks });
  };

  const moveBlock = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= draft.blocks.length) return;
    const blocks = draft.blocks.slice();
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    patch({ blocks });
  };

  const addBlock = () => {
    const key = keyFromLabel('Новый блок', takenKeys(draft.blocks));
    const block = {
      key,
      title: 'Новый блок',
      fields: [{ key: keyFromLabel('Новое поле', takenKeys(draft.blocks)), label: 'Новое поле', type: 'text' }],
      stepKey: draft.steps[0]?.key || ''
    };
    patch({ blocks: [...draft.blocks, block] });
    setOpen(prev => new Set(prev).add(key));
  };

  const removeBlock = (index) => {
    patch({ blocks: draft.blocks.filter((_, i) => i !== index) });
  };

  return (
    <div className="vac-builder">
      <StepsEditor draft={draft} onChange={patch} />

      <div className="vac-sect">
        <span>Блоки анкеты</span>
        <button className="vac-btn is-ghost" onClick={addBlock}><Plus size={14} />Добавить блок</button>
      </div>

      {!draft.blocks.length && (
        <div className="vac-empty">В анкете нет ни одного блока.</div>
      )}

      {draft.blocks.map((block, index) => (
        <BlockCard
          key={block.key || index}
          block={block}
          blocks={draft.blocks}
          steps={draft.steps}
          meta={meta}
          isOpen={open.has(block.key)}
          onToggle={() => toggle(block.key)}
          onChange={(next) => setBlock(index, next)}
          onMoveUp={() => moveBlock(index, -1)}
          onMoveDown={() => moveBlock(index, 1)}
          onRemove={() => removeBlock(index)}
          canMoveUp={index > 0}
          canMoveDown={index < draft.blocks.length - 1}
        />
      ))}
    </div>
  );
}

/**
 * Шаги мастера.
 *
 * Шаг без блоков анкету не сломает — сервер о нём скажет при сохранении, — но
 * пустой шаг здесь виден сразу: рядом с названием стоит, сколько блоков в него
 * попало.
 */
function StepsEditor({ draft, onChange }) {
  const countIn = (key) => draft.blocks.filter(b => b.stepKey === key).length;

  const setStep = (index, step) => {
    const steps = draft.steps.slice();
    const before = steps[index].key;
    steps[index] = step;
    // Ключ шага живёт только внутри шаблона, никаких заявок он не держит,
    // поэтому переименование безопасно — но блоки надо перецепить.
    const blocks = before === step.key
      ? draft.blocks
      : draft.blocks.map(b => (b.stepKey === before ? { ...b, stepKey: step.key } : b));
    onChange({ steps, blocks });
  };

  const addStep = () => {
    const taken = new Set(draft.steps.map(s => s.key));
    const key = keyFromLabel('Новый шаг', taken);
    onChange({ steps: [...draft.steps, { key, title: 'Новый шаг' }] });
  };

  const removeStep = (index) => {
    const step = draft.steps[index];
    const steps = draft.steps.filter((_, i) => i !== index);
    // Блоки удалённого шага не пропадают вместе с ним: они переезжают в первый
    // оставшийся. Иначе человек, убрав шаг, молча терял бы пять блоков анкеты.
    const fallback = steps[0]?.key || '';
    const blocks = draft.blocks.map(b => (b.stepKey === step.key ? { ...b, stepKey: fallback } : b));
    onChange({ steps, blocks });
  };

  const moveStep = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = draft.steps.slice();
    [steps[index], steps[target]] = [steps[target], steps[index]];
    onChange({ steps });
  };

  return (
    <>
      <div className="vac-sect">
        <span>Шаги анкеты</span>
        <button className="vac-btn is-ghost" onClick={addStep}><Plus size={14} />Добавить шаг</button>
      </div>

      <div className="vac-hint">
        Анкету человек заполняет по шагам, а не одним полотном: на телефоне
        полтора десятка блоков подряд прокручиваются минуту, и до конца доходят
        не все. В каком шаге блок — выбирается в самом блоке.
      </div>

      <div className="vac-steps">
        {draft.steps.map((step, index) => (
          <div className="vac-step" key={step.key || index}>
            <GripVertical size={14} className="vac-step-grip" />
            <input
              className="vac-input"
              value={step.title}
              placeholder="Название шага"
              onChange={e => setStep(index, { ...step, title: e.target.value })}
            />
            <input
              className="vac-input is-key"
              value={step.key}
              placeholder="ключ"
              onChange={e => setStep(index, { ...step, key: e.target.value.trim() })}
            />
            <span className={`vac-badge ${countIn(step.key) ? 'vac-badge-muted' : 'vac-badge-warn'}`}>
              {countIn(step.key)} бл.
            </span>
            <button className="vac-icon" title="Выше" disabled={index === 0} onClick={() => moveStep(index, -1)}>
              <ChevronUp size={14} />
            </button>
            <button className="vac-icon" title="Ниже" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}>
              <ChevronDown size={14} />
            </button>
            <button
              className="vac-icon is-danger"
              title={draft.steps.length > 1 ? 'Удалить шаг' : 'Последний шаг удалить нельзя'}
              disabled={draft.steps.length < 2}
              onClick={() => removeStep(index)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function BlockCard({
  block, blocks, steps, meta, isOpen, onToggle, onChange,
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
    onChange({ ...block, fields: [...block.fields, { key, label: 'Новое поле', type: 'text' }] });
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
          title="В каком шаге анкеты показывается блок"
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

          {block.repeat && (
            <div className="vac-hint">
              У повторяемого блока человек добавляет записи сам, поэтому роли
              полям здесь не ставятся: значений много, и «дата выхода» в третьей
              строке — бессмыслица.
            </div>
          )}

          <div className="vac-fields">
            {block.fields.map((field, index) => (
              <FieldRow
                key={field.key || index}
                field={field}
                block={block}
                blocks={blocks}
                meta={meta}
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
  field, block, blocks, meta, onChange, onMoveUp, onMoveDown, onRemove, canMoveUp, canMoveDown
}) {
  const [more, setMore] = useState(false);
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

          {field.role && (
            <div className="vac-hint is-inline">
              {meta.fieldRoles.find(r => r.key === field.role)?.hint
                || 'Поле с ролью движок читает отдельно от остальной анкеты.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
