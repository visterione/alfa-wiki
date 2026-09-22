/**
 * Вкладка «Рассылки» (ver. 8.43) — почтовые рассылки сети.
 *
 * Отделена от «Анонсов» по просьбе заказчика: это разные занятия с разными
 * инструментами. Анонс уходит в мессенджеры коротким сообщением; рассылка —
 * это собранное письмо, список получателей, отложенная отправка и отписки.
 * Держать их подвкладками одного раздела значило прятать половину работы за
 * переключателем, который никто не замечает.
 *
 * Право доступа пока общее с анонсами (marketing.announcements): отдельного
 * флага в правах нет, и заводить его ради разделения вкладок означало бы
 * раздать всем администраторам новую настройку, о которой никто не просил.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Copy, Mail, MailX, Plus, RefreshCw, ChevronDown, ChevronRight, Undo2, Gauge, CalendarRange } from 'lucide-react';
import EmailComposer from '../../components/EmailComposer';
import { email } from '../../services/api';
import toast from 'react-hot-toast';

const EMAIL_STATUS = {
  scheduled: 'запланирована',
  sending: 'отправляется',
  canceled: 'отменена',
  sent: 'отправлена',
  partial: 'частично',
  failed: 'ошибка'
};

function fmt(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

const OPTOUT_SOURCE = {
  link: 'по ссылке в письме',
  oneclick: 'в один клик из почты',
  manual: 'вручную',
};

/**
 * Отписавшиеся от рассылок (ver. 8.43).
 *
 * Список закрыт по умолчанию не ради экономии места: открывать его каждый раз
 * незачем, а вот когда человек звонит и говорит «я отписался по ошибке», найти
 * его надо быстро. Поэтому здесь и поиск, и возврат в рассылку, и ручная
 * отписка — на случай просьбы «уберите меня», пришедшей не по ссылке, а голосом.
 */
