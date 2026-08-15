import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Единая панель периода для дня, графика, загрузки и отчётов. */
export default function PeriodControl({ label, views, view, onView, onPrevious, onNext, onToday, trailing }) {
  return (
    <div className="tsk-periodbar">
      {views?.length ? (
        <div className="tsk-period-modes">
          {views.map(([key, title]) => (
            <button key={key} className={view === key ? 'is-on' : ''} onClick={() => onView(key)}>
              {title}
            </button>
          ))}
        </div>
      ) : <div className="tsk-period-spacer" />}

      <div className="tsk-period-nav">
        <button onClick={onPrevious} aria-label="Предыдущий период"><ChevronLeft size={17} /></button>
        <div className="tsk-period-label">{label}</div>
        <button onClick={onNext} aria-label="Следующий период"><ChevronRight size={17} /></button>
      </div>

      <div className="tsk-period-actions">
        {onToday && <button onClick={onToday}>Сегодня</button>}
        {trailing}
      </div>
    </div>
  );
}
