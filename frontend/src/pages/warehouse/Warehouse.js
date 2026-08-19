import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Map, Boxes, Package, BarChart3, DoorOpen,
  Lock, ArrowRightLeft, ClipboardCheck, FileSpreadsheet,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import WarehouseMap from './WarehouseMap';
import WarehouseAssets from './WarehouseAssets';
import WarehouseStock from './WarehouseStock';
import WarehouseRoom from './WarehouseRoom';
import WarehouseReports from './WarehouseReports';
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
 * Состав вкладок приходит с сервера готовым: GET /warehouse/access отдаёт
 * access.tabs — карту «вкладка → показывать ли», рассчитанную по дереву прав
 * пользователя. Клиент права не выводит: то, что человек не видит кнопку, ничего
 * не значит — решение принимается на бэкенде, здесь только не показываем то, чем
 * он всё равно не сможет воспользоваться.
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
  { key: 'osv',       label: 'Импорт',           icon: FileSpreadsheet },
  { key: 'reports',   label: 'Отчёты',           icon: BarChart3 },
  // Отдельной вкладки «Сканер» здесь нет намеренно. У браузера камера есть только
  // на телефоне, и то не везде: распознавание держится на BarcodeDetector, которого
  // нет в Safari, — на iPhone веб-сканер не работал вовсе. За ПК камеры нет, а
  // ручной сканер в режиме клавиатуры набивает код в поиск «Оборудования» — там он
  // и разбирается, включая ссылку из QR. Камера для пересчёта осталась внутри
  // инвентаризации, а полноценное сканирование живёт в мобильном приложении.
  //
  // Вкладки «Планы помещений» здесь тоже нет: редактор планов открывается изнутри
  // карты кнопкой на том медцентре или этаже, который человек уже нашёл. Отдельной
  // вкладкой он требовал выбрать медцентр, корпус и этаж второй раз — селектами,
  // после того как ровно то же место было выбрано щелчками по карте.
  //
  // Вкладки «Доступ» здесь нет с ver. 7.03. Права модуля настраиваются в дереве
  // прав карточки пользователя, вместе с остальными правами портала. Внутри
  // модуля жила матрица должностей и её экран настройки — то есть права правились
  // в двух местах, и понять, где именно человеку не хватает права, было нельзя.
];

export default function Warehouse() {
  // Кабинет из адреса — это QR с двери: /warehouse?room=<id>. Читаем параметр
  // один раз при монтировании и дальше живём своим состоянием, иначе возврат к
  // списку тут же снова открывал бы кабинет из всё того же адреса.
  const roomFromUrl = React.useMemo(
    () => new URLSearchParams(window.location.search).get('room'), []);

  const [access, setAccess] = useState(null);
  const [tree, setTree] = useState(null);
  const [tab, setTab] = useState(roomFromUrl ? 'rooms' : null);
  const [openRoomId, setOpenRoomId] = useState(roomFromUrl);
  const [openAssetId, setOpenAssetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const tabsRef = React.useRef(null);
  const [tabSlider, setTabSlider] = useState({ left: 0, width: 0, duration: 0 });

  // Вкладка по умолчанию — первая доступная. Жёсткая «Карта» открывалась пустым
  // экраном у того, кому карта не выдана, хотя другие вкладки у него есть.
  useEffect(() => {
    if (tab || !access?.allowed) return;
    const first = TABS.find(t => access.tabs?.[t.key]);
    if (first) setTab(first.key);
  }, [tab, access]);

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

  // Состав вкладок целиком с сервера: access.tabs — это карта «ключ вкладки →
  // показывать ли», посчитанная по дереву прав. Отсутствующий ключ считаем
  // закрытым, а не открытым: неизвестное право безопаснее не показывать.
  const visibleTabs = TABS.filter(t => access.tabs?.[t.key]);

  if (!visibleTabs.length) {
    return (
      <div className="wh-app wh-page--center">
        <div className="wh-denied">
          <Lock size={30} />
          <h2>Права в модуле не выданы</h2>
          <p>
            Доступ к разделу открыт, но ни один экран пока не отмечен. Попросите
            администратора выставить права в дереве прав вашей карточки
            пользователя — раздел «Складской учёт».
          </p>
        </div>
      </div>
    );
  }

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
      </div>
    </div>
  );
}
