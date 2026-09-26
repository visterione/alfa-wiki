import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { reviews } from '../services/api';

/**
 * Варианты ответа на отзыв от локальной модели Альфа Парсера (ver. 8.90).
 *
 * Это подсказки: клик кладёт вариант в поле ответа, где его можно править, а
 * отправляет по-прежнему человек кнопкой «Ответить на площадке». Само по себе
 * ничего никуда не уходит.
 *
 * Модель пишет минуту-две. Пока варианты готовятся, блок раз в десять секунд
 * перечитывает карточку — чтобы не заставлять человека закрывать и открывать
 * её заново.
 */
const POLL_MS = 10000;

function ReviewReplyDrafts({ review, onPick, onReviewUpdate }) {
  const [requesting, setRequesting] = useState(false);
  const drafts = review.syncMeta?.drafts?.items || [];
  const pending = !!review.syncMeta?.draftsPending;

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(async () => {
      try {
        const res = await reviews.getReview(review.id);
        onReviewUpdate(res.data);
      } catch (_) { /* перечитаем на следующем шаге */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, review.id, onReviewUpdate]);

  const requestMore = async () => {
    try {
      setRequesting(true);
      const res = await reviews.requestDrafts(review.id);
      onReviewUpdate({ ...review, syncMeta: res.data.syncMeta });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось запросить варианты');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="reply-drafts">
      <div className="reply-drafts__header">
        <Sparkles size={14} />
        <span>Варианты ответа</span>
        <button
          type="button"
          className="reply-drafts__more"
          onClick={requestMore}
          disabled={pending || requesting}
          title="Модель напишет новые варианты вместо этих"
        >
          <RefreshCw size={13} className={pending ? 'reply-drafts__spin' : ''} />
          {pending ? 'Пишем…' : drafts.length ? 'Ещё варианты' : 'Предложить'}
        </button>
      </div>

      {drafts.length > 0 && (
        <div className="reply-drafts__list">
          {drafts.map((text, i) => (
            <button
              key={i}
              type="button"
              className="reply-drafts__item"
              onClick={() => onPick(text)}
              title="Подставить в поле ответа"
            >
              <span className="reply-drafts__text">{text}</span>
            </button>
          ))}
        </div>
      )}

      {!drafts.length && pending && (
        <div className="reply-drafts__empty">Модель пишет варианты, обычно это минута-две.</div>
      )}
    </div>
  );
}

export default ReviewReplyDrafts;
