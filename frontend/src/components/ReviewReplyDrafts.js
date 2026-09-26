import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, RefreshCw, ChevronLeft, ChevronRight, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { reviews } from '../services/api';

/**
 * Варианты ответа на отзыв от локальной модели Альфа Парсера (ver. 8.90).
 *
 * Это подсказки: «Подставить» кладёт вариант в поле ответа, где его можно
 * править, а отправляет по-прежнему человек кнопкой «Ответить на площадке».
 * Само по себе ничего никуда не уходит.
 *
 * С 8.92 это всплывашка над полем ответа, а не секция в истории: секция
 * растягивала историю у каждого неотвеченного отзыва, а текст вариантов
 * резался до четырёх строк — читать предложенное перед отправкой было
 * нечем. Теперь вариант виден целиком, по одному, со стрелками между ними.
 *
 * Всплывашка рисуется в body и ставится по месту поля ответа: окно деталей
 * со стеклом и прокруткой обрезало бы её, а при короткой истории над полем
 * просто нет места.
 *
 * Модель пишет минуту-две. Пока варианты готовятся, раз в десять секунд
 * перечитываем карточку — даже при закрытой всплывашке, чтобы к её открытию
 * варианты уже были.
 */
const POLL_MS = 10000;
const GAP = 8;

export function useReplyDraftsPolling(review, onReviewUpdate) {
  const pending = !!review?.syncMeta?.draftsPending;
  const id = review?.id;
  useEffect(() => {
    if (!pending || !id) return undefined;
    const timer = setInterval(async () => {
      try {
        const res = await reviews.getReview(id);
        onReviewUpdate(res.data);
      } catch (_) { /* перечитаем на следующем шаге */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, id, onReviewUpdate]);
}

function ReviewReplyDrafts({ review, anchorRef, onPick, onReviewUpdate, onClose }) {
  const [requesting, setRequesting] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState(null);
  const drafts = review.syncMeta?.drafts?.items || [];
  const pending = !!review.syncMeta?.draftsPending;
  const current = Math.min(index, Math.max(drafts.length - 1, 0));

  // Новый набор — с первого варианта
  const draftsAt = review.syncMeta?.drafts?.at;
  useEffect(() => { setIndex(0); }, [draftsAt]);

  // Над полем ответа, по его ширине; высота — сколько есть до верха экрана
  useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({
        left: r.left,
        width: r.width,
        bottom: window.innerHeight - r.top + GAP,
        maxHeight: Math.max(r.top - GAP * 2, 160),
      });
    };
    place();
    window.addEventListener('resize', place);
    // true — ловим прокрутку и внутри окна деталей, не только страницы
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef]);

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

  if (!box) return null;

  return createPortal(
    <div
      className="reply-drafts"
      style={{ left: box.left, width: box.width, bottom: box.bottom, maxHeight: box.maxHeight }}
      onClick={e => e.stopPropagation()}
    >
      <div className="reply-drafts__header">
        <Sparkles size={14} />
        <span>Варианты ответа</span>
        {drafts.length > 1 && (
          <span className="reply-drafts__counter">{current + 1} из {drafts.length}</span>
        )}
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
        <button type="button" className="reply-drafts__close" onClick={onClose} title="Закрыть">
          <X size={16} />
        </button>
      </div>

      {drafts.length > 0 && (
        <>
          <div className="reply-drafts__text">{drafts[current]}</div>
          <div className="reply-drafts__nav">
            {drafts.length > 1 && (<>
            <button
              type="button"
              className="reply-drafts__arrow"
              onClick={() => setIndex(current - 1)}
              disabled={current === 0}
              title="Предыдущий вариант"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="reply-drafts__arrow"
              onClick={() => setIndex(current + 1)}
              disabled={current >= drafts.length - 1}
              title="Следующий вариант"
            >
              <ChevronRight size={16} />
            </button>
            </>)}
            <button
              type="button"
              className="reply-drafts__pick"
              onClick={() => { onPick(drafts[current]); onClose(); }}
            >
              Подставить в ответ
            </button>
          </div>
        </>
      )}

      {!drafts.length && pending && (
        <div className="reply-drafts__empty">Модель пишет варианты, обычно это минута-две.</div>
      )}
    </div>,
    document.body,
  );
}

export default ReviewReplyDrafts;
