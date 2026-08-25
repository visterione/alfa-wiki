import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { anketa } from '../../services/api';
import './Anketa.css';

/**
 * Выбор услуг врачом.
 *
 * Список приходит из «Реновации» по его специальностям и филиалу — getServices
 * принимает profession_id и clinic_id, поэтому и набор, и цены получаются ровно
 * те, что действуют в этом филиале.
 *
 * Позиций бывает под две сотни, поэтому отметка идёт разделами целиком: без
 * этого человек бросает список на середине. Длительность можно переопределить —
 * она уедет в doctor_service_durations, откуда её берёт онлайн-запись.
 */
export default function AnketaServices() {
  const { token } = useParams();

  const [services, setServices] = useState([]);
  const [custom, setCustom] = useState([]);
  const [open, setOpen] = useState({});
  const [state, setState] = useState({ loading: true, error: '', submitted: false, done: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await anketa.servicesList(token);
        setServices(data.services || []);
        setCustom(data.custom || []);
        setState({ loading: false, error: '', submitted: data.submitted, done: data.submitted });
      } catch (e) {
        setState({
          loading: false,
          error: e.response?.data?.message || 'Не удалось загрузить список услуг',
          submitted: false,
          done: false
        });
      }
    })();
  }, [token]);

  const specialties = useMemo(() => {
    const map = new Map();
    for (const service of services) {
      const serviceSpecialties = service.specialties?.length
        ? service.specialties
        : [{ id: 'other', name: 'Без специальности' }];

      for (const specialty of serviceSpecialties) {
        const specialtyKey = String(specialty.id || specialty.name);
        if (!map.has(specialtyKey)) {
          map.set(specialtyKey, { key: specialtyKey, name: specialty.name, categories: new Map() });
        }
        const category = service.category || 'Прочее';
        const categories = map.get(specialtyKey).categories;
        if (!categories.has(category)) categories.set(category, []);
        categories.get(category).push(service);
      }
    }
    return [...map.values()]
      .map(specialty => ({
        ...specialty,
        categories: [...specialty.categories.entries()]
          .map(([name, items]) => ({ name, items }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [services]);

  const chosenCount = services.filter(s => s.chosen).length + custom.length;

  const patch = (serviceId, changes) => {
    setServices(prev => prev.map(s => (s.serviceId === serviceId ? { ...s, ...changes } : s)));
  };

  const toggleGroup = (items, value) => {
    const ids = new Set(items.map(s => s.serviceId));
    setServices(prev => prev.map(s => (ids.has(s.serviceId) ? { ...s, chosen: value } : s)));
  };

  const save = async (silent = false) => {
    setSaving(true);
    try {
      await anketa.saveServices(token, {
        services: services.filter(s => s.chosen).map(s => ({
          serviceId: s.serviceId, code: s.code, title: s.title, price: s.price,
          duration: s.duration, doctorDuration: s.doctorDuration, comment: s.comment
        })),
        custom: custom.filter(c => c.title)
      });
      if (!silent) setState(prev => ({ ...prev, error: '' }));
      return true;
    } catch (e) {
      setState(prev => ({ ...prev, error: e.response?.data?.message || 'Не удалось сохранить выбор' }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!(await save(true))) return;
    try {
      await anketa.submitServices(token);
      setState(prev => ({ ...prev, done: true, error: '' }));
    } catch (e) {
      setState(prev => ({ ...prev, error: e.response?.data?.message || 'Не удалось отправить список' }));
    }
  };

  if (state.loading) {
    return <div className="ank"><div className="ank__wrap"><p>Загружаем услуги…</p></div></div>;
  }

  if (state.done) {
    return (
      <div className="ank"><div className="ank__wrap">
        <div className="ank__head"><h1>Спасибо</h1></div>
        <div className="ank__note ank__note--ok">
          Список отправлен. Дальше от вас ничего не требуется.
        </div>
      </div></div>
    );
  }

  return (
    <div className="ank">
      <div className="ank__wrap">
        <div className="ank__head">
          <h1>Услуги</h1>
          <p>Отметьте то, что будете оказывать</p>
        </div>

        {state.error && <div className="ank__note ank__note--bad">{state.error}</div>}

        {!state.error && !services.length && (
          <div className="ank__note ank__note--warn">
            По вашей специальности услуг не нашлось — впишите нужные ниже.
          </div>
        )}

        {specialties.map(specialty => {
          const specialtyItems = specialty.categories.flatMap(category => category.items);
          const specialtyChosen = new Set(specialtyItems.filter(s => s.chosen).map(s => s.serviceId)).size;

          return (
            <section className="ank__specialty" key={specialty.key}>
              <div className="ank__specialty-head">
                <h2>{specialty.name}</h2>
                <span>{specialtyChosen} из {new Set(specialtyItems.map(s => s.serviceId)).size}</span>
              </div>

              {specialty.categories.map(category => {
                const groupKey = `${specialty.key}:${category.name}`;
                const allChosen = category.items.every(s => s.chosen);
                const chosen = category.items.filter(s => s.chosen).length;
                const isOpen = open[groupKey] ?? false;

                return (
                  <div className="ank__group" key={groupKey}>
                    <div className="ank__group-head" onClick={() => setOpen(prev => ({ ...prev, [groupKey]: !isOpen }))}>
                      <input
                        type="checkbox"
                        checked={allChosen}
                        onChange={(e) => { e.stopPropagation(); toggleGroup(category.items, e.target.checked); }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Выбрать все услуги в разделе ${category.name}`}
                      />
                      <b>{category.name}</b>
                      <span className="ank__group-count">{chosen} из {category.items.length}</span>
                      <span className="ank__group-count" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                    </div>

                    {isOpen && category.items.map(service => (
                      <ServiceCard key={service.serviceId} service={service} patch={patch} />
                    ))}
                  </div>
                );
              })}
            </section>
          );
        })}

        <div className="ank__card">
          <h2>Нет в списке</h2>
          <p className="ank__hint">Впишите услуги, которых не нашлось</p>
          {custom.map((item, index) => (
            <div className="ank__field" key={index}>
              <input
                type="text"
                value={item.title || ''}
                placeholder="Название услуги"
                onChange={(e) => setCustom(prev => prev.map((c, i) => (i === index ? { ...c, title: e.target.value } : c)))}
              />
            </div>
          ))}
          <button className="ank__btn ank__btn--ghost" type="button" onClick={() => setCustom(prev => [...prev, { title: '' }])}>
            Добавить услугу
          </button>
        </div>

        <div className="ank__bar">
          <span>Отмечено: {chosenCount}</span>
          <button className="ank__btn ank__btn--ghost" onClick={() => save(false)} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить черновик'}
          </button>
          <button className="ank__btn" onClick={submit} disabled={saving || !chosenCount}>
            Отправить список
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceCard({ service, patch }) {
  const price = service.price != null ? `${service.price.toLocaleString('ru-RU')} ₽` : null;
  const duration = service.duration ? `${service.duration} мин` : null;

  return (
    <article className={`ank__srv${service.chosen ? ' is-chosen' : ''}`}>
      <label className="ank__srv-top">
        <input
          type="checkbox"
          checked={Boolean(service.chosen)}
          onChange={(e) => patch(service.serviceId, { chosen: e.target.checked })}
        />
        <span className="ank__srv-main">
          <span className="ank__srv-title">{service.title}</span>
          {(service.code || price || duration) && (
            <span className="ank__srv-meta">
              {[service.code, price, duration].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      </label>

      {service.chosen && (
        <div className="ank__srv-extra">
          <label>
            <span>Длительность, мин</span>
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={240}
              placeholder={service.duration ? String(service.duration) : 'мин'}
              value={service.doctorDuration ?? ''}
              onChange={(e) => patch(service.serviceId, {
                doctorDuration: e.target.value === '' ? null : Number(e.target.value)
              })}
            />
          </label>
          <label className="ank__srv-comment">
            <span>Комментарий</span>
            <textarea
              rows={3}
              placeholder="Условия, оборудование, ограничения"
              value={service.comment || ''}
              onChange={(e) => patch(service.serviceId, { comment: e.target.value })}
            />
          </label>
        </div>
      )}
    </article>
  );
}
