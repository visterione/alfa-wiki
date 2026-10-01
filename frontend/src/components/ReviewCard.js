import React, { forwardRef } from 'react';
import { MessageSquare, Calendar, User, Clock, Paperclip, Download } from 'lucide-react';
import {
  getStatusLabel,
  getRatingStars,
  platformRemovedLabel,
  formatDuration,
  getStageUrgency
} from '../utils/reviewConstants';
import PlatformLogo from './PlatformLogo';

/**
 * Карточка отзыва — та, что лежит в колонках доски.
 *
 * Вынесена из доски (ver. 9.18), когда над списком досок появилась лента
 * «Мои отзывы»: карточки в ней должны выглядеть как на доске — тон по
 * оценке, врач, таймер этапа, — иначе один и тот же отзыв читался бы в двух
 * местах по-разному.
 *
 * ref и прочие свойства уходят на корневой элемент: доска оборачивает
 * карточку в Draggable и передаёт его свойства сюда. Свои дополнения место
 * показа кладёт в metaExtra (строка площадки и даты) и footerExtra (низ).
 */
const ReviewCard = forwardRef(({
  review,
  nowTick,
  className = '',
  unread = false,
  onDownloadPdf,
  metaExtra,
  footerExtra,
  ...rest
}, ref) => {
  const tone = review.rating <= 3 ? 'negative' : 'positive';
  return (
    <div ref={ref} {...rest} className={`review-card ${tone}${className ? ` ${className}` : ''}`}>
      <div className="card-header">
        <div className="card-header-top">
          <span className="patient-name">{review.patientName}</span>
          <div className="card-header-right">
            {unread && (
              <span className={`card-unread-badge card-unread-badge--${tone}`} title="Есть непрочитанные комментарии">
                <span className="card-unread-count">{review.commentCount}</span>
                <MessageSquare size={13} className="card-unread-icon" />
              </span>
            )}
            <span className={`rating ${tone}`}>
              {getRatingStars(review.rating)}
            </span>
          </div>
        </div>
        <div className="card-meta">
          <span className="platform">
            <PlatformLogo name={review.platform?.name} />
            {review.platform?.name}
          </span>
          <span className="date">
            <Calendar size={12} />
            {new Date(review.reviewDate).toLocaleDateString('ru-RU')}
          </span>
          {review.platformRemovedAt && (
            <span className="removed-badge" title={platformRemovedLabel(review)}>
              Удалён
            </span>
          )}
          {metaExtra}
        </div>
      </div>

      {review.doctorName && (
        <div className="card-doctor">
          <User size={12} />
          {review.doctorName}
        </div>
      )}

      {review.reviewText && <p className="card-text">{review.reviewText}</p>}

      <div className="card-footer">
        {review.status !== 'final' && review.stageEnteredAt && (() => {
          const urgency = getStageUrgency(review.stageEnteredAt, nowTick);
          return (
            <span
              className={`card-stage-timer card-stage-timer--${urgency.level}`}
              title={`На этапе «${getStatusLabel(review.status)}»: ${formatDuration(review.stageEnteredAt, nowTick)} · ${urgency.label}`}
            >
              <Clock size={12} />
              {formatDuration(review.stageEnteredAt, nowTick)}
            </span>
          );
        })()}
        {review.attachments && review.attachments.length > 0 && (
          <div className="card-attachments">
            <Paperclip size={12} />
            {review.attachments.length}
          </div>
        )}
        {footerExtra}
        {review.reportPdfPath && onDownloadPdf && (
          <button
            className="btn-pdf"
            onClick={(e) => { e.stopPropagation(); onDownloadPdf(review); }}
            title="Скачать PDF"
          >
            <Download size={12} />
          </button>
        )}
      </div>
    </div>
  );
});

ReviewCard.displayName = 'ReviewCard';

export default ReviewCard;
