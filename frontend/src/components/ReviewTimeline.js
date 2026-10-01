import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Paperclip, Reply } from 'lucide-react';
import { BASE_URL } from '../services/api';
import { REVIEW_STATUSES, HISTORY_ACTION_LABELS } from '../utils/reviewConstants';
import { fileUrl } from '../utils/fileUrl';
import { MisAvatar } from './MisBadge';

/**
 * Текст из блока «Официальный ответ» карточки: опубликованный ответ, а пока
 * его нет (отправляется, проверяется) — последний отправленный из истории.
 * Та же логика, что у самого блока.
 */
export const officialReplyText = (review) => {
  if (!review?.isAutoImported) return '';
  if (review.syncMeta?.replyText) return review.syncMeta.replyText;
  const last = (review.history || [])
    .filter(e => e.action === 'replied')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  return last?.comment || '';
};

// Площадки при публикации меняют пробелы и переводы строк — сравниваем по словам.
const sameText = (a, b) => !!b && a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * История отзыва и его официальный ответ на площадке.
 *
 * Вынесено из окна отзыва на доске (ver. 9.18), когда появился экран «Мои
 * отзывы»: там нужна та же лента, и две копии разошлись бы при первой же
 * правке — а здесь много тонкостей вроде схлопывания повторного ответа.
 */
export default function ReviewTimeline({ review }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="history-timeline">
        {review.history && [...review.history]
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .map(entry => {
            const isComment = entry.action === 'comment';
            const date = new Date(entry.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const userName = entry.user?.displayName || entry.user?.username;
            const colorByLabel = (label) => REVIEW_STATUSES.find(s => s.label === label)?.color || '#6b7280';

            if (isComment) {
              const avatarUrl = fileUrl(entry.user?.avatar);
              return (
                <div key={entry.id} className="history-comment">
                  <MisAvatar userId={entry.user?.id} size={32}>
                    <div className="comment-avatar" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>
                      {avatarUrl
                        ? <img src={avatarUrl} alt="" />
                        : <div className="comment-avatar-placeholder"><User size={16} /></div>
                      }
                    </div>
                  </MisAvatar>
                  <div className="comment-body">
                    <div className="history-comment-header">
                      <span className="comment-user" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>{userName}</span>
                      <span className="comment-date">{date}</span>
                    </div>
                    {entry.comment && <div className="comment-bubble">{entry.comment}</div>}
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="comment-attachments-list">
                        {entry.attachments.map((file, idx) => (
                          <a
                            key={idx}
                            href={`${BASE_URL}/${file.path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="comment-attachment-link"
                          >
                            <Paperclip size={12} />
                            <span>{file.filename}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            let systemContent;
            switch (entry.action) {
              case 'created':
                systemContent = <>Отзыв создан — {userName} | {date}</>;
                break;
              case 'status_change':
                systemContent = (
                  <>
                    Статус изменён:{' '}
                    <span style={{ color: colorByLabel(entry.oldValue), fontWeight: 500 }}>{entry.oldValue}</span>
                    {' → '}
                    <span style={{ color: colorByLabel(entry.newValue), fontWeight: 600 }}>{entry.newValue}</span>
                    {' | '}{userName} | {date}
                  </>
                );
                break;
              case 'assignment':
                systemContent = <>Назначены: <strong>{entry.newValue}</strong> | {userName} | {date}</>;
                break;
              case 'file_upload':
                systemContent = <>{userName} загрузил файл | {date}</>;
                break;
              case 'finalized':
                systemContent = <>Отзыв финализирован: <strong>{entry.newValue}</strong> | {userName} | {date}</>;
                break;
              case 'replied':
                // Тот же текст стоит ниже в «Официальном ответе» —
                // второй раз подряд он только сбивает. В истории
                // остаётся кто и когда ответил; текст показываем,
                // лишь если он разошёлся с опубликованным (ответ
                // переписали и отправили заново).
                if (entry.comment && sameText(entry.comment, officialReplyText(review))) {
                  systemContent = <>Ответ на площадке | {userName} | {date}</>;
                  break;
                }
                return (
                  <div key={entry.id} className="history-comment history-reply">
                    <MisAvatar userId={entry.user?.id} size={32}>
                      <div className="comment-avatar" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>
                        {entry.user?.avatar
                          ? <img src={fileUrl(entry.user.avatar)} alt="" />
                          : <div className="comment-avatar-placeholder"><Reply size={16} /></div>
                        }
                      </div>
                    </MisAvatar>
                    <div className="comment-body">
                      <div className="history-comment-header">
                        <span className="comment-user" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>{userName}</span>
                        <span className="reply-badge"><Reply size={11} /> Ответ на площадке</span>
                        <span className="comment-date">{date}</span>
                      </div>
                      {entry.comment && <div className="comment-bubble comment-bubble--reply">{entry.comment}</div>}
                    </div>
                  </div>
                );
              default:
                systemContent = <>{HISTORY_ACTION_LABELS[entry.action] || entry.action} | {userName} | {date}</>;
            }

            return (
              <div key={entry.id} className="history-system">
                <span className="system-text">{systemContent}</span>
              </div>
            );
          })}
      </div>

      {/* Официальный ответ на площадке. Показываем у любого
          автоимпортированного отзыва, где он есть: и у архива
          GetLoyalty, и у пришедших от парсера */}
      {review.isAutoImported && (() => {
        const meta = review.syncMeta || {};
        const platformReply = meta.replyText || null;
        const historyReply = !platformReply
          ? review.history?.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).find(e => e.action === 'replied')
          : null;
        const hasReply = !!(platformReply || historyReply);
        if (!hasReply) return null;
        const replyText_ = platformReply || historyReply?.comment || '';
        const replyDate_ = platformReply
          ? (meta.replyDate ? new Date(meta.replyDate).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null)
          : (historyReply ? new Date(historyReply.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);
        const isFailed = meta.replyFailed;
        const isSending = meta.replySending && !isFailed;
        const isRejected = meta.replyRejected && !isFailed;
        const isUnverified = meta.replyUnverified && !isFailed;
        const isPending = meta.replyPending && !isUnverified && !isFailed;
        return (
          <div className={`reply-to-platform${isFailed ? ' reply-to-platform--failed' : ''}`}>
            <div className="reply-to-platform__header">
              <Reply size={14} />
              <span>Официальный ответ</span>
              {isFailed && <span className="reply-failed-badge">Не опубликовано</span>}
              {isRejected && <span className="reply-failed-badge">Отклонён модерацией</span>}
              {isSending && <span className="reply-pending-badge">Отправляется</span>}
              {isUnverified && <span className="reply-pending-badge">Проверяется публикация</span>}
              {isPending && <span className="reply-pending-badge">На модерации</span>}
              {replyDate_ && <span className="reply-header-date">{replyDate_}</span>}
            </div>
            <div className="reply-sent">{replyText_}</div>
            {isFailed && (
              <div className="reply-failed-note">
                {meta.replyError
                  ? `Площадка не приняла ответ: ${meta.replyError}. Отправьте его повторно.`
                  : 'Ответ не зафиксирован на площадке. Отправьте его повторно.'}
              </div>
            )}
            {isRejected && (
              <div className="reply-failed-note">
                {meta.replyRejectReason
                  ? `Причина: ${meta.replyRejectReason}`
                  : 'Площадка не пропустила ответ. Исправьте текст и отправьте заново.'}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}
