import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  FileSpreadsheet, FileText, AlertTriangle, ArrowRightLeft, Play,
  ChevronRight, ChevronDown, Minimize2, Maximize2, ListTree, FolderTree,
  Mail, X, Check,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Отчёты складского модуля.
 *
 * Все отчёты описываются одной таблицей REPORTS: колонки, параметры и способ
 * загрузки. Это позволяет иметь один экран, одну выгрузку и одну шапку на все
 * одиннадцать отчётов — вместо одиннадцати почти одинаковых компонентов, которые
 * разъехались бы после первой же правки формата.
 *
 * Колонки описаны здесь, а не приходят с бэкенда: их состав — вопрос вида, а не
 * данных, и держать вид рядом с данными означало бы менять API при каждом
 * переименовании заголовка.
 */

const REPORTS = {
  turnover: {
    code: 'RPT-TURNOVER',
    title: 'Оборотно-сальдовая ведомость по локациям',
    needsPeriod: true,
    load: params => warehouseApi.turnover(params),
    tree: true,
    columns: [
      { key: 'label', title: 'Локация и номенклатура', type: 'tree' },
      { key: 'code', title: 'Код' },
      { key: 'unit', title: 'Ед.' },
      { key: 'openQty', title: 'Сальдо начало, кол-во', type: 'qty' },
      { key: 'openAmount', title: 'Сальдо начало, ₽', type: 'money' },
      { key: 'inQty', title: 'Приход, кол-во', type: 'qty' },
      { key: 'inAmount', title: 'Приход, ₽', type: 'money' },
      { key: 'outQty', title: 'Расход, кол-во', type: 'qty' },
      { key: 'outAmount', title: 'Расход, ₽', type: 'money' },
      { key: 'closeQty', title: 'Сальдо конец, кол-во', type: 'qty' },
      { key: 'closeAmount', title: 'Сальдо конец, ₽', type: 'money' },
      { key: 'sharePct', title: 'Доля, %', type: 'share' },
      { key: 'minQty', title: 'Мин. остаток', type: 'qty' },
      { key: 'status', title: 'Статус', type: 'stockStatus' },
    ],
  },
  consumption: {
    code: 'RPT-CONSUMPTION',
    title: 'Расход материалов по локациям',
    needsPeriod: true,
    load: params => warehouseApi.consumption(params),
    tree: true,
    columns: [
      { key: 'label', title: 'Локация и номенклатура', type: 'tree' },
      { key: 'unit', title: 'Ед.' },
      { key: 'qty', title: 'Кол-во за период', type: 'qty' },
      { key: 'amount', title: 'Сумма, ₽', type: 'money' },
      { key: 'prevQty', title: 'Кол-во пред. период', type: 'qty' },
      { key: 'prevAmount', title: 'Сумма пред. период, ₽', type: 'money' },
      { key: '_deltaQty', title: 'Δ количества', type: 'delta' },
      { key: 'deltaAmountPct', title: 'Δ суммы, %', type: 'percent' },
      { key: 'visits', title: 'Посещений', type: 'number' },
      { key: 'perVisit', title: 'На 1 посещение', type: 'qty' },
      { key: 'normPerVisit', title: 'Норма', type: 'qty' },
      { key: 'normDeviationPct', title: 'Откл. от нормы, %', type: 'percent' },
      { key: 'deptSharePct', title: 'Доля в расходе отделения, %', type: 'share' },
    ],
  },
  doctors: {
    code: 'RPT-CONSUMPTION-2',
    title: 'Расход материалов по врачам',
    needsPeriod: true,
    load: params => warehouseApi.consumption({ ...params, mode: 'doctors' }),
    columns: [
      { key: 'doctorName', title: 'Врач' },
      { key: 'departmentName', title: 'Отделение' },
      { key: 'operations', title: 'Операций / приёмов', type: 'number' },
      { key: 'amount', title: 'Расход, ₽', type: 'money' },
      { key: 'perOperation', title: 'На 1 операцию, ₽', type: 'money' },
      { key: 'medianBySpecialty', title: 'Медиана по специальности, ₽', type: 'money' },
      { key: 'deviationPct', title: 'Отклонение, %', type: 'percent' },
    ],
  },
  abc: {
    code: 'RPT-CONSUMPTION',
    title: 'ABC/XYZ-анализ номенклатуры',
    needsPeriod: true,
    load: params => warehouseApi.consumption({ ...params, mode: 'abc' }),
    render: 'abc',
    columns: [
      { key: 'code', title: 'Код' },
      { key: 'nomenclatureName', title: 'Наименование' },
      { key: 'unit', title: 'Ед.' },
      { key: 'qty', title: 'Расход за период', type: 'qty' },
      { key: 'amount', title: 'Сумма, ₽', type: 'money' },
      { key: 'sharePct', title: 'Доля в сумме, %', type: 'share' },
      { key: 'cumulativeSharePct', title: 'Накопленным итогом, %', type: 'share' },
      { key: 'cv', title: 'Коэф. вариации, %', type: 'share' },
      { key: 'monthsWithConsumption', title: 'Мес. с расходом', type: 'number' },
      { key: 'cell', title: 'Класс', type: 'abcCell' },
      { key: 'strategy', title: 'Стратегия запаса' },
    ],
  },
  expiring: {
    code: 'RPT-EXPIRING',
    title: 'Просроченные и истекающие позиции',
    load: params => warehouseApi.expiring({ ...params, horizonDays: 90 }),
    columns: [
      { key: 'zone', title: 'Зона', type: 'zone' },
      { key: 'nomenclatureName', title: 'Наименование' },
      { key: 'code', title: 'Код' },
      { key: 'batchNumber', title: 'Серия / партия' },
      { key: 'expiryDate', title: 'Срок годности', type: 'date' },
      { key: 'daysLeft', title: 'Осталось дней', type: 'number' },
      { key: 'quantity', title: 'Кол-во', type: 'qty' },
      { key: 'unit', title: 'Ед.' },
      { key: 'amount', title: 'Сумма, ₽', type: 'money' },
      { key: '_location', title: 'Локация' },
      { key: 'responsibleName', title: 'МОЛ' },
      { key: 'avgMonthly', title: 'Средний расход/мес', type: 'qty' },
      { key: '_forecast', title: 'Прогноз' },
      { key: 'recommendation', title: 'Рекомендация' },
      { key: 'supplierName', title: 'Поставщик' },
    ],
  },
  depreciation: {
    code: 'RPT-DEPRECIATION',
    title: 'Ведомость амортизации основных средств',
    needsPeriod: true,
    load: params => warehouseApi.depreciation(params),
    columns: [
      { key: 'inventoryNumber', title: 'Инв. №', type: 'assetLink' },
      { key: '_nameModel', title: 'Наименование, модель' },
      { key: '_categoryOkof', title: 'Категория / ОКОФ' },
      { key: 'commissioningDate', title: 'Ввод в эксплуатацию', type: 'date' },
      { key: 'usefulLifeMonths', title: 'СПИ, мес.', type: 'number' },
      { key: 'depreciationGroup', title: 'Аморт. группа', type: 'number' },
      { key: 'depreciationMethod', title: 'Способ', type: 'deprMethod' },
      { key: 'initialCost', title: 'Первоначальная, ₽', type: 'money' },
      { key: 'accumulatedStart', title: 'Накоплено на начало, ₽', type: 'money' },
      { key: 'accruedInPeriod', title: 'Начислено за период, ₽', type: 'money' },
      { key: 'accumulatedEnd', title: 'Накоплено на конец, ₽', type: 'money' },
      { key: 'residual', title: 'Остаточная, ₽', type: 'money' },
      { key: 'wearPercent', title: 'Износ, %', type: 'share' },
      { key: '_location', title: 'Локация' },
      { key: 'responsibleName', title: 'МОЛ' },
      { key: 'status', title: 'Статус', type: 'assetStatus' },
      { key: 'flag', title: 'Признак' },
      { key: 'forecastFullWearDate', title: 'Прогноз 100 % износа', type: 'date' },
    ],
  },
  // Отчёт № 6 ТЗ — три режима одного отчёта, а не три пункта меню: план-факт,
  // календарь предстоящих ТО и надёжность по моделям отвечают на разные вопросы
  // об одном и том же графике обслуживания.
  maintenance: {
    code: 'RPT-MAINTENANCE',
    title: 'Исполнение графика ТО',
    needsPeriod: true,
    modes: [
      { key: 'planfact', title: 'План-факт' },
      { key: 'calendar', title: 'Календарь на 90 дней', noPeriod: true },
      { key: 'reliability', title: 'Отказы и надёжность', code: 'RPT-MAINTENANCE-3', noPeriod: true },
    ],
    load: (params, mode) => {
      if (mode === 'reliability') return warehouseApi.reliability();
      if (mode === 'calendar') {
        const today = new Date();
        const to = new Date(Date.now() + 90 * 86400000);
        return warehouseApi.maintenance({
          from: today.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
        });
      }
      return warehouseApi.maintenance(params);
    },
    unwrap: (data, mode) => (mode === 'reliability'
      ? { items: data.items, header: null }
      : { items: data.items, summary: data.summary, header: null }),
    render: mode => (mode === 'calendar' ? 'maintenanceCalendar' : null),
    columns: mode => (mode === 'reliability' ? [
      { key: 'model', title: 'Модель' },
      { key: 'unitsInPark', title: 'Ед. в парке', type: 'number' },
      { key: 'repairs', title: 'Ремонтов за год', type: 'number' },
      { key: 'downtimeHours', title: 'Простой, ч', type: 'number' },
      { key: 'repairCost', title: 'Затраты на ремонт, ₽', type: 'money' },
      { key: 'maintenanceCost', title: 'Затраты на ТО, ₽', type: 'money' },
      { key: 'mtbfDays', title: 'MTBF, дней', type: 'number' },
      { key: 'ownershipCostPerUnitYear', title: 'Владение, ₽/ед./год', type: 'money' },
    ] : [
      { key: '_assetNumber', title: 'Инв. №', type: 'assetLink' },
      { key: '_assetName', title: 'Наименование' },
      { key: '_room', title: 'Кабинет' },
      { key: 'number', title: 'Наряд' },
      { key: 'type', title: 'Тип' },
      { key: 'plannedDate', title: 'Плановая дата', type: 'date' },
      { key: 'factDate', title: 'Фактическая дата', type: 'date' },
      { key: 'deviationDays', title: 'Отклонение, дней', type: 'deviation' },
      { key: 'status', title: 'Статус' },
      { key: 'result', title: 'Результат' },
      { key: 'cost', title: 'Стоимость, ₽', type: 'money' },
      { key: 'downtimeHours', title: 'Простой, ч', type: 'number' },
      { key: '_contractor', title: 'Подрядчик' },
    ]),
  },
  // Отчёт № 2 ТЗ — тоже три режима. Статуса 1С здесь нет намеренно: обмен с 1С
  // отменён, и колонка, которая на всех строках писала бы «обмен выключен»,
  // занимала бы ширину и обещала интеграцию, которой не будет.
  movements: {
    code: 'RPT-MOVEMENT',
    title: 'Движение активов и материалов',
    needsPeriod: true,
    modes: [
      { key: 'registry', title: 'Реестр операций' },
      { key: 'asset', title: 'Сводка по активу', noPeriod: true },
      { key: 'matrix', title: 'Матрица перемещений' },
    ],
    load: (params, mode) => (mode === 'matrix'
      ? warehouseApi.transferMatrix(params)
      : warehouseApi.movements({ ...params, limit: 300 })),
    unwrap: (data, mode) => (mode === 'matrix'
      ? { items: [], matrix: data, header: null }
      : { items: data.items.map(flattenMovement), summary: data.summary, header: null }),
    render: mode => (mode === 'matrix' ? 'transferMatrix' : mode === 'asset' ? 'assetLife' : null),
    columns: [
      { key: 'occurredAt', title: 'Дата и время', type: 'datetime' },
      { key: 'docNumber', title: '№ документа' },
      { key: 'typeLabel', title: 'Тип операции' },
      { key: 'inventoryNumber', title: 'Инв. №', type: 'assetLink' },
      { key: 'objectName', title: 'Наименование' },
      { key: 'serialNumber', title: 'Серийный №' },
      { key: 'qty', title: 'Кол-во', type: 'qty' },
      { key: 'fromPath', title: 'Откуда' },
      { key: 'toPath', title: 'Куда' },
      { key: 'fromWho', title: 'Сдал (МОЛ)' },
      { key: 'toWho', title: 'Принял (МОЛ)' },
      { key: 'reason', title: 'Причина' },
      { key: 'initiator', title: 'Инициатор' },
      { key: 'device', title: 'Устройство' },
      { key: 'signature', title: 'Подпись', type: 'signature' },
    ],
  },
  idle: {
    code: 'RPT-IDLE',
    title: 'Простаивающее оборудование',
    load: () => warehouseApi.idleAssets({}),
    unwrap: data => ({ items: data.items, header: null }),
    columns: [
      { key: 'inventoryNumber', title: 'Инв. №' },
      { key: 'name', title: 'Наименование' },
      { key: 'model', title: 'Модель' },
      { key: 'idleDays', title: 'Дней без операций', type: 'number' },
      { key: 'initialCost', title: 'Первоначальная, ₽', type: 'money' },
      { key: 'medCenterName', title: 'Медцентр' },
      { key: 'departmentName', title: 'Отделение' },
      { key: 'roomNumber', title: 'Кабинет' },
    ],
  },
  inventory: {
    code: 'RPT-INVENTORY',
    title: 'Инвентаризационные описи',
    custom: 'inventory',
  },
};

