import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Map, Boxes, Package, Wrench, ClipboardList, BarChart3, ScanLine,
  PencilRuler, Lock, ShoppingCart,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { warehouseApi } from '../../services/api';
import WarehouseMap from './WarehouseMap';
import FloorPlanEditor from './FloorPlanEditor';
import WarehouseAssets from './WarehouseAssets';
import WarehouseStock from './WarehouseStock';
import WarehouseRoom from './WarehouseRoom';
import WarehouseReports from './WarehouseReports';
import WarehouseScanner from './WarehouseScanner';
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
  { key: 'assets',    label: 'Оборудование',     icon: Package },
  { key: 'stock',     label: 'Материалы',        icon: Boxes },
  { key: 'operations',label: 'Операции',         icon: Wrench,        needs: 'canIssue' },
  { key: 'inventory', label: 'Инвентаризация',   icon: ClipboardList, needs: 'canInventory' },
  { key: 'reports',   label: 'Отчёты',           icon: BarChart3 },
  { key: 'scanner',   label: 'Сканер',           icon: ScanLine },
  { key: 'plans',     label: 'Планы помещений',  icon: PencilRuler,   needs: 'canEditPlans' },
];

export default function Warehouse() {
  const { user } = useAuth();
  const [access, setAccess] = useState(null);
  const [tree, setTree] = useState(null);
  const [tab, setTab] = useState('map');
  const [openRoomId, setOpenRoomId] = useState(null);
  const [loading, setLoading] = useState(true);

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
    return <div className="wh-page wh-page--center"><div className="loading-spinner" /></div>;
  }

  if (!access?.allowed) {
    return (
      <div className="wh-page wh-page--center">
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

  const visibleTabs = TABS.filter(t => !t.needs || access.capabilities?.[t.needs]);

  const openRoom = (roomId) => {
    setOpenRoomId(roomId);
    setTab('room');
  };

  return (
    <div className="wh-page">
      <header className="wh-header">
        <div className="wh-header__title">
          <h1>Складской учёт</h1>
          <div className="wh-header__meta">
            <span className={`wh-level wh-level--${access.level}`}>{levelLabel(access.level)}</span>
            {/* Про 1С говорим прямо в шапке модуля: иначе первый вопрос на
                демонстрации — «а где синхронизация с бухгалтерией». */}
            {!access.integrations?.oneC?.enabled && (
              <span className="wh-badge wh-badge--neutral" title={access.integrations?.oneC?.reason}>
                1С не подключена — данные ведутся в портале
              </span>
            )}
          </div>
        </div>
      </header>

      <nav className="wh-tabs">
        {visibleTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key}
                    className={`wh-tab ${tab === t.key ? 'is-active' : ''}`}
                    onClick={() => setTab(t.key)}>
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
        {tab === 'room' && (
          <button className="wh-tab is-active"><Boxes size={16} /> Кабинет</button>
        )}
      </nav>

      <div className="wh-body">
        {tab === 'map' && (
          <WarehouseMap access={access} tree={tree} onReloadTree={loadTree} onOpenRoom={openRoom} />
        )}
        {tab === 'assets' && (
          <WarehouseAssets access={access} tree={tree} onOpenRoom={openRoom} />
        )}
        {tab === 'stock' && (
          <WarehouseStock access={access} tree={tree} />
        )}
        {tab === 'operations' && (
          <WarehouseReports access={access} tree={tree} initialReport="movements" />
        )}
        {tab === 'inventory' && (
          <WarehouseReports access={access} tree={tree} initialReport="inventory" />
        )}
        {tab === 'reports' && (
          <WarehouseReports access={access} tree={tree} />
        )}
        {tab === 'scanner' && (
          <WarehouseScanner onOpenRoom={openRoom} />
        )}
        {tab === 'plans' && (
          <FloorPlanEditor tree={tree} departments={tree?.departments} onReloadTree={loadTree} />
        )}
        {tab === 'room' && openRoomId && (
          <WarehouseRoom roomId={openRoomId} access={access} onBack={() => setTab('map')} />
        )}
      </div>
    </div>
  );
}

function levelLabel(level) {
  return {
    admin: 'Администратор модуля',
    warehouse: 'Заведующий складом',
    department: 'Заведующий отделением',
    viewer: 'Только просмотр',
  }[level] || level;
}
