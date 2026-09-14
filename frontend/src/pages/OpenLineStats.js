import React, { useState, useEffect, useCallback } from 'react';
import { Star, RefreshCw, User as UserIcon } from 'lucide-react';
import { openLine as openLineApi, BASE_URL } from '../services/api';
import toast from 'react-hot-toast';
import './OpenLineStats.css';

/**
 * Показатели открытой линии: рейтинг сотрудников и продуктивность (ver. 7.99).
 *
 * Живут вкладкой раздела «Статистика» (ver. 8.09), а не в рабочем окне
 * оператора. Раньше они висели второй вкладкой над очередью обращений, и это
 * было не то место: очередь разбирают весь день, а показатели смотрят раз в
 * неделю, и вкладка рядом с работой означала промах мимо неё несколько раз в
 * день. Доска показателей — это про сравнение людей за период, то есть ровно то
 * же занятие, что и остальные вкладки «Статистики».
 *
 * Кто их видит, не изменилось: доступ по-прежнему даёт состав линии, а не право
 * на раздел. Сотрудник, не заведённый ни в одну линию, откроет вкладку и увидит
 * объяснение, а не пустую таблицу.
 *
 * Главная величина здесь — доля разобранного, и считается она не от общего
 * потока за месяц, а от того, что приходило на линию, пока человек был на
 * смене. Иначе выходящий через день всегда выглядел бы вдвое хуже работающего
 * каждый день, хотя разбирает столько же.
 *
 * Оценку ставит сам пациент кнопкой в боте сразу после закрытия обращения.
 * Оценок всегда меньше, чем обращений, — отвечает далеко не каждый, поэтому
 * рядом со средней всегда стоит их число: «4,8» по двум ответам и «4,8» по
 * восьмидесяти — разные утверждения.
 */

// Дни недели в порядке ISO: у Postgres ISODOW понедельник — первый. Совпадение
// не случайное, но и не бесплатное: DOW в той же базе считает воскресенье нулём,
// и перепутать их — значит нарисовать карту со сдвигом на день.
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Разреженный ответ сервера — в сетку 7 × 24 (ver. 8.30).
 *
 * Сервер отдаёт только непустые клетки: часов в неделе 168, а обращений за
 * месяц бывает меньше, и гонять по сети полторы сотни нулей незачем. Сетку
 * достраиваем здесь — рисовать её всё равно целиком, дырка в таблице читается
 * как поломка, а не как «в это время не пишут».
 */
function buildLoad(raw) {
  const cells = raw?.cells || [];
  if (!cells.length) return null;

  const grid = WEEKDAYS.map(() => HOURS.map(() => 0));
  const byHour = HOURS.map(() => ({ sessions: 0, quick: 0 }));
  let peak = 0;

  cells.forEach(({ dow, hour, sessions, quick }) => {
    const row = dow - 1;
    if (row < 0 || row > 6 || hour < 0 || hour > 23) return;
    grid[row][hour] = sessions;
    byHour[hour].sessions += sessions;
    byHour[hour].quick += quick;
    if (sessions > peak) peak = sessions;
  });

  return { grid, byHour, peak, quickSec: raw?.quickSec || 0 };
}

const PERIODS = [
  { key: 7, label: '7 дней' },
  { key: 30, label: '30 дней' },
  { key: 90, label: '90 дней' }
];

const avatarUrl = (avatar) => {
  if (!avatar) return null;
  if (avatar.startsWith('http://localhost') || avatar.startsWith('https://localhost')) {
    return `${BASE_URL}/${avatar.replace(/^https?:\/\/localhost:\d+\//, '')}`;
  }
  if (avatar.startsWith('http')) return avatar;
  return `${BASE_URL}/${avatar.startsWith('/') ? avatar.slice(1) : avatar}`;
};

