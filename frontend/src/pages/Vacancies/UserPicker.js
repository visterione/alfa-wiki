/**
 * Выбор сотрудника с поиском (ver. 8.34).
 *
 * Раньше исполнитель выбирался обычным <select>. Список там листают, а не
 * ищут: браузер умеет находить только по началу строки и только вслепую — набор
 * теряется через секунду, а совпадение не подсвечивается. Когда в списке
 * оказывались все сотрудники портала, это было единственной причиной, по которой
 * назначение занимало минуту.
 *
 * Список теперь короткий — в нём только те, у кого есть доступ к разделу, — но
 * поиск нужен и в коротком: человека ищут по фамилии, а стоит он по имени
 * («Мария Петровна Иванова»), либо по должности, которой в подписи нет вовсе.
 * Поэтому ищем вхождение в любом месте имени, логина и должности, а совпадения
 * с начала поднимаем наверх: точный набор всё равно даёт точный ответ.
 *
 * Свой компонент, а не Combobox из склада: тот живёт на своих стилях внутри
 * складского модуля и тянет за собой портал под прокручиваемые модалки. Здесь
 * список короткий и стоит на спокойной странице, поэтому хватает обычного
 * absolute — а вид берётся из стилей раздела.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, UserPlus } from 'lucide-react';

/** Имя, логин и должность одной строкой — по ней и ищем. */
function haystack(user) {
  return [user.displayName, user.username, user.position].filter(Boolean).join(' ').toLowerCase();
}

export default function UserPicker({ users, onPick, disabled, placeholder = 'Назначить исполнителя' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);

  const boxRef = useRef(null);
  const inputRef = useRef(null);

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users
      .map(user => ({ user, at: haystack(user).indexOf(needle) }))
      .filter(item => item.at >= 0)
      // Совпадение в начале — выше: набравший «ива» ждёт Иванову первой, а не
      // Сидорова с должностью «старший администратор».
      .sort((a, b) => a.at - b.at)
      .map(item => item.user);
  }, [users, q]);

  // Курсор держим в пределах найденного: после каждой буквы список короче, и
  // выбранным по Enter оказался бы кто-то другой.
  useEffect(() => { setCursor(0); }, [q]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onDocument = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    return () => document.removeEventListener('mousedown', onDocument);
  }, [open]);

  const choose = (user) => {
    if (!user) return;
    setOpen(false);
    setQ('');
    onPick(user.id);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setOpen(false); setQ(''); return; }
    if (event.key === 'Enter') { event.preventDefault(); choose(found[cursor]); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!found.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor(prev => (prev + step + found.length) % found.length);
    }
  };

  return (
    <div className={`vac-picker ${open ? 'is-open' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="vac-picker-field"
        disabled={disabled || !users.length}
        onClick={() => setOpen(v => !v)}
      >
        <UserPlus size={14} />
        <span>{users.length ? placeholder : 'Некого назначить'}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="vac-picker-drop">
          <div className="vac-picker-search">
            <Search size={14} />
            <input
              ref={inputRef}
              value={q}
              placeholder="Фамилия или должность"
              onChange={e => setQ(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className="vac-picker-list">
            {found.map((user, index) => (
              <button
                type="button"
                key={user.id}
                className={index === cursor ? 'is-cursor' : ''}
                // mouseDown, а не click: click приходит после того, как
                // document-обработчик выше уже закрыл панель, и выбор терялся.
                onMouseDown={e => { e.preventDefault(); choose(user); }}
                onMouseEnter={() => setCursor(index)}
              >
                <b>{user.displayName || user.username}</b>
                {user.position && <small>{user.position}</small>}
              </button>
            ))}

            {!found.length && <div className="vac-picker-empty">Никого не нашлось</div>}
          </div>
        </div>
      )}
    </div>
  );
}
