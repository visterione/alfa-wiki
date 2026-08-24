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

  const groups = useMemo(() => {
    const map = new Map();
    for (const service of services) {
      const key = service.category || 'Прочее';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(service);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [services]);

  const chosenCount = services.filter(s => s.chosen).length + custom.length;

  const patch = (serviceId, changes) => {
    setServices(prev => prev.map(s => (s.serviceId === serviceId ? { ...s, ...changes } : s)));
  };

  const toggleGroup = (name, value) => {
    const ids = new Set(groups.find(g => g[0] === name)[1].map(s => s.serviceId));
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

        {!services.length && (
          <div className="ank__note ank__note--warn">
            По вашей специальности услуг не нашлось — впишите нужные ниже.
          </div>
        )}

        {groups.map(([name, items]) => {
          const allChosen = items.every(s => s.chosen);
          const chosen = items.filter(s => s.chosen).length;
          const isOpen = open[name] ?? false;

          return (
            <div className="ank__group" key={name}>
              <div className="ank__group-head" onClick={() => setOpen(prev => ({ ...prev, [name]: !isOpen }))}>
                <input
                  type="checkbox"
                  checked={allChosen}
                  onChange={(e) => { e.stopPropagation(); toggleGroup(name, e.target.checked); }}
                  onClick={(e) => e.stopPropagation()}
                />
                <b>{name}</b>
                <span className="ank__group-count">{chosen} из {items.length}</span>
                <span className="ank__group-count">{isOpen ? '▲' : '▼'}</span>
              </div>

              {isOpen && items.map(service => (
                <React.Fragment key={service.serviceId}>
                  <div className="ank__srv">
                    <input
                      type="checkbox"
                      checked={Boolean(service.chosen)}
                      onChange={(e) => patch(service.serviceId, { chosen: e.target.checked })}
                    />
                    <div>
                      <div className="ank__srv-title">{service.title}</div>
                      {service.code && <div className="ank__srv-code">{service.code}</div>}
                    </div>
                    <div className="ank__srv-price">
                      {service.price != null ? `${service.price.toLocaleString('ru-RU')} ₽` : '—'}
                    </div>
                    <input
                      type="number"
                      min={5}
                      max={240}
                      placeholder={service.duration ? String(service.duration) : 'мин'}
                      value={service.doctorDuration ?? ''}
                      disabled={!service.chosen}
                      onChange={(e) => patch(service.serviceId, {
                        doctorDuration: e.target.value === '' ? null : Number(e.target.value)
                      })}
                    />
                  </div>
                  {service.chosen && (
                    <div className="ank__srv">
                      <span />
                      <div className="ank__srv-comment">
                        <input
                          type="text"
                          placeholder="Комментарий: условия, оборудование, ограничения"
                          value={service.comment || ''}
                          onChange={(e) => patch(service.serviceId, { comment: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
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
