import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { warehouseApi } from '../services/api';
import './PublicAssetCard.css';

/**
 * Цифровой паспорт оборудования и карточка кабинета — публичные страницы по QR.
 *
 * Живут вне Layout и вне ProtectedRoute: человек подходит к прибору с телефоном,
 * на котором портал не залогинен, и обязан увидеть карточку, а не форму входа.
 *
 * Набор полей узкий по замыслу. Стоимости, амортизации, ФИО ответственного и
 * внутренних документов здесь нет — обоснование в комментарии
 * backend/services/warehouse/qr.js. Коротко: ссылка рано или поздно окажется
 * снаружи, и её утечка не должна ничего стоить.
 *
 * Страница намеренно не зависит от темы и шрифтов портала: её открывают с
 * телефона по одному разу, и она должна отрисоваться быстро и одинаково везде.
 */

const STATUS_TONE = {
  in_use: 'ok', maintenance: 'warn', repair: 'bad',
  storage: 'muted', written_off: 'muted', reserved: 'muted',
};

export default function PublicAssetCard({ kind = 'asset' }) {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = kind === 'room' ? warehouseApi.publicRoom : warehouseApi.publicAsset;
    load(token)
      .then(({ data: res }) => setData(res))
      .catch(e => setError(
        e.response?.status === 404
          ? 'Карточка не найдена. Возможно, оборудование снято с учёта или QR-код устарел.'
          : e.response?.status === 429
            ? 'Слишком много запросов. Попробуйте через минуту.'
            : 'Не удалось загрузить карточку.'
      ));
  }, [token, kind]);

  if (error) {
    return (
      <div className="pac">
        <div className="pac__card pac__card--error">
          <div className="pac__error-icon">!</div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="pac"><div className="pac__card"><div className="pac__skeleton" /></div></div>;
  }

  if (kind === 'room') return <RoomCard data={data} />;

  const tone = STATUS_TONE[data.status] || 'muted';
  const maintenanceDone = (data.maintenance || []).filter(m => m.factDate);
  const nextMaintenance = data.nextMaintenanceDate;
  const overdue = nextMaintenance && nextMaintenance < today();

  return (
    <div className="pac">
      <div className="pac__card">
        <div className="pac__head">
          <div className="pac__kicker">Паспорт оборудования</div>
          <h1 className="pac__title">{data.name}</h1>
          {data.model && <div className="pac__model">{data.model}</div>}
          <div className={`pac__status pac__status--${tone}`}>{data.statusLabel}</div>
        </div>

        <dl className="pac__rows">
          <Row label="Инвентарный номер" value={data.inventoryNumber} mono />
          {data.serialNumber && <Row label="Серийный номер" value={data.serialNumber} mono />}
          {data.manufacturer && <Row label="Производитель" value={data.manufacturer} />}
          {data.location && (
            <>
              <Row label="Расположение" value={data.location.room} />
              {data.location.department && <Row label="Отделение" value={data.location.department} />}
              {(data.location.floor || data.location.building) && (
                <Row label="Корпус и этаж"
                     value={[data.location.building, data.location.floor].filter(Boolean).join(', ')} />
              )}
            </>
          )}
          {data.responsible && (
            <Row label="Ответственный" value={`${data.responsible.role}, ${data.responsible.department}`} />
          )}
          {data.commissioningDate && <Row label="Введено в эксплуатацию" value={fmt(data.commissioningDate)} />}
          {data.warrantyUntil && <Row label="Гарантия до" value={fmt(data.warrantyUntil)} />}
        </dl>

        <section className="pac__section">
          <h2>Техническое обслуживание</h2>
          {nextMaintenance ? (
            <div className={`pac__maint ${overdue ? 'pac__maint--overdue' : ''}`}>
              <div className="pac__maint-label">{overdue ? 'ТО просрочено' : 'Следующее ТО'}</div>
              <div className="pac__maint-date">{fmt(nextMaintenance)}</div>
            </div>
          ) : (
            <p className="pac__muted">Плановое ТО не назначено</p>
          )}

          {maintenanceDone.length > 0 && (
            <ul className="pac__history">
              {maintenanceDone.slice(0, 6).map((m, i) => (
                <li key={i}>
                  <span className="pac__history-date">{fmt(m.factDate)}</span>
                  <span>{maintType(m.type)}</span>
                  <span className={`pac__chip pac__chip--${m.result === 'normal' ? 'ok' : m.result === 'failed' ? 'bad' : 'warn'}`}>
                    {maintResult(m.result)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(data.repairs || []).length > 0 && (
          <section className="pac__section">
            <h2>Ремонты</h2>
            <ul className="pac__history">
              {data.repairs.slice(0, 6).map((r, i) => (
                <li key={i}>
                  <span className="pac__history-date">{fmt(r.startedAt)}</span>
                  <span>{r.finishedAt ? `завершён ${fmt(r.finishedAt)}` : 'в работе'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(data.timeline || []).length > 0 && (
          <section className="pac__section">
            <h2>История перемещений</h2>
            <ul className="pac__history">
              {data.timeline.slice(0, 10).map((t, i) => (
                <li key={i}>
                  <span className="pac__history-date">{fmt(t.occurredAt)}</span>
                  <span>{moveType(t.type)}</span>
                </li>
              ))}
            </ul>
            {/* Объясняем скудность истории, иначе она читается как неполнота данных. */}
            <p className="pac__note">
              На публичной странице показаны только даты и типы операций. Кто передавал
              оборудование и по какой причине — во внутреннем журнале портала.
            </p>
          </section>
        )}

        {(data.files || []).length > 0 && (
          <section className="pac__section">
            <h2>Документы</h2>
            <ul className="pac__files">
              {data.files.map((f, i) => (
                <li key={i}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></li>
              ))}
            </ul>
          </section>
        )}

        <footer className="pac__foot">
          Страница только для чтения. Данные актуальны на момент открытия.
        </footer>
      </div>
    </div>
  );
}

function RoomCard({ data }) {
  const { room, assets } = data;
  return (
    <div className="pac">
      <div className="pac__card">
        <div className="pac__head">
          <div className="pac__kicker">Кабинет</div>
          <h1 className="pac__title">{room.number}</h1>
          {room.name && <div className="pac__model">{room.name}</div>}
        </div>

        <dl className="pac__rows">
          {room.department && <Row label="Отделение" value={room.department} />}
          {(room.building || room.floor) && (
            <Row label="Расположение" value={[room.building, room.floor].filter(Boolean).join(', ')} />
          )}
          <Row label="Единиц оборудования" value={assets.length} />
        </dl>

        <section className="pac__section">
          <h2>Оборудование кабинета</h2>
          <ul className="pac__assets">
            {assets.map((a, i) => (
              <li key={i}>
                <a href={a.cardUrl}>
                  <div className="pac__assets-name">{a.name}</div>
                  {a.model && <div className="pac__assets-model">{a.model}</div>}
                  <div className="pac__assets-meta">
                    <span className="pac__mono">{a.inventoryNumber}</span>
                    <span className={`pac__chip pac__chip--${STATUS_TONE[a.status] || 'muted'}`}>
                      {a.statusLabel}
                    </span>
                    {a.nextMaintenanceDate && <span>ТО до {fmt(a.nextMaintenanceDate)}</span>}
                  </div>
                </a>
              </li>
            ))}
            {!assets.length && <li className="pac__muted">Оборудование не закреплено</li>}
          </ul>
        </section>

        <footer className="pac__foot">
          Страница только для чтения. Остатки материалов и стоимость не отображаются.
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'pac__mono' : ''}>{value}</dd>
    </>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fmt = d => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const maintType = t => ({
  maintenance: 'Техобслуживание', verification: 'Поверка', calibration: 'Калибровка',
  dosimetry: 'Дозиметрический контроль', inspection: 'Осмотр',
}[t] || t);
const maintResult = r => ({ normal: 'Норма', with_remarks: 'С замечаниями', failed: 'Не пройдено' }[r] || '—');
const moveType = t => ({
  receipt: 'Поставлено на учёт', issue: 'Выдача', transfer: 'Перемещение',
  repair_out: 'Передано в ремонт', repair_in: 'Возвращено из ремонта',
  writeoff: 'Списано', inventory: 'Инвентаризация', surplus: 'Оприходовано',
}[t] || t);
