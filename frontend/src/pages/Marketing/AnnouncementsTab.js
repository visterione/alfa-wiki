/**
 * Вкладка «Анонсы» — рассылки через ботов в мессенджерах.
 *
 * До 8.22 это был самостоятельный раздел /announcements, до 8.43 — подвкладка
 * «Боты» внутри общих «Анонсов». Почтовые рассылки уехали в отдельную вкладку
 * «Рассылки»: это разные занятия с разными инструментами, и держать их за
 * переключателем, который никто не замечает, было ошибкой.
 *
 * Уровень доступа общий с рассылками (marketing.announcements) и разделён на
 * чтение и правку: историю полезно видеть шире круга тех, кто запускает новые.
 */

import React from 'react';
import BroadcastsTab from '../admin/BroadcastsTab';

export default function AnnouncementsTab({ level }) {
  return (
    <div className="mk-subtabs-wrap">
      <BroadcastsTab level={level} />
    </div>
  );
}