function EmailOptouts({ canEdit }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await email.getOptouts({ limit: 500 });
      setState(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить список отписавшихся');
      setState({ total: 0, items: [] });
    }
  }, []);

  useEffect(() => { if (open && !state) load(); }, [open, state, load]);

  const restore = async (address) => {
    if (!window.confirm(`Вернуть ${address} в рассылки?`)) return;
    try {
      await email.removeOptout(address);
      toast.success('Адрес вернулся в рассылки');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось вернуть адрес');
    }
  };

  const addManual = async () => {
    const address = window.prompt('Какой адрес отписать?');
    if (!address?.trim()) return;
    try {
      await email.addOptout({ email: address.trim(), reason: 'по просьбе' });
      toast.success('Адрес больше не получит рассылок');
      load();
    } catch (err) {
      toast.error(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Не удалось записать отказ');
    }
  };

  const items = (state?.items || []).filter(row => (
    !query.trim() || row.email.toLowerCase().includes(query.trim().toLowerCase())
  ));

  return (
    <div className="ola-card ann-optouts">
      <header onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <span className="ola-card-icon"><MailX size={17} /></span>
        <h3>Отписались{state ? ` · ${state.total}` : ''}</h3>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </header>
      {open && (
        <div className="ola-card-body">
          <div className="ann-optouts-bar">
            <input
              className="ann-optouts-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Найти адрес"
            />
            {canEdit && <button className="ola-btn" onClick={addManual}><Plus size={14} /> Отписать вручную</button>}
            <button className="ola-btn" onClick={load} title="Обновить"><RefreshCw size={14} /></button>
          </div>

          {state === null && <div className="ola-loading">Загрузка…</div>}
          {state && items.length === 0 && (
            <div className="ola-empty">
              <MailX size={26} />
              <span>{query.trim() ? 'Такого адреса в списке нет' : 'От рассылок пока никто не отписался'}</span>
            </div>
          )}
          {items.map(row => (
            <div className="ann-optout-row" key={row.email}>
              <div>
                <strong>{row.email}</strong>
                <span>{OPTOUT_SOURCE[row.source] || row.source} · {fmt(row.createdAt)}</span>
              </div>
              {canEdit && (
                <button className="ola-btn" onClick={() => restore(row.email)} title="Вернуть в рассылки">
                  <Undo2 size={13} /> Вернуть
                </button>
              )}
            </div>
          ))}
          {state && state.total > state.items.length && (
            <p className="ann-optouts-note">
              Показаны последние {state.items.length} из {state.total}. Остальных ищите поиском по адресу.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const nfmt = (n) => Number(n || 0).toLocaleString('ru-RU');

const shortDay = (key) => {
  const [, m, d] = String(key || '').split('-');
  return d && m ? `${d}.${m}` : '—';
};

/**
 * Суточный предел почтовых рассылок (ver. 8.57).
 *
 * Свёрнут по умолчанию: меняют его раз в полгода, когда прибавляется ящик или
 * прогревается домен. А вот посмотреть, чем заняты ближайшие дни, приходится
 * каждый раз перед крупной рассылкой — поэтому загруженность видна сразу, как
 * только карточку открыли, и считать её в уме не надо.
 *
 * Почему предел вообще есть. Почтовые службы судят не о письме, а о поведении
 * отправителя: несколько тысяч писем, ушедших с одного домена за час, — та
 * самая картина, после которой в спам падает весь домен, включая записи на
 * приём и восстановление пароля. Разбирать это потом приходится неделями.
 */
function EmailDailyLimit({ canEdit }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await email.getLimit(14);
      setState(data);
      setDraft(String(data.perDay ?? ''));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось прочитать суточный предел');
      setState({ perDay: 0, days: [] });
    }
  }, []);

  useEffect(() => { if (open && !state) load(); }, [open, state, load]);

  const save = async () => {
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 0) {
      toast.error('Предел — целое число писем в сутки. 0 снимает ограничение');
      return;
    }
    setSaving(true);
    try {
      const { data } = await email.setLimit(value);
      setState(data);
      toast.success(value ? `Предел — ${nfmt(value)} писем в сутки` : 'Ограничение снято');
    } catch (err) {
      toast.error(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Не удалось сохранить предел');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ola-card ann-optouts">
      <header onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <span className="ola-card-icon"><Gauge size={17} /></span>
        <h3>Суточный предел{state ? (state.perDay ? ` · ${nfmt(state.perDay)} в сутки` : ' · снят') : ''}</h3>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </header>
      {open && (
        <div className="ola-card-body">
          {state === null && <div className="ola-loading">Загрузка…</div>}
          {state && (
            <>
              <div className="ann-limit-bar">
                <label htmlFor="ann-limit-input">Писем в сутки:</label>
                <input
                  id="ann-limit-input"
                  type="number"
                  min="0"
                  value={draft}
                  disabled={!canEdit || saving}
                  onChange={e => setDraft(e.target.value)}
                />
                {canEdit && (
                  <button className="ola-btn primary" onClick={save} disabled={saving || draft === String(state.perDay)}>
                    Сохранить
                  </button>
                )}
                <button className="ola-btn" onClick={load} title="Обновить"><RefreshCw size={14} /></button>
              </div>

              <p className="ann-limit-hint">
                Рассылка, которая в предел не помещается, не отменяется — она
                растягивается по дням, и план показывается до отправки. Ноль
                снимает ограничение совсем.
                <br />
                Ориентиры: Google&nbsp;Workspace — 2000 внешних получателей в
                сутки на ящик, Яндекс&nbsp;360 — 500 у обычных тарифов. Домен,
                с которого раньше почти не слали, поднимают постепенно: первые
                дни сотни, дальше удвоение раз в несколько дней.
              </p>

              {state.days?.length > 0 && (
                <ul className="ann-limit-days">
                  {state.days.map(day => (
                    <li key={day.date} className={state.perDay && day.used >= state.perDay ? 'full' : ''}>
                      <span>{shortDay(day.date)}</span>
                      <b>{nfmt(day.used)}</b>
                      {state.perDay ? <span>свободно {nfmt(day.free)}</span> : <span>без предела</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EmailAnnouncements({ canEdit }) {
  const [compose, setCompose] = useState(null);
  const [logs, setLogs] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await email.getHistory({ limit: 100 });
      setLogs(data.logs || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить почтовые рассылки');
      setLogs([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    try {
      const { data } = await email.cancelScheduled(id);
      // Рассылку из порций сервер отменяет целиком: «отменить» человек нажимает
      // на рассылку, а не на один её день, и забытая порция ушла бы сама через
      // неделю. Сколько строк при этом погасло — говорим, иначе исчезновение
      // девяти соседних выглядит сбоем.
      toast.success(data?.canceled > 1
        ? `Отменены все ${data.canceled} порций рассылки`
        : 'Отложенная отправка отменена');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отменить');
    }
  };

  /*
    Пока собирается письмо, вкладка показывает только конструктор.
    Раньше он открывался модальным окном поверх истории; в рабочей области ему
    и просторнее, и честнее — составление письма это не всплывающая мелочь, а
    основное занятие на ближайшие полчаса.
  */
  if (compose) {
    return (
      <EmailComposer
        initialDraft={compose.id ? compose : null}
        onClose={() => { setCompose(null); load(); }}
      />
    );
  }

  return (
    <section className="ann-email">
      <div className="ann-email-toolbar">
        {canEdit ? (
          <button className="ola-btn primary" onClick={() => setCompose({})}>
            <Plus size={15} /> Новая почтовая рассылка
          </button>
        ) : <span />}
        <button className="ola-btn" onClick={load} title="Обновить"><RefreshCw size={15} /></button>
      </div>

      <div className="ola-card">
        <header><span className="ola-card-icon accent"><Mail size={17} /></span><h3>История</h3></header>
        <div className="ola-card-body ann-email-list">
          {logs === null && <div className="ola-loading">Загрузка…</div>}
          {logs?.length === 0 && <div className="ola-empty"><Mail size={28} /><span>Почтовых рассылок пока нет</span></div>}
          {logs?.map(log => (
            <article className="ann-email-item" key={log.id}>
              <div>
                <strong>{log.subject}</strong>
                <span>
                  {log.sender?.displayName || log.sender?.username || 'Система'} · {log.recipients?.length || 0} получателей
                  {/* Порция рассылки, растянутой по дням (ver. 8.57). Без этой
                      подписи десять строк с одинаковой темой читаются как
                      десять разных рассылок, отправленных по ошибке. */}
                  {log.partTotal > 1 && (
                    <em className="ann-email-part">
                      <CalendarRange size={12} /> порция {log.partIndex} из {log.partTotal}
                    </em>
                  )}
                </span>
              </div>
              <div className="ann-email-state">
                <span className={`ola-badge ${log.status === 'failed' ? 'bad' : ['scheduled', 'sending'].includes(log.status) ? 'wait' : log.status === 'canceled' ? 'muted' : 'ok'}`}>
                  {log.status === 'scheduled' && <Clock size={12} />}
                  {EMAIL_STATUS[log.status] || log.status}
                </span>
                <time>{fmt(log.scheduledAt || log.sentAt || log.createdAt)}</time>
                {canEdit && log.status === 'scheduled' && <button className="ola-btn ann-repeat danger" onClick={() => cancel(log.id)}>Отменить</button>}
                {canEdit && <button className="ola-btn ann-repeat" onClick={() => setCompose(log)}><Copy size={13} /> Повторить</button>}
              </div>
            </article>
          ))}
        </div>
      </div>

      <EmailDailyLimit canEdit={canEdit} />
      <EmailOptouts canEdit={canEdit} />
    </section>
  );
}

export default function MailingsTab({ level }) {
  // Обёртка с тем же классом, что была у подвкладок: на неё опирается правило
  // .content-wrapper:has(.email-composer) в Layout.css, когда конструктор
  // занимает рабочую область.
  return (
    <div className="mk-subtabs-wrap">
      <EmailAnnouncements canEdit={level === 'edit'} />
    </div>
  );
}