/** Секунды в человеческий вид: «42 с», «7 мин», «1 ч 12 мин». */
function duration(sec) {
  if (sec == null) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s} с`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

function hours(sec) {
  if (!sec) return '—';
  const h = sec / 3600;
  return h < 10 ? `${h.toFixed(1)} ч` : `${Math.round(h)} ч`;
}

const percent = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const userName = (u) => u.displayName || u.username;

function Stars({ value }) {
  return (
    <span className="ols-stars">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={13} className={value != null && n <= Math.round(value) ? 'on' : ''} />
      ))}
    </span>
  );
}

export default function OpenLineStats() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      const res = await openLineApi.stats({ from: from.toISOString(), to: to.toISOString() });
      setData(res.data);
      setDenied(false);
    } catch (err) {
      if (err.response?.status === 403) setDenied(true);
      else toast.error('Не удалось загрузить показатели');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (denied) {
    return (
      <div className="ols-denied">
        <h2>Показатели недоступны</h2>
        <p>Их видит тот, кто работает на линии: администратор добавляет сотрудников в состав линии медцентра.</p>
      </div>
    );
  }

  const totals = data?.totals;
  const operators = data?.operators || [];
  // Полосу доли рисуем относительно лучшего, а не от ста процентов: при пяти
  // работающих людях ни у кого не будет и трети потока, и шкала от ста
  // превратила бы всю колонку в одинаковые огрызки.
  const bestShare = operators.reduce((max, o) => Math.max(max, o.share || 0), 0);

  // Темы приходят уже отсортированными по убыванию. Долю считаем от всех
  // закрытых за период, а полосу рисуем относительно самой частой темы — по той
  // же причине, что и у доли потока: при десяти темах ни одна не наберёт и
  // трети, и шкала от ста превратила бы столбец в одинаковые огрызки.
  const topics = data?.topics || [];
  const topicTotal = topics.reduce((sum, t) => sum + t.sessions, 0);
  const topTopic = topics.reduce((max, t) => Math.max(max, t.sessions), 0);

  // Имя не load: так уже названа загрузка данных этой страницы.
  const heat = buildLoad(data?.load);

  return (
    <div className="ols-root">
      <div className="ols-head">
        <div className="ols-periods">
          {PERIODS.map(p => (
            <button
              key={p.key}
              className={`ols-period ${days === p.key ? 'active' : ''}`}
              onClick={() => setDays(p.key)}
            >{p.label}</button>
          ))}
        </div>
        <button className="ols-refresh" onClick={load} title="Обновить">
          <RefreshCw size={15} className={loading ? 'ols-spin' : ''} />
        </button>
      </div>

      {totals && (
        <div className="ols-totals">
          <div className="ols-total">
            <span className="ols-total-value">{totals.sessions}</span>
            <span className="ols-total-label">обращений за период</span>
          </div>
          <div className="ols-total">
            <span className="ols-total-value">{totals.closed}</span>
            <span className="ols-total-label">закрыто</span>
          </div>
          <div className="ols-total">
            <span className="ols-total-value">
              {totals.avgRating != null ? totals.avgRating.toFixed(2).replace('.', ',') : '—'}
            </span>
            <span className="ols-total-label">
              средняя оценка{totals.ratings ? ` · ${totals.ratings} отв.` : ''}
            </span>
          </div>
          <div className="ols-total">
            <span className="ols-total-value">{totals.inQueue}</span>
            <span className="ols-total-label">ждут ответа</span>
          </div>
        </div>
      )}

      {loading && !data && <div className="ols-loading"><div className="loading-spinner" /></div>}

      {!loading && operators.length === 0 && (
        <div className="ols-empty">За период никто не разбирал обращений</div>
      )}

      {/* Когда обращаются (ver. 8.30). Отвечает на вопрос, которого в показателях
          не было вовсе: сколько людей ставить и на какие часы. До этого смены
          ставили по ощущению, а оно у работающего днём и у работающего вечером
          разное.

          Полоса под картой — про другое: сколько из пришедшего в этот час
          успевали взять. Две карты рядом отвечают на «когда поток» и «хватает
          ли в этот момент людей», и вторая без первой ничего не значит. */}
      {heat && (
        <>
          <div className="ols-section">
            Когда обращаются
            <em className="ols-section-note">
              часы московские, цвет — сколько обращений пришло
            </em>
          </div>
          <div className="ols-table-wrap">
            <div className="ols-heat">
              <div className="ols-heat-row ols-heat-head">
                <span className="ols-heat-label" />
                {HOURS.map(h => (
                  // Подписываем каждый третий час: 24 подписи в строку не влезают
                  // ни на каком экране, а без них сетка нечитаема.
                  <span key={h} className="ols-heat-hour">{h % 3 === 0 ? h : ''}</span>
                ))}
              </div>

              {heat.grid.map((row, day) => (
                <div className="ols-heat-row" key={WEEKDAYS[day]}>
                  <span className="ols-heat-label">{WEEKDAYS[day]}</span>
                  {row.map((n, h) => (
                    <span
                      key={h}
                      className="ols-heat-cell"
                      style={{ '--i': heat.peak > 0 ? n / heat.peak : 0 }}
                      title={`${WEEKDAYS[day]}, ${String(h).padStart(2, '0')}:00 — ${n} обращений`}
                    />
                  ))}
                </div>
              ))}

              <div className="ols-heat-row ols-heat-quick">
                <span className="ols-heat-label" title={`Взято за ${Math.round(heat.quickSec / 60)} мин`}>
                  успели
                </span>
                {heat.byHour.map((h, hour) => {
                  const share = h.sessions > 0 ? h.quick / h.sessions : null;
                  return (
                    <span
                      key={hour}
                      className={`ols-heat-cell ols-heat-cell-quick ${share == null ? 'empty' : ''}`}
                      style={{ '--i': share == null ? 0 : share }}
                      title={share == null
                        ? `${String(hour).padStart(2, '0')}:00 — обращений не было`
                        : `${String(hour).padStart(2, '0')}:00 — взято за ${Math.round(heat.quickSec / 60)} мин: ${Math.round(share * 100)}% из ${h.sessions}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* О чём были обращения (ver. 8.29). Отдельной таблицей под сотрудниками,
          а не колонкой среди них: тема — свойство разговора, и вопрос к ней
          другой. Сотрудники отвечают на «кто как работает», темы — на «что
          вообще происходит», и второе читают реже, поэтому оно ниже. */}
      {topics.length > 0 && (
        <>
          <div className="ols-section">О чём обращались</div>
          <div className="ols-table-wrap">
            <table className="ols-table">
              <thead>
                <tr>
                  <th>Тема</th>
                  <th>Обращений</th>
                  <th>Доля</th>
                  <th>Оценка</th>
                  <th>Разговор</th>
                </tr>
              </thead>
              <tbody>
                {topics.map(t => (
                  <tr key={t.topicId || 'none'} className={t.topicId ? '' : 'ols-row-muted'}>
                    <td>{t.name}</td>
                    <td><strong>{t.sessions}</strong></td>
                    <td>
                      <div className="ols-share">
                        <div className="ols-bar">
                          <span style={{ width: topTopic > 0 ? `${(t.sessions / topTopic) * 100}%` : 0 }} />
                        </div>
                        <span className="ols-share-value">
                          {topicTotal > 0 ? `${Math.round((t.sessions / topicTotal) * 100)}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td>
                      {t.avgRating != null ? t.avgRating.toFixed(2).replace('.', ',') : '—'}
                    </td>
                    <td>{duration(t.handleSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {operators.length > 0 && (
        <div className="ols-table-wrap">
          <table className="ols-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Оценка</th>
                <th>Разобрал</th>
                <th>Доля потока смены</th>
                <th>Первый ответ</th>
                <th>Разговор</th>
                <th>Смены</th>
              </tr>
            </thead>
            <tbody>
              {operators.map(o => (
                <tr key={o.user.id}>
                  <td>
                    <div className="ols-person">
                      <div className="ols-avatar">
                        {avatarUrl(o.user.avatar)
                          ? <img src={avatarUrl(o.user.avatar)} alt="" />
                          : <UserIcon size={18} />}
                      </div>
                      <span>{userName(o.user)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="ols-rating">
                      <Stars value={o.avgRating} />
                      <span className="ols-rating-value">
                        {o.avgRating != null ? o.avgRating.toFixed(2).replace('.', ',') : '—'}
                        {o.ratings > 0 && <em> · {o.ratings}</em>}
                      </span>
                    </div>
                  </td>
                  <td>
                    <strong>{o.handled}</strong>
                    {o.taken > o.handled && <em className="ols-note"> из {o.taken} взятых</em>}
                  </td>
                  <td>
                    {/* Знаменатель показываем рядом: без него доля читается как
                        оценка человека, а не как объём, который до него дошёл. */}
                    <div className="ols-share">
                      <div className="ols-bar">
                        <span style={{ width: bestShare > 0 ? `${((o.share || 0) / bestShare) * 100}%` : 0 }} />
                      </div>
                      <span className="ols-share-value">
                        {percent(o.share)}
                        <em> · {o.taken} из {o.offered}</em>
                      </span>
                    </div>
                  </td>
                  <td>{duration(o.firstReplySec)}</td>
                  <td>{duration(o.handleSec)}</td>
                  <td>{o.shifts} · {hours(o.shiftSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
