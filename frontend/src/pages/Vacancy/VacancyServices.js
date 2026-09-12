/**
 * Выбор услуг кандидатом (ver. 8.20).
 *
 * Список приходит из «Реновации» по его специальностям и филиалу: getServices
 * принимает profession_id и clinic_id, поэтому и набор, и цены получаются ровно
 * те, что действуют в этом филиале.
 *
 * Позиций бывает под две сотни, поэтому отметка идёт разделами целиком: без
 * этого человек бросает список на середине. Длительность можно переопределить —
 * она уедет в doctor_service_durations, откуда её берёт онлайн-запись.
 *
 * Сохранение по кнопке, а не на каждую галочку: человек отмечает разделы
 * пачками, и десятки мелких запросов на одном экране — это гарантированные
 * гонки между ними.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { vacancyPublic as api } from '../../services/api';
import './Vacancy.css';

export default function VacancyServices() {
  const { token } = useParams();

  const [services, setServices] = useState([]);
  const [custom, setCustom] = useState([]);
  const [openGroups, setOpenGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vacancy, setVacancy] = useState(null);

  useEffect(() => {
    let alive = true;
    api.services(token)
      .then(({ data }) => {
        if (!alive) return;
        setServices(data.services || []);
        setCustom(data.custom || []);
        setSubmitted(Boolean(data.submitted));
        setVacancy(data.vacancy || null);
      })
      .catch(err => { if (alive) setError(err.response?.data?.message || 'Не удалось загрузить список услуг'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  // Группируем по разделу прайса: двести строк подряд не читаются, а разделы
  // человек узнаёт — по ним он и работает.
  const groups = useMemo(() => {
    const map = new Map();
    for (const service of services) {
      const name = service.category || 'Прочее';
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(service);
    }
    return [...map.entries()]
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [services]);

  const chosenCount = services.filter(s => s.chosen).length + custom.length;

  const setService = (serviceId, patch) => {
    setServices(prev => prev.map(s => (s.serviceId === serviceId ? { ...s, ...patch } : s)));
  };

  const toggleGroup = (group, value) => {
    const ids = new Set(group.items.map(i => i.serviceId));
    setServices(prev => prev.map(s => (ids.has(s.serviceId) ? { ...s, chosen: value } : s)));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.saveServices(token, {
        services: services.filter(s => s.chosen).map(s => ({
          serviceId: s.serviceId,
          code: s.code,
          title: s.title,
          price: s.price,
          duration: s.duration,
          doctorDuration: s.doctorDuration,
          comment: s.comment
        })),
        custom: custom.map(c => ({ title: c.title, comment: c.comment }))
      });
      return true;
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось сохранить выбор');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!chosenCount) { setError('Отметьте хотя бы одну услугу'); return; }
    // Сначала сохраняем, потом отправляем: иначе отправится то, что лежало в
    // базе с прошлого захода, а не то, что человек видит на экране.
    if (!(await save())) return;
    setBusy(true);
    try {
      await api.submitServices(token);
      setSubmitted(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось отправить список');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Shell><div className="vcy-note">Загружаем список услуг…</div></Shell>;

  if (error && !services.length) {
    return (
      <Shell>
        <h1>Список недоступен</h1>
        <p className="vcy-lead">{error}</p>
      </Shell>
    );
  }

  if (submitted) {
    return (
      <Shell vacancy={vacancy}>
        <h1>Список отправлен</h1>
        <p className="vcy-lead">
          Спасибо. Отмеченные услуги ушли тому, кто вносит их в систему. Если
          что-то нужно поправить — напишите нам, список ещё можно изменить руками.
        </p>
      </Shell>
    );
  }

  return (
    <Shell vacancy={vacancy}>
      <h1>Услуги, которые вы будете оказывать</h1>
      <p className="vcy-lead">
        Список подтянут по вашей специальности и филиалу. Отмечайте разделами
        целиком, а если по какой-то услуге вам нужно больше или меньше времени —
        поправьте длительность.
      </p>

      {groups.map(group => {
        const chosen = group.items.filter(i => i.chosen).length;
        const isOpen = openGroups[group.name] ?? chosen > 0;
        return (
          <section className="vcy-group" key={group.name}>
            <header>
              <button
                type="button"
                className="vcy-group-title"
                onClick={() => setOpenGroups(prev => ({ ...prev, [group.name]: !isOpen }))}
              >
                {isOpen ? '▾' : '▸'} {group.name}
                <span>{chosen ? `${chosen} из ${group.items.length}` : `${group.items.length}`}</span>
              </button>
              <button
                type="button"
                className="vcy-group-all"
                onClick={() => toggleGroup(group, chosen !== group.items.length)}
              >
                {chosen === group.items.length ? 'снять все' : 'отметить все'}
              </button>
            </header>

            {isOpen && group.items.map(service => (
              <div className={`vcy-service ${service.chosen ? 'is-on' : ''}`} key={service.serviceId}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(service.chosen)}
                    onChange={e => setService(service.serviceId, { chosen: e.target.checked })}
                  />
                  <span>
                    {service.title}
                    {service.price != null && <small>{Number(service.price).toLocaleString('ru-RU')} ₽</small>}
                  </span>
                </label>

                {service.chosen && (
                  <div className="vcy-service-more">
                    <label>
                      Длительность, мин
                      <input
                        type="number"
                        min="5"
                        max="240"
                        placeholder={service.duration ?? ''}
                        value={service.doctorDuration ?? ''}
                        onChange={e => setService(service.serviceId, {
                          doctorDuration: e.target.value === '' ? null : Number(e.target.value)
                        })}
                      />
                    </label>
                    <label>
                      Условия или оговорки
                      <input
                        type="text"
                        value={service.comment || ''}
                        placeholder="необязательно"
                        onChange={e => setService(service.serviceId, { comment: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      })}

      {/* Позиции, которых нет в прайсе. Заведение такой услуги — отдельный
          процесс с ценообразованием, он может тянуться неделями и выход
          человека на работу не блокирует. */}
      <section className="vcy-group">
        <header>
          <span className="vcy-group-title">Нет в списке</span>
          <button type="button" className="vcy-group-all" onClick={() => setCustom(prev => [...prev, { title: '', comment: '' }])}>
            добавить свою
          </button>
        </header>
        {custom.map((item, index) => (
          <div className="vcy-service is-on" key={index}>
            <div className="vcy-service-more">
              <label>
                Что это за услуга
                <input
                  type="text"
                  value={item.title}
                  onChange={e => setCustom(prev => prev.map((c, i) => (i === index ? { ...c, title: e.target.value } : c)))}
                />
              </label>
              <label>
                Пояснение
                <input
                  type="text"
                  value={item.comment || ''}
                  onChange={e => setCustom(prev => prev.map((c, i) => (i === index ? { ...c, comment: e.target.value } : c)))}
                />
              </label>
            </div>
            <button type="button" className="vcy-group-all" onClick={() => setCustom(prev => prev.filter((_, i) => i !== index))}>
              убрать
            </button>
          </div>
        ))}
      </section>

      {error && <div className="vcy-error">{error}</div>}

      <div className="vcy-nav">
        <span className="vcy-saved">Отмечено: {chosenCount}</span>
        <button type="button" className="vcy-btn is-ghost" disabled={busy} onClick={save}>Сохранить</button>
        <button type="button" className="vcy-btn" disabled={busy} onClick={submit}>Отправить список</button>
      </div>
    </Shell>
  );
}

function Shell({ vacancy, children }) {
  return (
    <div className="vcy">
      <div className="vcy-card">
        {vacancy && <div className="vcy-branch">{vacancy.title}</div>}
        {children}
      </div>
    </div>
  );
}
