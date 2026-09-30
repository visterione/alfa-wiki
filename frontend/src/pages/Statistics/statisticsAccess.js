// Доступ к вкладкам статистики (ver. 9.17).
//
// Права задаются галочками в карточке пользователя (permissionCatalogue.js →
// user.statisticsTabs). До 9.17 они нигде не хранились и ничего не закрывали —
// теперь каждая вкладка спрашивает здесь.
//
// Нет ключа — вкладка открыта. Закрывает её только явное false: иначе любая
// новая вкладка с первого дня была бы скрыта от всех, кому права настраивали
// раньше, чем она появилась.

// Вкладка страницы → ключ права. Вкладки без ключа (804н, «Открытая линия»)
// открыты всем, кто дошёл до раздела: у «Открытой линии» свой доступ — по
// составу линии.
export const KPI_TAB_PERM = {
  general: 'kpiGeneral', patients: 'kpiPatients', margin: 'kpiMargin', efficiency: 'kpiEfficiency',
  rooms: 'kpiRooms', reputation: 'kpiReputation', utilities: 'kpiUtilities', consumables: 'kpiConsumables',
  serviceCost: 'kpiServiceCost', debtors: 'kpiDebtors', refunds: 'kpiRefunds', bots: 'kpiBots',
  inpatient: 'kpiInpatient', schedules: 'kpiSchedules',
};
export const DIR_TAB_PERM = {
  clinics: 'dirClinics', cabinets: 'dirCabinets', doctors: 'dirDoctors', equipment: 'dirEquipment',
  utilities: 'dirUtilities', consumables: 'dirConsumables', marketing: 'dirMarketing',
};
export const SVC_TAB_PERM = { services: 'svcServices', 'partner-services': 'svcPartnerServices' };

// Разделы PDF-отчёта аналитики → вкладка, чьи данные они печатают. Закрытую
// вкладку нельзя обойти выгрузкой.
export const PDF_SECTION_PERM = {
  general: 'kpiGeneral', patients: 'kpiPatients', top20: 'kpiPatients', margin: 'kpiMargin',
  efficiency: 'kpiEfficiency', rooms: 'kpiRooms', reputation: 'kpiReputation', debtors: 'kpiDebtors',
  bots: 'kpiBots', schedules: 'kpiSchedules',
};

export function canSeeStatTab(user, permKey) {
  if (!permKey || user?.isAdmin) return true;
  return user?.statisticsTabs?.[permKey] !== false;
}

/** Вкладки из списка { key }, которые пользователю видны. */
export function visibleTabs(user, tabs, permMap) {
  return tabs.filter(t => canSeeStatTab(user, permMap[t.key]));
}
