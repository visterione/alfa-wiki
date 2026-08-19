import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Постраничная навигация под таблицей.
 *
 * До неё списки просто обрезались по лимиту запроса, а под таблицей стояла
 * подпись «Показано 200 из 3173». Она честно сообщала, что две трети данных
 * недоступны, но сделать с этим было нечего: до остальных строк нельзя было
 * добраться никак, кроме сужения фильтров. Для оборудования это означало, что
 * половину парка нельзя было увидеть в принципе.
 *
 * Номера страниц сворачиваются вокруг текущей: на трёх тысячах позиций полный
 * ряд из 64 кнопок не помещается ни на одном экране и не нужен — по номеру
 * прыгают на соседнюю страницу или на край, а в середину списка попадают
 * фильтром, а не перебором.
 *
 * Размер страницы живёт здесь же, а не в фильтрах: это свойство просмотра, а не
 * выборки, и рядом с номерами страниц его ищут в первую очередь.
 */

const PAGE_SIZES = [25, 50, 100, 200];

/** Номера страниц с многоточиями: первая, последняя, текущая и соседние. */
function pageItems(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);

  const items = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) items.push('…');
  for (let p = from; p <= to; p += 1) items.push(p);
  if (to < pages - 1) items.push('…');
  items.push(pages);
  return items;
}

export default function Pagination({
  page, pageSize, total, onPage, onPageSize, unit = 'записей',
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Одна страница — показывать нечего, кроме числа строк: ряд из единственной
  // кнопки «1» между двумя неактивными стрелками выглядит сломанным.
  const paged = pages > 1;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="wh-pager">
      <div className="wh-pager__total">
        {total > 0
          ? <>{first.toLocaleString('ru-RU')}–{last.toLocaleString('ru-RU')} из {total.toLocaleString('ru-RU')} {unit}</>
          : <>Нет данных</>}
      </div>

      {paged && (
        <div className="wh-pager__pages">
          <button className="wh-icon-btn" title="В начало"
                  disabled={page <= 1} onClick={() => onPage(1)}>
            <ChevronsLeft size={15} />
          </button>
          <button className="wh-icon-btn" title="Предыдущая страница"
                  disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft size={15} />
          </button>

          {pageItems(page, pages).map((item, i) => (
            item === '…'
              ? <span key={`gap${i}`} className="wh-pager__gap">…</span>
              : (
                <button key={item}
                        className={`wh-pager__page ${item === page ? 'is-active' : ''}`}
                        aria-current={item === page ? 'page' : undefined}
                        onClick={() => onPage(item)}>
                  {item}
                </button>
              )
          ))}

          <button className="wh-icon-btn" title="Следующая страница"
                  disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight size={15} />
          </button>
          <button className="wh-icon-btn" title="В конец"
                  disabled={page >= pages} onClick={() => onPage(pages)}>
            <ChevronsRight size={15} />
          </button>
        </div>
      )}

      {onPageSize && (
        <label className="wh-pager__size">
          Строк
          <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
