/**
 * Модуль «Маркетинг» (ver. 8.22).
 *
 * Пять вкладок — акции, карта рекламных площадок, анонсы через ботов и
 * почтовые рассылки — собраны в один раздел. До 8.22 они лежали в трёх разных местах: акции и карта —
 * самостоятельными HTML-страницами в backend/bot/, вставленными в вики, а
 * анонсы — отдельной кнопкой в полосе быстрого доступа. Маркетолог ходил между
 * ними через поиск по вики, потому что в сайдбаре было видно только третью.
 *
 * Вкладка выбирается адресом (/marketing/promotions), а не состоянием: на
 * рабочую вкладку нужна ссылка, которую можно переслать в чат, и возврат
 * «назад» должен возвращать на предыдущую вкладку, а не из модуля целиком.
 *
 * Собственной шапки у модуля нет. Заголовок «Маркетинг» с иконкой и подписью
 * съедал верхнюю четверть экрана, ничего не сообщая: человек и так знает, куда
 * зашёл, — он только что нажал пункт меню. Вместо неё одна рабочая строка, где
 * слева переключатель вкладок, а справа инструменты текущей вкладки. Инструменты
 * приходят из самой вкладки через портал (см. toolsSlot.js): иначе поиск
 * акций пришлось бы держать в состоянии модуля, который про акции ничего не
 * знает, а карта и анонсы получали бы чужое поле ввода.
 */

import React, { useMemo, useState } from 'react';
import { Map as MapIcon, Megaphone, Tag, Mail, Stethoscope } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import PromotionsTab from './PromotionsTab';
import AdsTab from './AdsTab';
import AnnouncementsTab from './AnnouncementsTab';
import MailingsTab from './MailingsTab';
import DoctorsTab from './DoctorsTab';
import { ToolsSlotContext } from './toolsSlot';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import '../admin/AdminOpenLine.css';
import '../Announcements.css';
import './Marketing.css';

const TABS = [
  { key: 'promotions',    path: 'promotions',    label: 'Акции',    icon: Tag },
  { key: 'ads',           path: 'ads',           label: 'Карта',    icon: MapIcon },
  { key: 'announcements', path: 'announcements', label: 'Анонсы',   icon: Megaphone },
  { key: 'mailings',      path: 'mailings',      label: 'Рассылки', icon: Mail },
  { key: 'doctors',        path: 'doctors',        label: 'Врачи',    icon: Stethoscope }
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
      announcements: level('announcements'),
      // Рассылки отделились от анонсов в 8.43, но своего флага в правах не
      // получили: заводить его значило бы раздать всем администраторам новую
      // настройку, о которой никто не просил. Кто вёл анонсы — ведёт и рассылки.
      mailings: level('announcements'),
      doctors: level('doctors')
    };
  }, [user, isAdmin]);
}

export default function Marketing() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const levels = useMarketingLevels();
  // Узел слота лежит в состоянии, а не в ref: ref не вызывает повторную
  // отрисовку, и портал вкладки остался бы пустым до следующего обновления.
  const [toolsSlot, setToolsSlot] = useState(null);

  const visible = TABS.filter(t => levels[t.key] !== 'block');

  // Человек может иметь доступ к одной вкладке из пяти, и тогда адрес
  // модуля без вкладки должен вести именно к ней, а не к первой по списку.
  if (!visible.length) return <Navigate to="/" replace />;
  if (!tab || !visible.some(t => t.path === tab)) {
    return <Navigate to={`/marketing/${visible[0].path}`} replace />;
  }

  const active = visible.find(t => t.path === tab);

  return (
    <div className="admin-page">
      <div className={`ola-shell mk-shell mk-shell-${active.key}`}>
        <div className="mk-bar">
          {/* Вкладку, которой у человека нет, не показываем вовсе — замок здесь
              был бы обещанием, что доступ когда-то появится, а у регистратора
              он и не должен появиться. */}
          {visible.length > 1 && (
            <nav className="ola-tabs mk-tabs">
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
          <div className="mk-bar-tools" ref={setToolsSlot} />
        </div>

        <ToolsSlotContext.Provider value={toolsSlot}>
          {active.key === 'promotions' && <PromotionsTab level={levels.promotions} />}
          {active.key === 'ads' && <AdsTab level={levels.ads} />}
          {active.key === 'announcements' && <AnnouncementsTab level={levels.announcements} />}
          {active.key === 'mailings' && <MailingsTab level={levels.mailings} />}
          {active.key === 'doctors' && <DoctorsTab level={levels.doctors} />}
        </ToolsSlotContext.Provider>
      </div>
    </div>
  );
}
