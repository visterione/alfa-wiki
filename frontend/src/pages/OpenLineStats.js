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
