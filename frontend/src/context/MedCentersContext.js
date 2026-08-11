import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { medCenters as medCentersApi } from '../services/api';
import { useAuth } from './AuthContext';

/**
 * Справочник медцентров на фронте.
 *
 * До ver. 6.67 список клиник с цветами был скопирован по коду с десяток раз, и копии
 * успели разойтись — у Линии было четыре разных цвета. Модули переезжают сюда по
 * одному. Зарплатный модуль (ReferralBonuses) намеренно оставлен на своём списке в
 * clinicUtils.js: он слишком велик, чтобы переводить его заодно, и поедет отдельно.
 *
 * Грузим один раз на сессию: справочник меняется раз в полгода, а нужен почти
 * каждому экрану. Пока не загрузился, byMisId и остальные резолверы возвращают
 * null/фолбэк — экраны на этом не должны падать, у клиники всегда есть запасной
 * серый кружок.
 */

const EMPTY = [];

const MedCentersContext = createContext({
  medCenters: EMPTY,
  loading: true,
  error: null,
  reload: () => {},
  byId: () => null,
  byCode: () => null,
  byMisId: () => null,
  colorByMisId: () => '#94a3b8',
  nameByMisId: () => '',
  logoByMisId: () => null
});

const FALLBACK_COLOR = '#94a3b8';

export function MedCentersProvider({ children }) {
  const { user } = useAuth();
  const [medCenters, setMedCenters] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Служебные группировки нужны отчётам: «Направители» и «АУП» приходят в
      // зарплатных данных как обычный clinic_id, и без них резолвер вернул бы null.
      const { data } = await medCentersApi.list({ includeVirtual: true });
      setMedCenters(Array.isArray(data) ? data : EMPTY);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Только под аутентификацией: на странице входа запрос дал бы 401 и красный
  // шум в консоли. При смене пользователя перечитываем — справочник общий, но
  // повторный заход не должен показывать список, оставшийся от прошлой сессии.
  useEffect(() => {
    if (!user) {
      setMedCenters(EMPTY);
      setLoading(false);
      return;
    }
    reload();
  }, [user, reload]);

  // Индексы, а не find по массиву: резолверы зовут в циклах по строкам отчёта.
  const index = useMemo(() => {
    const byId = new Map();
    const byCode = new Map();
    const byMisId = new Map();
    for (const mc of medCenters) {
      byId.set(String(mc.id), mc);
      if (mc.code) byCode.set(mc.code, mc);
      for (const misId of mc.misClinicIds || []) byMisId.set(String(misId), mc);
    }
    return { byId, byCode, byMisId };
  }, [medCenters]);

  const value = useMemo(() => {
    // Принимает и объект клиники из МИС ({ id, name }), и голый id — в ответах МИС
    // встречается и то, и другое.
    const byMisId = (clinic) => {
      if (clinic === null || clinic === undefined || clinic === '') return null;
      const raw = typeof clinic === 'object' ? clinic.id : clinic;
      return index.byMisId.get(String(raw)) || null;
    };

    return {
      medCenters,
      loading,
      error,
      reload,
      byId: (id) => (id ? index.byId.get(String(id)) || null : null),
      byCode: (code) => (code ? index.byCode.get(String(code)) || null : null),
      byMisId,
      colorByMisId: (clinic, fallback = FALLBACK_COLOR) => byMisId(clinic)?.color || fallback,
      // Неизвестный id показываем как есть — в отчёте это заметнее пустой ячейки.
      nameByMisId: (clinic) => {
        const mc = byMisId(clinic);
        if (mc) return mc.name;
        const raw = typeof clinic === 'object' ? clinic?.id : clinic;
        return raw == null ? '' : String(raw);
      },
      logoByMisId: (clinic) => {
        const mc = byMisId(clinic);
        const path = mc?.logoSquareUrl || mc?.logoUrl;
        return path ? (process.env.PUBLIC_URL || '') + path : null;
      }
    };
  }, [medCenters, loading, error, reload, index]);

  return (
    <MedCentersContext.Provider value={value}>
      {children}
    </MedCentersContext.Provider>
  );
}

export function useMedCenters() {
  return useContext(MedCentersContext);
}

export default MedCentersContext;