const GROUPS = [
  { title: 'Склад и материалы', keys: ['turnover', 'consumption', 'doctors', 'abc', 'expiring'] },
  { title: 'Основные средства', keys: ['depreciation', 'maintenance', 'idle'] },
  { title: 'Аудит и сверка', keys: ['movements', 'inventory'] },
];

export default function WarehouseReports({ access, tree, initialReport, onOpenAsset }) {
  // Список отчётов строим по правам, а не показываем всё подряд: иначе человек
  // кликает по строке и получает отказ — худший способ узнать о своих правах.
  const allowedCodes = useMemo(
    () => new Set((access?.reports || []).map(r => r.code)),
    [access]
  );
  const isAllowed = useCallback(
    key => !allowedCodes.size || allowedCodes.has(REPORTS[key].code),
    [allowedCodes]
  );
  const [key, setKey] = useState(() => {
    if (initialReport && REPORTS[initialReport]) return initialReport;
    // Первый доступный, а не жёстко «оборотно-сальдовая»: инженеру она закрыта,
    // и модуль встречал бы его отказом.
    const codes = new Set((access?.reports || []).map(r => r.code));
    const first = Object.keys(REPORTS).find(k => !codes.size || codes.has(REPORTS[k].code));
    return first || 'turnover';
  });
  const reportNavRef = React.useRef(null);
  const [reportSlider, setReportSlider] = useState({ top: 0, height: 0 });
  const [period, setPeriod] = useState(() => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const [medCenterId, setMedCenterId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [state, setState] = useState({ loading: false, data: null });
  const [exporting, setExporting] = useState(false);
  // Свёрнутые узлы дерева по ключу. Хранится «что свёрнуто», а не «что раскрыто»:
  // по умолчанию дерево раскрыто до кабинетов, и список свёрнутого короче.
  const [collapsed, setCollapsed] = useState(() => new Set());

  // Номер последнего запуска расчёта — защита от ответа, который уже никому не
  // нужен: см. load() ниже.
  const runIdRef = React.useRef(0);

  // Активный режим отчёта. Отдельным состоянием, а не частью key: переключение
  // режима не должно ронять период и фильтры, ради которых их только что задали.
  const [mode, setMode] = useState(null);

  const report = REPORTS[key];

  // Режимы, закрытые ролью, не показываем: отдельный код доступа есть, например,
  // у надёжности по моделям.
  const modes = useMemo(
    () => (report?.modes || []).filter(m => !m.code || !allowedCodes.size || allowedCodes.has(m.code)),
    [report, allowedCodes]
  );
  const activeMode = modes.length
    ? (modes.some(m => m.key === mode) ? mode : modes[0].key)
    : null;
  const activeModeDef = modes.find(m => m.key === activeMode) || null;

  const columns = useMemo(
    () => (typeof report?.columns === 'function' ? report.columns(activeMode) : report?.columns) || [],
    [report, activeMode]
  );
  const renderKind = typeof report?.render === 'function' ? report.render(activeMode) : report?.render;

  useEffect(() => { setMode(null); }, [key]);

  React.useLayoutEffect(() => {
    const nav = reportNavRef.current;
    if (!nav) return undefined;

    const recalc = () => {
      const active = nav.querySelector('.wh-reports__group button.is-active');
      if (!active) return;
      const navRect = nav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setReportSlider({ top: activeRect.top - navRect.top, height: activeRect.height });
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [key, access]);

  const load = useCallback(async () => {
    if (!report || report.custom) return;
    // Номер запуска: отчёт теперь строится по кнопке, и переключиться на другой,
    // не дождавшись ответа, стало обычным делом. Без метки поздний ответ старого
    // отчёта лёг бы в таблицу нового — с его заголовками колонок.
    const run = ++runIdRef.current;
    // Режим «сводка по активу» строится только после выбора актива — грузить
    // здесь нечего, экран сам сходит за лентой выбранного оборудования.
    if (renderKind === 'assetLife') { setState({ loading: false, data: null }); return; }
    setState({ loading: true, data: null });
    try {
      const params = {};
      if (report.needsPeriod) { params.from = period.from; params.to = period.to; }
      if (medCenterId) params.medCenterId = medCenterId;
      if (departmentId) params.departmentId = departmentId;
      const { data } = await report.load(params, activeMode);
      if (run !== runIdRef.current) return;
      const shaped = report.unwrap ? { ...data, ...report.unwrap(data, activeMode) } : data;
      setState({ loading: false, data: shaped });
    } catch (e) {
      if (run !== runIdRef.current) return;
      const denied = e.response?.status === 403;
      setState({ loading: false, data: null, denied: denied ? e.response.data?.error : null });
      if (!denied) toast.error(e.response?.data?.error || 'Отчёт не построился');
    }
  }, [report, period, medCenterId, departmentId, activeMode, renderKind]);

  // Отчёт не строится сам при открытии вкладки. Каждый из них — тяжёлый расчёт
  // по всей базе (оборотка разворачивает дерево локаций, ABC считает вариацию по
  // месяцам), и автозапуск приходился ровно на тот момент, когда период и
  // фильтры ещё не заданы: человек ждал минуту результат за месяц по умолчанию,
  // чтобы тут же поменять период и ждать снова. Считаем по кнопке.
  //
  // При смене отчёта или режима результат сбрасываем: колонки у отчётов разные,
  // и прошлая таблица под новыми заголовками читалась бы как свежий отчёт.
  useEffect(() => {
    runIdRef.current++;
    setState({ loading: false, data: null });
  }, [key, activeMode]);

  // При смене отчёта или данных сворачиваем места хранения: полностью раскрытое
  // дерево на тысячу строк невозможно читать, а до кабинета структура нужна сразу.
  useEffect(() => {
    if (!state.data?.hierarchical) return;
    const next = new Set();
    for (const row of state.data.items) {
      if (row.__isGroup && row.__levelKey === 'storage') next.add(row.__key);
    }
    setCollapsed(next);
  }, [state.data]);

  /**
   * Видимые строки дерева: узел скрыт, если свёрнут любой из его предков.
   * Предки определяются по префиксу ключа — он собран из пути, поэтому сравнения
   * строк достаточно и обходить дерево заново не нужно.
   */
  const visibleRows = useMemo(() => {
    const items = state.data?.items || [];
    if (!state.data?.hierarchical || !collapsed.size) return items;

    // Строка видна, если не свёрнут ни один её строгий предок. Сам свёрнутый узел
    // остаётся виден — иначе его нечем было бы раскрыть обратно.
    const hiddenUnder = (key) => {
      if (!key) return false;
      for (const c of collapsed) {
        if (key === c || key.startsWith(c + '/')) return true;
      }
      return false;
    };

    return items.filter(row => {
      if (row.__isGroup) {
        // Для группы отсекаем сам её ключ: свёрнут — но виден.
        const parent = row.__key.includes('/') ? row.__key.slice(0, row.__key.lastIndexOf('/')) : null;
        return !hiddenUnder(parent) && !collapsed.has(parent);
      }
      return !hiddenUnder(row.__parentKey);
    });
  }, [state.data, collapsed]);

  const toggleNode = (key) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const collapseAll = (levelKey) => {
    const next = new Set();
    for (const row of state.data?.items || []) {
      if (row.__isGroup && (!levelKey || row.__levelKey === levelKey)) next.add(row.__key);
    }
    setCollapsed(next);
  };

  const doExport = async (format) => {
    if (!state.data?.items?.length) return toast.error('Нечего выгружать');
    setExporting(true);
    try {
      const { data: blob } = await warehouseApi.exportReport({
        format,
        code: report.code,
        header: state.data.header || { title: report.title, generatedAt: new Date().toISOString() },
        // Псевдоколонки («Локация», «Δ количества», «Подпись») собираются из
        // нескольких полей строки, и в сыром виде их в файле не будет — колонка
        // окажется пустой. Поэтому в выгрузку идут те же значения, что на экране;
        // числа остаются числами, чтобы Excel не превратил их в текст.
        items: state.data.items.map(row => exportRow(row, columns)),
        totals: state.data.totals || null,
        columns,
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${report.code}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error('Не удалось выгрузить');
    } finally {
      setExporting(false);
    }
  };

  const departments = useMemo(() => {
    if (!medCenterId) return tree?.departments || [];
    return (tree?.departments || []).filter(d => d.medCenterId === medCenterId);
  }, [tree, medCenterId]);

  const [mailingOpen, setMailingOpen] = useState(false);

  return (
    <div className="wh-reports">
      <aside className="wh-reports__nav" ref={reportNavRef}>
        <div
          className="wh-reports__slider"
          style={{ transform: `translateY(${reportSlider.top}px)`, height: reportSlider.height }}
        />
        {GROUPS.filter(g => g.keys.some(isAllowed)).map(g => (
          <div key={g.title} className="wh-reports__group">
            <h4>{g.title}</h4>
            {g.keys.filter(isAllowed).map(k => (
              <button key={k} className={key === k ? 'is-active' : ''} onClick={() => setKey(k)}>
                {REPORTS[k].title}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="wh-reports__main wh-reports__main--slide" key={key}>
        <div className="wh-reports__head">
          <h2>{report.title}</h2>
          {/* Настройка рассылок живёт здесь, а не в общих настройках портала:
              подписка — это отчёт, и включают её там же, где его читают. */}
          <button className="wh-btn wh-btn--ghost" onClick={() => setMailingOpen(true)}>
            <Mail size={15} /> Рассылки
          </button>
        </div>
        {mailingOpen && <MailingModal onClose={() => setMailingOpen(false)} />}

        {modes.length > 1 && (
          <div className="wh-subtabs">
            {modes.map(m => (
              <button key={m.key} className={activeMode === m.key ? 'is-active' : ''}
                      onClick={() => setMode(m.key)}>
                {m.title}
              </button>
            ))}
          </div>
        )}

        {!report.custom && (
          <div className="wh-reports__filters">
            {report.needsPeriod && !activeModeDef?.noPeriod && (
              <>
                <div className="wh-field">
                  <label>С</label>
                  <input type="date" value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} />
                </div>
                <div className="wh-field">
                  <label>По</label>
                  <input type="date" value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} />
                </div>
                <div className="wh-presets">
                  {[['Месяц', 30], ['Квартал', 90], ['Год', 365]].map(([label, days]) => (
                    <button key={label} onClick={() => setPeriod({
                      from: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
                      to: new Date().toISOString().slice(0, 10),
                    })}>{label}</button>
                  ))}
                </div>
              </>
            )}
            <div className="wh-field">
              <label>Медцентр</label>
              <select value={medCenterId} onChange={e => { setMedCenterId(e.target.value); setDepartmentId(''); }}>
                <option value="">Все</option>
                {(tree?.medCenters || []).map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
              </select>
            </div>
            <div className="wh-field">
              <label>Отделение</label>
              <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">Все</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {state.data?.hierarchical && (
              <div className="wh-field wh-reports__tree-ctl">
                <label>Дерево</label>
                <div className="wh-btn-group">
                  <button className="wh-icon-btn" title="Раскрыть всё"
                          onClick={() => setCollapsed(new Set())}>
                    <Maximize2 size={15} />
                  </button>
                  <button className="wh-icon-btn" title="Свернуть до кабинетов"
                          onClick={() => collapseAll('storage')}>
                    <ListTree size={15} />
                  </button>
                  <button className="wh-icon-btn" title="Свернуть до отделений"
                          onClick={() => collapseAll('room')}>
                    <FolderTree size={15} />
                  </button>
                  <button className="wh-icon-btn" title="Свернуть всё"
                          onClick={() => collapseAll()}>
                    <Minimize2 size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* Выгрузки прижаты к правому краю полосы: XLSX и PDF собираются по
                тем же параметрам, что и таблица, поэтому стоят рядом с ними, но
                это действия, а не фильтры — отсюда зазор. */}
            <div className="wh-reports__export">
              {/* Построение стоит первым в группе действий: пока по нему не
                  щёлкнули, выгружать нечего, и XLSX с PDF читаются как
                  продолжение расчёта, а не как замена ему. Сводка по активу
                  кнопки не получает — она собирается сама после выбора актива. */}
              {renderKind !== 'assetLife' && (
                <button className="wh-btn wh-btn--primary" onClick={load} disabled={state.loading}>
                  <Play size={15} /> {state.loading ? 'Считаю…' : 'Сформировать'}
                </button>
              )}
              <button className="wh-btn wh-btn--ghost" onClick={() => doExport('xlsx')} disabled={exporting}>
                <FileSpreadsheet size={15} /> XLSX
              </button>
              <button className="wh-btn wh-btn--ghost" onClick={() => doExport('pdf')} disabled={exporting}>
                <FileText size={15} /> PDF
              </button>
            </div>
          </div>
        )}

        {report.custom === 'inventory' && <InventoryPanel />}

        {state.denied && (
          <div className="wh-alert wh-alert--warning">
            <AlertTriangle size={15} />
            <div>{state.denied}</div>
          </div>
        )}

        {!report.custom && !state.denied && (
          <>
            {state.data?.disclaimer && (
              <div className="wh-note wh-note--warn"><AlertTriangle size={15} /><div>{state.data.disclaimer}</div></div>
            )}
            {state.data?.summary && <SummaryStrip summary={state.data.summary} />}

            {/* Режимы, которые таблицей не показать: матрица, календарь, лента
                жизни актива и матрица ABC/XYZ. Каждый из них — форма из ТЗ, и
                разложить её по колонкам значило бы потерять сам смысл формы. */}
            {renderKind === 'abc' && state.data && <AbcMatrix data={state.data} />}
            {renderKind === 'transferMatrix' && state.data && <TransferMatrix data={state.data.matrix} />}
            {renderKind === 'maintenanceCalendar' && state.data && <MaintenanceCalendar items={state.data.items || []} />}
            {/* Матрица и календарь показываются вместо таблицы, поэтому спиннер и
                подсказку «ещё не считали» им нужно рисовать отдельно. */}
            {['transferMatrix', 'maintenanceCalendar'].includes(renderKind) && !state.data && (
              state.loading
                ? <div className="wh-table__loading"><div className="loading-spinner" /></div>
                : <div className="wh-empty">Отчёт не сформирован — нажмите «Сформировать»</div>
            )}
            {renderKind === 'assetLife' && <AssetLife onOpenAsset={onOpenAsset} />}

            {state.data?.controls?.stockVsMovements?.length > 0 && (
              <div className="wh-note wh-note--warn">
                <AlertTriangle size={15} />
                <div>
                  Остаток расходится с журналом движений по {state.data.controls.stockVsMovements.length} позициям.
                  Это означает, что остатки правились в обход модуля.
                </div>
              </div>
            )}

            <div className="wh-table-wrap wh-table-wrap--tall"
                 hidden={['transferMatrix', 'maintenanceCalendar', 'assetLife'].includes(renderKind)}>
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr>{columns.map(c => (
                    <th key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>{c.title}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {state.loading && (
                    <tr><td colSpan={columns.length} className="wh-table__loading">
                      <div className="loading-spinner" />
                    </td></tr>
                  )}
                  {!state.loading && visibleRows.map((row, i) => {
                    const isTree = state.data?.hierarchical;
                    const hasChildren = row.__isGroup;
                    const isCollapsed = hasChildren && collapsed.has(row.__key);
                    return (
                      <tr key={row.__key || `${row.__parentKey || ''}-${i}`}
                          className={`${rowClass(row)} ${hasChildren ? 'wh-tree__group' : ''} ${isTree && !hasChildren ? 'wh-tree__leaf' : ''}`}
                          onClick={hasChildren ? () => toggleNode(row.__key) : undefined}>
                        {columns.map(c => {
                          if (c.type === 'tree') {
                            // Номенклатура прижата к левому краю ячейки: в ОСВ
                            // пять уровней локаций, и лист шестым отступом
                            // оказывался у середины колонки — длинным названиям
                            // оставалась пара сантиметров. Отступы нужны, чтобы
                            // читалась вложенность локаций, а лист вложенности не
                            // продолжает: он последний и виден по обычному
                            // начертанию подписи против полужирного у групп.
                            const isLeaf = isTree && !hasChildren;
                            const indent = isLeaf ? 0 : (row.__level || 0);
                            return (
                              <td key={c.key} className="wh-tree__cell"
                                  style={{ paddingLeft: 10 + indent * 18 }}>
                                {/* Стрелка — указатель состояния, а не мишень:
                                    сворачивает строка целиком, поэтому кнопка
                                    выведена из обхода табом и не ловит клик сама. */}
                                {hasChildren ? (
                                  <button className="wh-tree__toggle" tabIndex={-1}
                                          title={isCollapsed ? 'Раскрыть' : 'Свернуть'}>
                                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                  </button>
                                ) : isLeaf ? null : <span className="wh-tree__bullet" />}
                                <span className={hasChildren ? 'wh-tree__label' : ''}>{row.label}</span>
                                {isCollapsed && <span className="wh-tree__hint">свёрнуто</span>}
                              </td>
                            );
                          }
                          return (
                            <td key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>
                              {cell(row, c, { onOpenAsset })}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {!state.loading && !visibleRows.length && (
                    <tr><td colSpan={columns.length} className="wh-empty">
                      {state.data ? 'Данных нет' : 'Отчёт не сформирован — задайте период и нажмите «Сформировать»'}
                    </td></tr>
                  )}
                </tbody>
                {state.data?.totals && (
                  <tfoot>
                    <tr>
                      {columns.map((c, i) => (
                        <td key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>
                          {i === 0 ? <b>ИТОГО</b>
                            : state.data.totals[c.key] !== undefined
                              ? <b>{format(state.data.totals[c.key], c.type)}</b>
                              : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryStrip({ summary }) {
  const entries = Object.entries(summary).filter(([, v]) => typeof v !== 'object');
  const nested = Object.entries(summary).filter(([, v]) => v && typeof v === 'object');
  return (
    <div className="wh-summary wh-summary--strip">
      {entries.map(([k, v]) => (
        <div key={k} className="wh-sumcard wh-sumcard--neutral">
          <div className="wh-sumcard__title">{summaryLabel(k)}</div>
          <div className="wh-sumcard__value">{typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v)}</div>
        </div>
      ))}
      {nested.map(([k, v]) => (
        <div key={k} className="wh-sumcard wh-sumcard--neutral">
          <div className="wh-sumcard__title">{summaryLabel(k)}</div>
          <div className="wh-sumcard__value">
            {v.count !== undefined ? v.count : Object.values(v).reduce((s, x) => s + Number(x || 0), 0)}
          </div>
          {v.amount !== undefined && (
            <div className="wh-sumcard__sub">{Number(v.amount).toLocaleString('ru-RU')} ₽</div>
          )}
        </div>
      ))}
    </div>
  );
}

function InventoryPanel() {
  // null, а не пустой массив: у описей есть третье состояние — «ещё не строили».
  // Отличить его от «описей нет» нужно, иначе экран до нажатия кнопки уверенно
  // сообщал бы, что инвентаризаций не было ни одной.
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await warehouseApi.inventorySessions();
      setSessions(data);
    } catch {
      toast.error('Не удалось загрузить описи');
    } finally {
      setLoading(false);
    }
  };

  const open = async (id) => {
    try {
      const { data } = await warehouseApi.inventoryReport(id);
      setReport(data);
    } catch {
      toast.error('Не удалось открыть опись');
    }
  };

  return (
    <div className="wh-inventory">
      {/* Описи собираются по кнопке, как и остальные отчёты вкладки. */}
      <div className="wh-reports__filters">
        <button className="wh-btn wh-btn--primary" onClick={load} disabled={loading}>
          <Play size={15} /> {loading ? 'Считаю…' : 'Сформировать'}
        </button>
      </div>

      <div className="wh-table-wrap">
        <table className="wh-table wh-table--compact">
          <thead><tr><th>Опись</th><th>Локация</th><th>Основание</th><th>Статус</th><th>Начата</th><th>Завершена</th><th>Длительность</th></tr></thead>
          <tbody>
            {(sessions || []).map(s => (
              <tr key={s.id} className="wh-table__row" onClick={() => open(s.id)}>
                <td className="wh-mono">{s.number}</td>
                <td>{s.room ? `Каб. ${s.room.number}` : s.department?.name || '—'}</td>
                <td className="wh-cell-sub">{s.basis || '—'}</td>
                <td><span className={`wh-status wh-status--${s.status}`}>{
                  { open: 'Открыта', counting: 'Пересчёт', closed: 'Закрыта', cancelled: 'Отменена' }[s.status]
                }</span></td>
                <td>{s.startedAt ? new Date(s.startedAt).toLocaleString('ru-RU') : '—'}</td>
                <td>{s.finishedAt ? new Date(s.finishedAt).toLocaleString('ru-RU') : '—'}</td>
                <td>{s.durationMinutes ? `${Math.floor(s.durationMinutes / 60)} ч ${s.durationMinutes % 60} мин` : '—'}</td>
              </tr>
            ))}
            {loading && (
              <tr><td colSpan={7} className="wh-table__loading"><div className="loading-spinner" /></td></tr>
            )}
            {!loading && !sessions?.length && (
              <tr><td colSpan={7} className="wh-empty">
                {sessions ? 'Описей нет' : 'Отчёт не сформирован — нажмите «Сформировать»'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {report && (
        <div className="wh-inv-report">
          <h3>{report.header.title}</h3>
          <div className="wh-inv-report__meta">
            <div>Опись № <b>{report.session.number}</b></div>
            <div>Локация: {report.session.location}</div>
            <div>Основание: {report.session.basis || '—'}</div>
            <div>МОЛ: {report.session.responsible?.displayName || '—'}</div>
            <div>Председатель комиссии: {report.session.chairman?.displayName || '—'}</div>
          </div>

          <table className="wh-table wh-table--compact">
            <thead>
              <tr><th>№</th><th>Инв. № / код</th><th>Наименование</th><th className="wh-num">По учёту</th>
                  <th className="wh-num">Фактически</th><th className="wh-num">Расхождение</th><th>Примечание</th></tr>
            </thead>
            <tbody>
              {report.items.map(i => (
                <tr key={i.id} className={i.difference ? (i.difference < 0 ? 'wh-row--shortage' : 'wh-row--surplus') : ''}>
                  <td>{i.rowNumber}</td>
                  <td className="wh-mono">{i.inventoryNumber}</td>
                  <td>{i.name}</td>
                  <td className="wh-num">{i.expectedQty}</td>
                  <td className="wh-num">{i.actualQty === null ? '—' : i.actualQty}</td>
                  <td className="wh-num">{i.difference === null ? '—' : (i.difference > 0 ? `+${i.difference}` : i.difference)}</td>
                  <td className="wh-cell-sub">{i.note || (i.scanMethod === 'qr' ? 'скан QR' : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="wh-inv-report__totals">
            <span>Недостач: <b>{report.totals.shortage}</b></span>
            <span>Излишков: <b>{report.totals.surplus}</b></span>
            <span>По QR: <b>{report.totals.scannedByQr}</b></span>
            <span>Вручную: <b>{report.totals.scannedManually}</b></span>
            {report.totals.qrSharePct !== null && <span>Доля QR: <b>{report.totals.qrSharePct} %</b></span>}
            {report.session.durationMinutes && (
              <span>Длительность: <b>{Math.floor(report.session.durationMinutes / 60)} ч {report.session.durationMinutes % 60} мин</b></span>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Форматирование ───────────────────────────────────────────────────────────
const isNum = t => ['money', 'qty', 'number', 'percent', 'share', 'delta', 'deviation'].includes(t);

const STOCK_STATUS = {
  below: { zone: 'red', label: 'ниже минимума' },
  near: { zone: 'yellow', label: 'близко к минимуму' },
  ok: { zone: 'green', label: 'норма' },
  unknown: { zone: 'none', label: 'минимум не задан' },
};
const ASSET_STATUS = {
  in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
  storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано',
};

/**
 * Значение ячейки. Псевдоколонки (ключ с подчёркиванием) собираются из нескольких
 * полей строки — так в отчёт попадают «Локация» одной колонкой вместо трёх и
 * «Δ количества» абсолютным значением вместе с процентом, как в макетах ТЗ.
 */
function cell(row, col, ctx = {}) {
  switch (col.key) {
    case '_asset': return row.asset ? `${row.asset.name} ${row.asset.model || ''}` : '—';
    case '_assetNumber': return row.asset?.inventoryNumber || '—';
    case '_assetName': return [row.asset?.name, row.asset?.model].filter(Boolean).join(' ') || '—';
    case '_room': return row.asset?.room ? `Каб. ${row.asset.room.number}` : '—';
    case '_contractor': return row.contractor?.name || '—';
    case '_nameModel': return [row.name, row.model].filter(Boolean).join(', ') || '—';
    case '_categoryOkof': return [row.categoryName, row.okof].filter(Boolean).join(' / ') || '—';
    case '_location': return locationPath(row);
    case '_forecast': return forecastText(row);
    default: break;
  }

  // Отчёт по ТО: справочные значения приходят кодами, а не подписями.
  if (row.number && ['type', 'status', 'result'].includes(col.key)) {
    return col.key === 'type' ? maintType(row.type)
      : col.key === 'status' ? maintStatus(row.status)
      : maintResult(row.result);
  }

  const value = row[col.key];

  if (col.type === 'zone') {
    return <span className={`wh-dot wh-dot--zone-${value || 'none'}`} title={zoneTitle(value)} />;
  }
  if (col.type === 'stockStatus') {
    const s = STOCK_STATUS[value];
    if (!s || row.__isGroup) return null;
    return <span className={`wh-zonebadge wh-zonebadge--${s.zone}`}>{s.label}</span>;
  }
  if (col.type === 'assetStatus') return ASSET_STATUS[value] || value || '—';
  if (col.type === 'deprMethod') {
    return value === 'reducing' ? 'Уменьшаемого остатка' : value === 'linear' ? 'Линейный' : '—';
  }
  if (col.type === 'abcCell') {
    return value ? <span className={`wh-abc wh-abc--${value[0]}`}>{value}</span> : '—';
  }
  if (col.type === 'signature') {
    return row.signedAt
      ? <span className="wh-ok" title={`Подписано ${format(row.signedAt, 'datetime')}`}>✓ подписано</span>
      : <span className="wh-muted">✗ без подписи</span>;
  }
  if (col.type === 'delta') {
    // Абсолютное значение и процент вместе: «+18 %» без штук не говорит, много
    // это или две упаковки.
    if (row.deltaQty === null || row.deltaQty === undefined) return '—';
    const abs = Number(row.deltaQty);
    const pct = row.deltaQtyPct;
    return `${abs > 0 ? '+' : ''}${abs.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}`
      + (pct === null || pct === undefined ? '' : ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)} %)`);
  }
  if (col.type === 'deviation') {
    if (value === null || value === undefined) return '—';
    const n = Number(value);
    return `${n > 0 ? '+' : ''}${n}${n > 0 ? (row.isOverdue ? ' 🔴' : ' ⚠') : ' ✓'}`;
  }
  if (col.type === 'assetLink' && value && ctx.onOpenAsset) {
    const assetId = row.assetId || row.id || row.asset?.id;
    if (assetId) {
      return (
        <button className="wh-btn wh-btn--link wh-mono"
                onClick={e => { e.stopPropagation(); ctx.onOpenAsset(assetId); }}>
          {value}
        </button>
      );
    }
  }
  // Причина отсутствия показателя объясняется подсказкой, а не отдельной
  // колонкой: колонка «почему нет» была почти всегда пустой и занимала ширину.
  if (col.key === 'normDeviationPct' && (value === null || value === undefined) && row.missingReason) {
    return <span className="wh-muted" title={row.missingReason}>нет данных</span>;
  }

  // В строке-группе показателя позиции нет и быть не может: код, единица, доля,
  // минимум и статус относятся к номенклатуре, а не к этажу или кабинету.
  // Прочерк в каждой такой ячейке складывался в столбцы прочерков через весь
  // отчёт и читался как «данные потерялись», хотя терять там нечего.
  if (row.__isGroup && (value === null || value === undefined || value === '')) return null;

  return format(value, col.type);
}

/**
 * Строка для выгрузки. Числовые колонки отдаются числами — их форматирует Excel;
 * всё производное сводится к тексту, тому же, что видно на экране.
 */
const RAW_TYPES = ['money', 'qty', 'number', 'percent', 'share', 'date', 'datetime', 'deviation'];

function exportRow(row, columns) {
  const out = { __level: row.__level, __isGroup: row.__isGroup, __key: row.__key };
  for (const col of columns) {
    if (!col.key.startsWith('_') && (RAW_TYPES.includes(col.type) || !col.type)) {
      out[col.key] = row[col.key];
      continue;
    }
    const value = cell(row, col);
    // Ячейки-индикаторы возвращают разметку — в файл идёт их текстовый смысл.
    out[col.key] = typeof value === 'object' && value !== null
      ? plainOf(row, col)
      : value;
  }
  return out;
}

function plainOf(row, col) {
  if (col.type === 'zone') return zoneTitle(row.zone);
  if (col.type === 'stockStatus') return STOCK_STATUS[row.status]?.label ?? null;
  if (col.type === 'abcCell') return row.cell || null;
  if (col.type === 'signature') return row.signedAt ? 'подписано' : 'без подписи';
  if (col.type === 'assetLink') return row[col.key] ?? null;
  return row[col.key] ?? null;
}

function locationPath(row) {
  return [row.departmentName, row.roomNumber ? `Каб. ${row.roomNumber}` : null, row.storageName]
    .filter(Boolean).join(' / ') || '—';
}

function forecastText(row) {
  if (row.willConsumeInTime === null || row.willConsumeInTime === undefined) return 'нет истории расхода';
  return row.willConsumeInTime
    ? `✓ успеем${row.exhaustionDate ? ` (до ${format(row.exhaustionDate, 'date')})` : ''}`
    : `✗ не успеем${row.exhaustionDate ? ` (расчёт до ${format(row.exhaustionDate, 'date')})` : ''}`;
}

const zoneTitle = z => ({
  red: 'Просрочено или ≤ 7 дней', orange: '8–30 дней',
  yellow: '31–90 дней', green: 'Больше 90 дней',
}[z] || 'Зона не определена');

function format(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'qty') return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  if (type === 'number') return Number(v).toLocaleString('ru-RU');
  if (type === 'percent') return `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)} %`;
  // Доля — не изменение: знак «+» перед ней читался бы как рост.
  if (type === 'share') return `${Number(v).toFixed(1)} %`;
  if (type === 'date') return new Date(v).toLocaleDateString('ru-RU');
  if (type === 'datetime') return new Date(v).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return String(v);
}

function rowClass(row) {
  const zone = row.zone || row.status || row.stockStatus;
  if (['red', 'below'].includes(zone)) return 'wh-row--red';
  if (zone === 'orange') return 'wh-row--orange';
  if (['yellow', 'near'].includes(zone)) return 'wh-row--yellow';
  if (row.isOverdue) return 'wh-row--red';
  if (row.fullyDepreciatedInUse) return 'wh-row--yellow';
  return '';
}

/**
 * Строка реестра операций. Актив и номенклатура разложены по отдельным колонкам
 * ТЗ: инвентарный номер должен быть ссылкой на карточку, а для этого его нельзя
 * держать склеенным с наименованием в одном поле.
 */
function flattenMovement(m) {
  return {
    assetId: m.asset?.id || null,
    occurredAt: m.occurredAt,
    docNumber: m.document?.number || '—',
    typeLabel: moveType(m.type),
    inventoryNumber: m.asset?.inventoryNumber || m.nomenclature?.code || null,
    objectName: m.asset
      ? [m.asset.name, m.asset.model].filter(Boolean).join(', ')
      : `${m.nomenclature?.name || ''}${m.batch?.batchNumber ? ` (серия ${m.batch.batchNumber})` : ''}`,
    serialNumber: m.asset?.serialNumber || null,
    qty: m.quantity,
    fromPath: m.fromRoom ? `${m.fromRoom.department?.name || ''} / Каб. ${m.fromRoom.number}` : '—',
    toPath: m.toRoom ? `${m.toRoom.department?.name || ''} / Каб. ${m.toRoom.number}` : '—',
    fromWho: m.fromResponsible?.displayName || '—',
    toWho: m.toResponsible?.displayName || '—',
    reason: [m.reasonCode, m.reasonText].filter(Boolean).join(' · ') || '—',
    initiator: m.initiator?.displayName || '—',
    device: m.document?.device || '—',
    signedAt: m.document?.signedAt || null,
  };
}

// ── Формы отчётов, которые не раскладываются в таблицу ───────────────────────

/**
 * Матрица ABC/XYZ — режим 3 отчёта № 3. Смысл здесь в самой клетке: «дорого и
 * ровно» и «дорого и рвано» требуют разных стратегий запаса, и таблица со
 * столбцами «класс ABC» и «класс XYZ» этого пересечения не показывает.
 */
function AbcMatrix({ data }) {
  if (!data?.matrix) return null;
  return (
    <div className="wh-abcgrid">
      <div className="wh-abcgrid__corner" />
      <div className="wh-abcgrid__head">X — стабильный</div>
      <div className="wh-abcgrid__head">Y — колеблющийся</div>
      <div className="wh-abcgrid__head">Z — нерегулярный</div>
      {data.matrix.map(rowDef => (
        <React.Fragment key={rowDef.abc}>
          <div className="wh-abcgrid__side">
            {rowDef.abc}
            <small>{rowDef.abc === 'A' ? 'до 80 % ₽' : rowDef.abc === 'B' ? 'до 95 % ₽' : 'остальное'}</small>
          </div>
          {rowDef.cells.map(c => (
            <div key={c.key} className={`wh-abccell ${c.count ? '' : 'is-empty'} wh-abccell--${rowDef.abc}`}>
              <b>{c.count} поз.</b>
              <span>{c.sharePct.toFixed(1)} % ₽</span>
              <small>{c.strategy}</small>
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Матрица межотделенческих перемещений — режим 3 отчёта № 2. Показывает, между
 * какими подразделениями оборудование ходит в обход заявок.
 */
function TransferMatrix({ data }) {
  const departments = data?.departments || [];
  // Сервер отдаёт разреженный список непустых клеток — плотную таблицу собираем
  // здесь: пересылать нули между всеми парами отделений незачем.
  const byPair = useMemo(() => {
    const map = new Map();
    for (const c of data?.cells || []) map.set(`${c.fromId}>${c.toId}`, c.transfers);
    return map;
  }, [data]);

  if (!departments.length) return <div className="wh-empty">Межотделенческих перемещений за период нет</div>;

  const received = d => departments.reduce((s, from) => s + (byPair.get(`${from.id}>${d.id}`) || 0), 0);

  return (
    <div className="wh-table-wrap">
      <table className="wh-table wh-table--compact">
        <thead>
          <tr>
            <th>Отдал \ Принял</th>
            {departments.map(d => <th key={d.id} className="wh-num">{d.name}</th>)}
            <th className="wh-num">Итого отдано</th>
          </tr>
        </thead>
        <tbody>
          {departments.map(from => {
            const total = departments.reduce((s, to) => s + (byPair.get(`${from.id}>${to.id}`) || 0), 0);
            return (
              <tr key={from.id}>
                <td className="wh-cell-main">{from.name}</td>
                {departments.map(to => {
                  const v = byPair.get(`${from.id}>${to.id}`) || 0;
                  // Диагональ — перемещения внутри отделения, их в отчёте нет
                  // по определению: он про обмен между подразделениями.
                  if (from.id === to.id) return <td key={to.id} className="wh-num wh-muted">—</td>;
                  return (
                    <td key={to.id} className={`wh-num ${v ? '' : 'wh-muted'}`}>{v || '·'}</td>
                  );
                })}
                <td className="wh-num"><b>{total}</b></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td><b>Итого получено</b></td>
            {departments.map(d => <td key={d.id} className="wh-num"><b>{received(d)}</b></td>)}
            <td className="wh-num"><b>{[...byPair.values()].reduce((s, v) => s + v, 0)}</b></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Календарь предстоящих ТО на 90 дней — режим 2 отчёта № 6. Группировка по
 * неделям, а не по дням: смысл экрана — увидеть неделю, в которую съезжается
 * слишком много работ, и развести их заранее.
 */
function MaintenanceCalendar({ items }) {
  const weeks = useMemo(() => {
    const map = new Map();
    for (const o of items) {
      if (!o.plannedDate) continue;
      const d = new Date(o.plannedDate);
      const key = isoWeekKey(d);
      if (!map.has(key)) {
        map.set(key, { key, label: weekLabel(d), count: 0, cost: 0, mandatory: 0, orders: [] });
      }
      const w = map.get(key);
      w.count += 1;
      w.cost += Number(o.cost || 0);
      if (o.isMandatory) w.mandatory += 1;
      w.orders.push(o);
    }
    return [...map.values()].sort((a, z) => a.key.localeCompare(z.key));
  }, [items]);

  if (!weeks.length) return <div className="wh-empty">На ближайшие 90 дней нарядов не запланировано</div>;
  const peak = Math.max(...weeks.map(w => w.count));

  return (
    <div className="wh-calendar">
      {weeks.map(w => (
        <div key={w.key} className={`wh-calendar__week ${w.count >= 5 ? 'is-peak' : ''}`}>
          <div className="wh-calendar__label">{w.label}</div>
          <div className="wh-calendar__bar">
            <i style={{ width: `${(w.count / peak) * 100}%` }} />
          </div>
          <div className="wh-calendar__nums">
            <b>{w.count}</b> нарядов · {w.cost.toLocaleString('ru-RU')} ₽
            {w.mandatory > 0 && <span className="wh-warn"> · обязательных: {w.mandatory}</span>}
          </div>
          <details className="wh-calendar__list">
            <summary>показать наряды</summary>
            <ul className="wh-simple-list">
              {w.orders.map(o => (
                <li key={o.id}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="wh-cell-main">{o.asset?.name || '—'}</span>
                    <span className="wh-cell-sub"> · {o.number} · {maintType(o.type)}</span>
                  </span>
                  <span>{new Date(o.plannedDate).toLocaleDateString('ru-RU')}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
    </div>
  );
}

/**
 * Лента жизни актива — режим 2 отчёта № 2. Один актив, вся хронология: закупка,
 * ввод в эксплуатацию, перемещения, ТО, ремонты, смены МОЛ, списание. Прикладывают
 * к акту при разборах, поэтому порядок строго хронологический.
 */
function AssetLife({ onOpenAsset }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState([]);
  const [asset, setAsset] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setOptions([]); return undefined; }
    const t = setTimeout(async () => {
      try {
        const { data } = await warehouseApi.assets({ q: q.trim(), limit: 20 });
        setOptions(data.items || []);
      } catch { setOptions([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const pick = async (a) => {
    setAsset(a); setOptions([]); setQ('');
    setLoading(true);
    try {
      const { data } = await warehouseApi.movements({ assetId: a.id, limit: 500 });
      setItems([...(data.items || [])].sort((x, z) => new Date(x.occurredAt) - new Date(z.occurredAt)));
    } catch {
      toast.error('Не удалось загрузить историю актива');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wh-assetlife">
      <div className="wh-assetlife__pick">
        <div className="wh-search">
          <input placeholder="Инвентарный номер, наименование или серийный номер…"
                 value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {options.length > 0 && (
          <ul className="wh-assetlife__options">
            {options.map(a => (
              <li key={a.id}>
                <button onClick={() => pick(a)}>
                  <span className="wh-mono">{a.inventoryNumber}</span> {a.name}
                  <small>{a.room ? ` · Каб. ${a.room.number}` : ' · не размещён'}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!asset && <div className="wh-empty">Выберите актив, чтобы построить ленту его жизни</div>}
      {loading && <div className="wh-table__loading"><div className="loading-spinner" /></div>}

      {asset && !loading && (
        <>
          <div className="wh-assetlife__head">
            <div>
              <div className="wh-cell-main">{asset.name} {asset.model}</div>
              <div className="wh-cell-sub wh-mono">{asset.inventoryNumber}</div>
            </div>
            {onOpenAsset && (
              <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => onOpenAsset(asset.id)}>
                Открыть карточку
              </button>
            )}
          </div>
          <ul className="wh-timeline">
            {items.map(m => (
              <li key={m.id} className={`wh-timeline__item wh-timeline__item--${m.type}`}>
                <div className="wh-timeline__date">{format(m.occurredAt, 'datetime')}</div>
                <div className="wh-timeline__body">
                  <b>{moveType(m.type)}</b>
                  {m.document?.number && <span className="wh-cell-sub"> · {m.document.number}</span>}
                  {(m.fromRoom || m.toRoom) && (
                    <span className="wh-timeline__path">
                      {m.fromRoom ? `Каб. ${m.fromRoom.number}` : '—'}
                      <ArrowRightLeft size={12} />
                      {m.toRoom ? `Каб. ${m.toRoom.number}` : '—'}
                    </span>
                  )}
                  {m.reasonText && <div className="wh-timeline__reason">{m.reasonText}</div>}
                  <div className="wh-timeline__who">
                    {m.fromResponsible?.displayName && `сдал: ${m.fromResponsible.displayName}`}
                    {m.toResponsible?.displayName && ` · принял: ${m.toResponsible.displayName}`}
                    {m.initiator?.displayName && ` · оформил: ${m.initiator.displayName}`}
                  </div>
                </div>
              </li>
            ))}
            {!items.length && <li className="wh-empty">Операций по активу не зарегистрировано</li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** Ключ ISO-недели для сортировки и группировки. */
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function weekLabel(d) {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() || 7) - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmtShort = x => x.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  return `${fmtShort(monday)} — ${fmtShort(sunday)}`;
}

const moveType = t => ({
  receipt: 'Приём', return: 'Возврат', issue: 'Выдача', transfer: 'Перемещение', repair_out: 'В ремонт',
  repair_in: 'Из ремонта', writeoff: 'Списание', inventory: 'Инвентаризация', surplus: 'Оприходование',
}[t] || t);
const maintType = t => ({ maintenance: 'ТО', verification: 'Поверка', calibration: 'Калибровка', dosimetry: 'Дозиметрия', inspection: 'Осмотр' }[t] || t);
const maintStatus = s => ({ planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен', overdue: 'Просрочен', cancelled: 'Отменён' }[s] || s);
const maintResult = r => ({ normal: 'Норма', with_remarks: 'С замечаниями', failed: 'Не пройдено' }[r] || '—');


/**
 * Настройка регламентной рассылки.
 *
 * Список не редактируется вручную: он выводится из прав на отчёты — кому отчёт
 * доступен в портале, тому он и приходит почтой. Здесь остаётся одно решение,
 * которое и правда принадлежит человеку: получать или не получать.
 *
 * Отдельно показывается адрес. Пустая почта в карточке — самая частая причина
 * «мне ничего не приходит», и узнавать об этом из лога воркера получателю негде.
 */
function MailingModal({ onClose }) {
  const [state, setState] = useState({ loading: true, email: null, deliverable: false, items: [] });
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    let cancelled = false;
    warehouseApi.mailSubscriptions()
      .then(({ data }) => { if (!cancelled) setState({ loading: false, ...data }); })
      .catch(() => {
        if (cancelled) return;
        setState(s => ({ ...s, loading: false }));
        toast.error('Не удалось загрузить настройки рассылок');
      });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (code, enabled) => {
    setSaving(code);
    // Переключатель ставится сразу, до ответа: отмена рассылки не то действие,
    // ради которого стоит смотреть на крутилку. Ошибка вернёт всё назад.
    setState(s => ({ ...s, items: s.items.map(i => (i.code === code ? { ...i, enabled } : i)) }));
    try {
      await warehouseApi.setMailSubscription(code, enabled);
    } catch (e) {
      setState(s => ({ ...s, items: s.items.map(i => (i.code === code ? { ...i, enabled: !enabled } : i)) }));
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div>
            <div className="wh-modal__title">Рассылки отчётов</div>
            <div className="wh-modal__sub">Приходят на почту по расписанию</div>
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="wh-modal__body">
          {state.loading ? (
            <div className="wh-table__loading"><div className="loading-spinner" /></div>
          ) : (
            <>
              {!state.deliverable && (
                <div className="wh-note wh-note--warn">
                  <AlertTriangle size={15} />
                  <div>
                    В вашей карточке не указан адрес электронной почты — письма
                    отправить некуда. Попросите администратора заполнить его.
                  </div>
                </div>
              )}

              {!state.items.length ? (
                <div className="wh-empty">
                  Рассылок нет: они приходят по тем отчётам, к которым у вас есть доступ.
                </div>
              ) : (
                <div className="wh-form">
                  {state.items.map(item => (
                    <label key={item.code} className="wh-mailing__row">
                      <input type="checkbox" checked={item.enabled} disabled={saving === item.code}
                             onChange={e => toggle(item.code, e.target.checked)} />
                      <span>
                        <b>{item.label}</b>
                        <span className="wh-cell-sub"> · {item.schedule}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="wh-note wh-note--subtle">
                <Check size={15} />
                <div>
                  Письмо приходит, только когда есть о чём сообщить, и содержит
                  позиции ваших кабинетов. Отписка не закрывает сам отчёт — он
                  остаётся доступен здесь, в разделе отчётов.
                  {state.email ? ` Адрес доставки: ${state.email}.` : ''}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

function summaryLabel(k) {
  return {
    total: 'Всего', done: 'Выполнено', onTime: 'В срок', deviated: 'С отклонением',
    overdue: 'Просрочено', totalCost: 'Затраты, ₽', downtimeHours: 'Простой, ч',
    byType: 'По типам', expired: 'Просрочено', within30: 'Истекает 30 дн.',
    within90: 'Истекает 90 дн.', writeOffLast12Months: 'Списано за 12 мес.',
    amount: 'Сумма, ₽', prevAmount: 'Пред. период, ₽', count: 'Позиций',
    initialCost: 'Первоначальная, ₽', accumulated: 'Накоплено, ₽', residual: 'Остаточная, ₽',
    fullyDepreciatedInUse: 'Самортизировано, в работе',
  }[k] || k;
}
