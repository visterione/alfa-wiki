import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Map, Boxes, Package, BarChart3, ScanLine, DoorOpen,
  PencilRuler, Lock, ShieldCheck, ArrowRightLeft, ClipboardCheck, FileSpreadsheet,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import WarehouseMap from './WarehouseMap';
import FloorPlanEditor from './FloorPlanEditor';
import WarehouseAssets from './WarehouseAssets';
import WarehouseStock from './WarehouseStock';
import WarehouseRoom from './WarehouseRoom';
import WarehouseReports from './WarehouseReports';
import WarehouseScanner from './WarehouseScanner';
import WarehouseAccess from './WarehouseAccess';
import WarehouseOperations from './WarehouseOperations';
import WarehouseInventory from './WarehouseInventory';
import WarehouseRooms from './WarehouseRooms';
import WarehouseOsv from './WarehouseOsv';
import './Warehouse.css';

/**
 * Складской учёт — оболочка модуля.
 *
 * Дерево локаций загружается здесь один раз и передаётся вкладкам: его читает
 * почти каждый экран, и тянуть его на каждом переключении вкладки означало бы
 * четыре одинаковых запроса за минуту работы.
 *
 * Состав вкладок зависит от уровня доступа, который считает сервер
 * (GET /warehouse/access). Клиент не выводит права сам: то, что человек не видит
 * кнопку, ничего не значит — решение принимается на бэкенде, здесь только не
 * показываем то, чем он всё равно не сможет воспользоваться.
 */

const TABS = [
  { key: 'map',       label: 'Карта',            icon: Map },
  // Дашборд кабинета — рабочий экран, а не приложение к карте. Раньше он жил
  // только внутри карты и появлялся во вкладках призраком после клика по плану;
  // теперь у него своя вкладка со списком кабинетов, и он открывается в два клика
  // из любого места модуля.
  { key: 'rooms',     label: 'Кабинеты',         icon: DoorOpen },
  { key: 'assets',    label: 'Оборудование',     icon: Package },
  { key: 'stock',     label: 'Материалы',        icon: Boxes },
  { key: 'operations',label: 'Операции',         icon: ArrowRightLeft },
  { key: 'inventory', label: 'Инвентаризация',   icon: ClipboardCheck },
  // Ведомость 1С стоит рядом с отчётами, а не внутри них: это не отчёт портала, а
  // чужие данные, которые портал показывает как есть. Внутри вкладки отчётов она
  // читалась бы как ещё один наш расчёт — и расхождение с бухгалтерией выглядело
  // бы нашей ошибкой.
  { key: 'osv',       label: 'Ведомость 1С',     icon: FileSpreadsheet, needsReport: 'RPT-OSV' },
  { key: 'reports',   label: 'Отчёты',           icon: BarChart3 },
  { key: 'scanner',   label: 'Сканер',           icon: ScanLine },
  { key: 'plans',     label: 'Планы помещений',  icon: PencilRuler,   needs: 'canEditPlans' },
  // Матрицу доступа видят все: знать, кому что положено, полезно и рядовому
  // пользователю — он поймёт, к кому идти за правами. Настраивает — админ модуля.
  { key: 'access',    label: 'Доступ',           icon: ShieldCheck },
];

