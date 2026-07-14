import React, { useState } from 'react';
import { rbCanonicalClinicId } from '../utils/clinicUtils';

// ═══════════════════════════════════════
// ЛОГОТИПЫ МЕДЦЕНТРОВ (клиник)
// ═══════════════════════════════════════
// Показываются в переключателях медцентров: вкладка «Сотрудники» (карточка врача),
// «Услуги» и «Направления».
//
// Как добавить логотип:
// 1) Положите файл в  frontend/public/lab-logos/  (лучше квадрат 1:1, PNG с
//    прозрачным фоном, ~64–128px — в кружке он рисуется ~18px).
// 2) Пропишите ниже соответствие «id клиники → путь от /lab-logos/».
//    id — канонический id медцентра из МИС (см. DEFAULT_CLINICS в clinicUtils.js).
//
// Если файла нет или он не загрузился — вместо логотипа автоматически рисуется
// цветной кружок медцентра (фолбэк), так что можно смело прописывать пути к ещё
// не добавленным файлам — они «оживут» сами, как только файл появится.
export const CLINIC_LOGOS = {
  '2':  '/lab-logos/alfa.png',         // Альфа
  '3':  '/lab-logos/alfa-kids.png',    // Кидс
  '1':  '/lab-logos/alfa-prof.jpg',    // Проф
  '6':  '/lab-logos/alfa-liniya.png',  // Линия
  '4':  '/lab-logos/alfa-3k.png',      // 3К
  '7':  '/lab-logos/alfa-smile.jpeg',  // Смайл
  '11': '/lab-logos/alfa-sukko.jpg',   // Сукко
  'ip': '/lab-logos/ip-mikaelyan.png', // ИП Микаелян — положите файл
  // '8'  Направители — служебный медцентр, логотип не нужен
};

// Возвращает URL логотипа для медцентра или null, если соответствие не задано.
export function clinicLogoSrc(clinicId) {
  const path = CLINIC_LOGOS[rbCanonicalClinicId(clinicId)];
  return path ? (process.env.PUBLIC_URL || '') + path : null;
}

// Логотип медцентра с фолбэком на цветной кружок при отсутствии/ошибке файла.
export default function ClinicLogo({ clinicId, color = '#94a3b8', size = 18, dotSize, className = '' }) {
  const [err, setErr] = useState(false);
  const src = clinicLogoSrc(clinicId);
  if (src && !err) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setErr(true)}
        className={`rb-clinic-tab-logo ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`rb-clinic-tab-dot ${className}`}
      style={{ background: color, ...(dotSize ? { width: dotSize, height: dotSize } : {}) }}
    />
  );
}
