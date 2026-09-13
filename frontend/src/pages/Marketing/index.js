/**
 * Модуль «Маркетинг» (ver. 8.22).
 *
 * Три вкладки — акции, рекламные площадки и анонсы — собраны в один раздел.
 * До 8.22 они лежали в трёх разных местах: акции и карта — самостоятельными
 * HTML-страницами в backend/bot/, вставленными в вики, а анонсы — отдельной
 * кнопкой в полосе быстрого доступа. Маркетолог ходил между ними через поиск
 * по вики, потому что в сайдбаре было видно только третью из них.
 *
 * Вкладка выбирается адресом (/marketing/promotions), а не состоянием: на
 * рабочую вкладку нужна ссылка, которую можно переслать в чат, и возврат
 * «назад» должен возвращать на предыдущую вкладку, а не из модуля целиком.
 */

import React, { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Map as MapIcon, Megaphone, Tag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import PromotionsTab from './PromotionsTab';
import AdsTab from './AdsTab';
import AnnouncementsTab from './AnnouncementsTab';
import '../admin/AdminOpenLine.css';
import '../Announcements.css';
import './Marketing.css';

const TABS = [
  { key: 'promotions',    path: 'promotions',    label: 'Акции',   icon: Tag },
  { key: 'ads',           path: 'ads',           label: 'Рекламы', icon: MapIcon },
  { key: 'announcements', path: 'announcements', label: 'Анонсы',  icon: Megaphone }
];

/**
 * Уровень доступа к вкладке: 'block' | 'read' | 'edit'.
 * Повторяет marketingLevel из backend/middleware/auth.js — сервер всё равно
 * проверяет сам, здесь это только про то, что показывать.
 */
export function useMarketingLevels() {
  const { user, isAdmin } = useAuth();
  return useMemo(() => {
    const raw = user?.adminAccess?.marketing || {};
    const level = key => {
      if (isAdmin) return 'edit';
      return raw[key] === 'read' || raw[key] === 'edit' ? raw[key] : 'block';
    };
    return {
      promotions: level('promotions'),
      ads: level('ads'),
      announcements: level('announcements')
    };
  }, [user, isAdmin]);
}

export default function Marketing() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const levels = useMarketingLevels();

  const visible = TABS.filter(t => levels[t.key] !== 'block');

  // Человек может иметь доступ к одной вкладке из трёх, и тогда адрес модуля
  // без вкладки должен вести именно к ней, а не к первой по списку.
  if (!visible.length) return <Navigate to="/" replace />;
  if (!tab || !visible.some(t => t.path === tab)) {
    return <Navigate to={`/marketing/${visible[0].path}`} replace />;
  }

  const active = visible.find(t => t.path === tab);

  return (
    <div className="admin-page">
      <div className="ola-shell mk-shell">
        <div className="ola-head mk-head">
          <span className="ann-title-icon"><Megaphone size={22} /></span>
          <div>
            <h1>Маркетинг</h1>
            <p>Акции в МИС, карта рекламных площадок и рассылки</p>
          </div>
        </div>

        {/* Один орган управления модулем. Вкладку, которой у человека нет,
            не показываем вовсе — замок здесь был бы обещанием, что доступ
            когда-то появится, а у регистратора он и не должен появиться. */}
        {visible.length > 1 && (
          <nav className="ola-tabs">
            {visible.map(t => (
              <button
                key={t.key}
                className={`ola-tab ${t.path === tab ? 'active' : ''}`}
                onClick={() => navigate(`/marketing/${t.path}`)}
              >
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </nav>
        )}

        {active.key === 'promotions' && <PromotionsTab level={levels.promotions} />}
        {active.key === 'ads' && <AdsTab level={levels.ads} />}
        {active.key === 'announcements' && <AnnouncementsTab level={levels.announcements} />}
      </div>
    </div>
  );
}
