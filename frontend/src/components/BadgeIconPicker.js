import React, { useMemo, useState } from 'react';
import { Search, Ban } from 'lucide-react';
import { CHAT_BADGE_ICON_GROUPS, DEFAULT_BADGE_COLOR } from './chat/badgeIcons';

// Сетка иконок для метки сотрудника: иконки видно сразу, без выпадающего списка.
// Поиск работает и по подписи («регистратура»), и по имени иконки («Clipboard»).
export default function BadgeIconPicker({
  value,
  onChange,
  color = DEFAULT_BADGE_COLOR,
  emptyLabel = 'Без иконки'
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CHAT_BADGE_ICON_GROUPS;
    return CHAT_BADGE_ICON_GROUPS
      .map(group => ({
        ...group,
        icons: group.icons.filter(([name, label]) =>
          label.toLowerCase().includes(q) || name.toLowerCase().includes(q))
      }))
      .filter(group => group.icons.length);
  }, [query]);

  return (
    <div className="badge-picker">
      <div className="badge-picker-search">
        <Search size={14} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск иконки — например, «регистратура»"
        />
      </div>

      <div className="badge-picker-scroll">
        <button
          type="button"
          className={`badge-picker-item badge-picker-item--empty ${!value ? 'active' : ''}`}
          onClick={() => onChange('')}
          title={emptyLabel}
        >
          <Ban size={18} />
          <span>{emptyLabel}</span>
        </button>

        {groups.map(group => (
          <div key={group.title} className="badge-picker-group">
            <div className="badge-picker-group-title">{group.title}</div>
            <div className="badge-picker-grid">
              {group.icons.map(([name, label, Icon]) => (
                <button
                  key={name}
                  type="button"
                  className={`badge-picker-item ${value === name ? 'active' : ''}`}
                  onClick={() => onChange(name)}
                  title={label}
                >
                  <Icon size={20} color={value === name ? color : 'currentColor'} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {!groups.length && <div className="badge-picker-empty">Ничего не найдено</div>}
      </div>
    </div>
  );
}