export default function Warehouse() {
  const [access, setAccess] = useState(null);
  const [tree, setTree] = useState(null);
  const [tab, setTab] = useState('map');
  const [openRoomId, setOpenRoomId] = useState(null);
  const [openAssetId, setOpenAssetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const tabsRef = React.useRef(null);
  const [tabSlider, setTabSlider] = useState({ left: 0, width: 0, duration: 0 });

  React.useLayoutEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return undefined;

    const recalc = (animate) => {
      const active = nav.querySelector('.wh-tab.is-active');
      if (!active) return;
      const left = active.offsetLeft;
      setTabSlider(previous => ({
        left,
        width: active.offsetWidth,
        duration: animate ? Math.min(0.65, 0.3 + Math.abs(left - previous.left) / 2000) : 0,
      }));
    };

    recalc(true);
    const observer = new ResizeObserver(() => recalc(false));
    observer.observe(nav);
    return () => observer.disconnect();
  }, [tab, loading, access]);

  const loadTree = useCallback(async () => {
    try {
      const { data } = await warehouseApi.tree();
      setTree(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить локации');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await warehouseApi.access();
        setAccess(data);
        if (data.allowed) await loadTree();
      } catch (e) {
        setAccess({ allowed: false });
      } finally {
        setLoading(false);
      }
    })();
  }, [loadTree]);

  if (loading) {
    return <div className="wh-app wh-page--center"><div className="loading-spinner" /></div>;
  }

  if (!access?.allowed) {
    return (
      <div className="wh-app wh-page--center">
        <div className="wh-denied">
          <Lock size={30} />
          <h2>Нет доступа к складскому учёту</h2>
          <p>
            Раздел закрыт отдельным правом. Попросите администратора включить доступ
            «Складской учёт» в вашей карточке пользователя или добавить вас в роль «Склад».
          </p>
        </div>
      </div>
    );
  }

  // Вкладка скрывается либо по возможности, либо по матрице отчётов — второе
  // нужно там, где вся вкладка это один отчёт: без роли из матрицы она открылась
  // бы пустой с ошибкой доступа, а не отсутствовала.
  const visibleTabs = TABS.filter(t => (
    (!t.needs || access.capabilities?.[t.needs])
    && (!t.needsReport || (access.reports || []).some(r => r.code === t.needsReport))
  ));

  const openRoom = (roomId) => {
    setOpenRoomId(roomId);
    setTab('rooms');
  };

  // Инвентарный номер в отчётах — ссылка на карточку актива (гр. 4 отчёта № 2 и
  // гр. 1 отчёта № 5 ТЗ). Переход идёт на вкладку оборудования, а не открывает
  // модалку поверх отчёта: из карточки дальше ходят в ТО, документы и историю.
  const openAsset = (assetId) => {
    setOpenAssetId(assetId);
    setTab('assets');
  };

  return (
    <div className="wh-app">
      <nav className="wh-tabs wh-tabs--main" ref={tabsRef}>
        <div
          className="wh-tabs__slider"
          style={{
            left: tabSlider.left,
            width: tabSlider.width,
            '--slider-duration': `${tabSlider.duration}s`,
          }}
        />
        {visibleTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key}
                    className={`wh-tab ${tab === t.key ? 'is-active' : ''}`}
                    onClick={() => {
                      // Клик по самой вкладке «Кабинеты» всегда возвращает к списку:
                      // иначе, стоя на дашборде, по ней ничего не происходит — и
                      // выглядит это как сломанная вкладка.
                      if (t.key === 'rooms') setOpenRoomId(null);
                      setTab(t.key);
                    }}
                    aria-current={tab === t.key ? 'page' : undefined}>
              <Icon size={16} />
              <span className="wh-tab__label">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="wh-body">
        {tab === 'map' && (
          <WarehouseMap access={access} tree={tree} onReloadTree={loadTree} onOpenRoom={openRoom} />
        )}
        {/* Вкладка «Кабинеты» — это либо список, либо дашборд выбранного кабинета.
            Выход из дашборда возвращает в список, а не на карту: пришёл человек
            сюда, скорее всего, тоже из списка. */}
        {tab === 'rooms' && (openRoomId ? (
          <WarehouseRoom roomId={openRoomId} access={access} onBack={() => setOpenRoomId(null)} />
        ) : (
          <WarehouseRooms tree={tree} onOpenRoom={openRoom} access={access} onReloadTree={loadTree} />
        ))}
        {tab === 'assets' && (
          <WarehouseAssets access={access} tree={tree} onOpenRoom={openRoom}
                           initialAssetId={openAssetId}
                           onInitialAssetShown={() => setOpenAssetId(null)} />
        )}
        {tab === 'stock' && (
          <WarehouseStock access={access} tree={tree} />
        )}
        {tab === 'operations' && (
          <WarehouseOperations access={access} tree={tree} />
        )}
        {tab === 'inventory' && (
          <WarehouseInventory access={access} tree={tree} />
        )}
        {tab === 'osv' && (
          <WarehouseOsv access={access} tree={tree} onReloadTree={loadTree} />
        )}
        {tab === 'reports' && (
          <WarehouseReports access={access} tree={tree} onOpenAsset={openAsset} />
        )}
        {tab === 'scanner' && (
          <WarehouseScanner onOpenRoom={openRoom} />
        )}
        {tab === 'plans' && (
          <FloorPlanEditor tree={tree} departments={tree?.departments} onReloadTree={loadTree} />
        )}
        {tab === 'access' && <WarehouseAccess access={access} />}
      </div>
    </div>
  );
}
