import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, ChevronDown, Check, ExternalLink, Send, Sparkles, Reply, Kanban, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { reviews } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  getStatusLabel,
  getStatusColor,
  getRatingStars,
  canReplyOnPlatform,
  reviewPublicUrl
} from '../utils/reviewConstants';
import PlatformLogo from './PlatformLogo';
import ReviewCard from './ReviewCard';
import { fileUrl } from '../utils/fileUrl';
import ReviewTimeline from './ReviewTimeline';
import ReviewReplyDrafts, { useReplyDraftsPolling } from './ReviewReplyDrafts';
import '../pages/ReviewBoard.css';
import './MyReviewsStrip.css';

/**
 * «Мои отзывы» (ver. 9.18) — лента назначенных мне отзывов со всех досок над
 * списком досок. Карточка открывает отзыв в окне, где на него можно ответить,
 * а после ответа окно само переходит к следующему — так свои отзывы
 * разбирают подряд, не открывая каждую доску.
 *
 * Сначала это был отдельный экран; заказчик предпочёл ленту на странице
 * досок — свои отзывы видны сразу при входе в раздел, без лишнего перехода.
 *
 * Лента — карусель со стрелками, без полосы прокрутки: сдвиг считается от
 * номера первой видимой карточки, а не от пикселей прокрутки. С прокруткой
 * на 80% ширины ряд к третьему-пятому нажатию съезжал, и крайние карточки
 * стояли наполовину за краем.
 *
 * Перемещать и переназначать здесь нельзя намеренно. Куда отзыв идёт после
 * ответа, решает сценарий доски с триггером «Ответ на площадке»: ответил —
 * сценарий передвинул и передал дальше, и карточка ушла из ленты. Для ручной
 * перестановки есть доска, ссылка на неё — в окне отзыва.
 *
 * Лента перечитывается раз в минуту и при возврате на вкладку: сценарий
 * срабатывает, когда площадка приняла ответ, а это бывает и через несколько
 * минут после отправки.
 */

const REFRESH_MS = 60000;

// Повторы после сбоя загрузки. Раньше неудачный первый запрос оставлял
// ленту пустой до следующего планового — на минуту, и выглядело это как
// «лента не отрисовалась, помогает только перезагрузка».
const RETRY_DELAYS_MS = [3000, 10000, 30000];

// Сколько карточек в ряду. Лента листается страницами ровно по столько —
// так крайние карточки никогда не стоят наполовину за краем.
// Пороги по ширине окна, а не секции: сайдбар забирает почти 300px, и на
// окне уже 1100 четыре карточки становились нечитаемо узкими.
const perViewFor = (width) => (width >= 1100 ? 4 : width >= 700 ? 2 : 1);

// Состояние ответа на площадке по syncMeta — те же поля, что читает карточка
// на доске
const replyState = (review) => {
  const meta = review.syncMeta || {};
  if (meta.replyFailed || meta.replyRejected) return 'redo';
  if (meta.replySending) return 'sending';
  if (meta.replyText || meta.isAnswered) return 'answered';
  return 'none';
};

// 0 — ждут ответа из вики, 1 — ответить из вики нельзя, 2 — уже отвечено.
// Отвеченные в ленте последними: они ждут не меня, а сценарий доски.
const rankOf = (review) => {
  const state = replyState(review);
  if (state === 'sending' || state === 'answered') return 2;
  return canReplyOnPlatform(review) ? 0 : 1;
};

// Внутри — сначала то, что дольше всех стоит на этапе; при равенстве — оценка ниже
const byPriority = (a, b) => {
  const rank = rankOf(a) - rankOf(b);
  if (rank !== 0) return rank;
  const diff = new Date(a.stageEnteredAt) - new Date(b.stageEnteredAt);
  return diff !== 0 ? diff : a.rating - b.rating;
};

/**
 * Знак медцентра в списке выбора — тот же, что на карточке доски: квадратный
 * логотип, если есть, иначе обычный; белая плашка в рамке фирменного цвета.
 * Логотипа нет или не загрузился — пустое место той же ширины, чтобы
 * названия в списке стояли ровно.
 */
function ClinicMark({ medCenter }) {
  const [broken, setBroken] = useState(false);
  const src = fileUrl(medCenter?.logoSquareUrl || medCenter?.logoUrl);
  return (
    <span
      className={`my-reviews__mark${!src || broken ? ' is-empty' : ''}`}
      style={{ '--mc-accent': medCenter?.color || 'var(--accent-500)' }}
    >
      {src && !broken && <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />}
    </span>
  );
}

/**
 * @param {number} expected — сколько отзывов на мне по счётчикам досок. Список
 *   досок приходит раньше ленты, и по нему уже видно, будет ли ей что
 *   показать: если да, место под ленту держим заготовкой с первой секунды,
 *   а не вставляем её потом, сдвигая доски вниз.
 */
const MyReviewsStrip = ({ expected = 0 }) => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [list, setList] = useState([]);
  const [boardFilter, setBoardFilter] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(null); // 'comment' | 'reply'
  const [showDrafts, setShowDrafts] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const [start, setStart] = useState(0);
  const [perView, setPerView] = useState(() => perViewFor(window.innerWidth));
  const [filterOpen, setFilterOpen] = useState(false);

  const filterRef = useRef(null);
  const composerRef = useRef(null);
  const inputRef = useRef(null);
  const openIdRef = useRef(null);
  openIdRef.current = openId;

  // 'loading' — первый ответ ещё не пришёл, 'ready' — список есть,
  // 'error' — все повторы исчерпаны, а показать нечего
  const [status, setStatus] = useState('loading');
  const requestSeqRef = useRef(0);
  const retryTimerRef = useRef(null);
  const attemptRef = useRef(0);

  const loadList = useCallback(async () => {
    // Плановый запрос, возврат на вкладку и повтор могут разминуться — в
    // список попадает только ответ на последний из них
    const seq = ++requestSeqRef.current;
    clearTimeout(retryTimerRef.current);
    try {
      const { data } = await reviews.getAssigned();
      if (seq !== requestSeqRef.current) return;
      attemptRef.current = 0;
      setList(data);
      setStatus('ready');
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('Error loading assigned reviews:', err);
      const delay = RETRY_DELAYS_MS[attemptRef.current];
      if (delay) {
        attemptRef.current += 1;
        retryTimerRef.current = setTimeout(loadList, delay);
      } else {
        // Уже загруженный список при сбое обновления не стираем
        setStatus(current => (current === 'ready' ? current : 'error'));
      }
    }
  }, []);

  const retryNow = () => {
    attemptRef.current = 0;
    setStatus('loading');
    loadList();
  };

  useEffect(() => {
    loadList();
    const timer = setInterval(() => { loadList(); setNowTick(Date.now()); }, REFRESH_MS);
    const onFocus = () => loadList();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      clearTimeout(retryTimerRef.current);
      // Ответ, пришедший после ухода со страницы, уже некуда класть
      requestSeqRef.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [loadList]);

  const boards = useMemo(() => {
    const map = new Map();
    list.forEach(r => { if (r.board) map.set(r.board.id, r.board); });
    return [...map.values()].map(({ id, name, medCenter }) => ({ id, name, medCenter }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [list]);

  // Доска из фильтра опустела — не оставляем человека перед пустой лентой
  useEffect(() => {
    if (boardFilter && !boards.some(b => b.id === boardFilter)) setBoardFilter(null);
  }, [boards, boardFilter]);

  const ordered = useMemo(() => {
    const visible = boardFilter ? list.filter(r => r.board?.id === boardFilter) : list;
    return [...visible].sort(byPriority);
  }, [list, boardFilter]);

  useEffect(() => {
    const onResize = () => setPerView(perViewFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Последняя страница всегда полная: начало не дальше, чем «всего минус ряд».
  // Иначе после ответа или смены фильтра лента показывала бы хвост с пустотой.
  const maxStart = Math.max(0, ordered.length - perView);
  useEffect(() => {
    if (start > maxStart) setStart(maxStart);
  }, [start, maxStart]);

  // Другой медцентр — лента с начала
  useEffect(() => { setStart(0); }, [boardFilter]);

  useEffect(() => {
    if (!filterOpen) return undefined;
    const onDown = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

  const countByBoard = useMemo(() => {
    const counts = {};
    list.forEach(r => { if (r.board) counts[r.board.id] = (counts[r.board.id] || 0) + 1; });
    return counts;
  }, [list]);

  const waitingCount = useMemo(() => ordered.filter(r => rankOf(r) === 0).length, [ordered]);

  useEffect(() => {
    if (!openId) { setDetail(null); return undefined; }
    setText('');
    setShowDrafts(false);
    let cancelled = false;
    reviews.getReview(openId)
      .then(({ data }) => { if (!cancelled) setDetail(data); })
      .catch(err => {
        console.error('Error loading review:', err);
        if (!cancelled) toast.error('Не удалось открыть отзыв');
      });
    return () => { cancelled = true; };
  }, [openId]);

  const applyReviewUpdate = useCallback((updated) => {
    setDetail(current => (current?.id === updated.id ? { ...current, ...updated } : current));
    setList(prev => prev.map(r => (r.id === updated.id ? { ...r, syncMeta: updated.syncMeta } : r)));
  }, []);

  useReplyDraftsPolling(detail, applyReviewUpdate);

  const reloadDetail = async (id) => {
    const { data } = await reviews.getReview(id);
    if (openIdRef.current === id) setDetail(data);
    setList(prev => prev.map(r => (r.id === id ? { ...r, syncMeta: data.syncMeta } : r)));
  };

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  const pickDraft = useCallback((draft) => {
    setText(draft);
    requestAnimationFrame(() => { resizeInput(); inputRef.current?.focus(); });
  }, []);

  const openIndex = ordered.findIndex(r => r.id === openId);
  const stepTo = useCallback((delta) => {
    if (openIndex < 0) return;
    const next = ordered[openIndex + delta];
    if (next) setOpenId(next.id);
  }, [ordered, openIndex]);

  // Стрелки листают отзывы, Esc закрывает — пока фокус не в поле ответа
  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpenId(null); return; }
      if (['TEXTAREA', 'INPUT'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight') stepTo(1);
      if (e.key === 'ArrowLeft') stepTo(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, stepTo]);

  // Открытая карточка — на видимой странице ленты, чтобы после окна было
  // видно, где остановился. Листаем на её страницу, а не к ней вплотную:
  // ряд остаётся выровненным по четвёркам.
  useEffect(() => {
    if (!openId) return;
    const index = ordered.findIndex(r => r.id === openId);
    if (index < 0) return;
    setStart(current => (index >= current && index < current + perView
      ? current
      : Math.min(Math.floor(index / perView) * perView, Math.max(0, ordered.length - perView))));
  }, [openId, ordered, perView]);

  // Следующий из тех, кто ещё ждёт меня, — по порядку ленты, а не первый:
  // отвечают слева направо
  const nextAfter = (id) => {
    const index = ordered.findIndex(r => r.id === id);
    const pending = (r) => r.id !== id && rankOf(r) !== 2;
    const after = ordered.slice(index + 1).find(pending);
    return (after || ordered.find(pending))?.id || null;
  };

  const handleComment = async () => {
    if (!text.trim() || !detail) return;
    const id = detail.id;
    try {
      setSubmitting('comment');
      await reviews.addComment(id, { comment: text, attachments: [] });
      setText('');
      requestAnimationFrame(resizeInput);
      await reloadDetail(id);
      toast.success('Комментарий добавлен');
    } catch (err) {
      console.error('Error adding comment:', err);
      toast.error('Ошибка при добавлении комментария');
    } finally {
      setSubmitting(null);
    }
  };

  const handleReply = async () => {
    if (!text.trim() || !detail) return;
    const id = detail.id;
    const sentText = text.trim();
    try {
      setSubmitting('reply');
      await reviews.replyReview(id, sentText);
      setText('');
      toast.success('Ответ отправлен в очередь на публикацию');
      // Карточка уходит в конец ленты к отвеченным, а в окно — следующий
      // ждущий. Сценарий доски догонит, когда площадка примет ответ.
      setList(prev => prev.map(r => (
        r.id === id ? { ...r, syncMeta: { ...(r.syncMeta || {}), replyText: sentText, replySending: true } } : r
      )));
      const next = nextAfter(id);
      if (next) setOpenId(next);
      else await reloadDetail(id);
    } catch (err) {
      console.error('Error sending reply:', err);
      toast.error(err.response?.data?.error || 'Ошибка при отправке ответа');
    } finally {
      setSubmitting(null);
    }
  };

  const page = (dir) => {
    setStart(current => Math.min(Math.max(0, current + dir * perView), maxStart));
  };

  if (list.length === 0) {
    // Пока грузится — заготовка того же размера, если по счётчикам досок
    // на мне что-то есть. Нечего показывать — места над досками не занимаем.
    if (status === 'loading' && expected > 0) {
      return (
        <section className="my-reviews my-reviews--skeleton" aria-busy="true">
          <div className="my-reviews__head">
            <span className="my-reviews__skeleton-bar" />
          </div>
          <div className="my-reviews__viewport">
            <div className="my-reviews__track" style={{ '--per-view': perView, '--start': 0 }}>
              {Array.from({ length: perView }, (_, i) => (
                <div key={i} className="my-review-card my-reviews__skeleton-card" />
              ))}
            </div>
          </div>
        </section>
      );
    }
    if (status === 'error') {
      return (
        <section className="my-reviews my-reviews--error">
          <span>Не удалось загрузить ваши отзывы</span>
          <button type="button" onClick={retryNow}>Повторить</button>
        </section>
      );
    }
    return null;
  }

  const stillMine = detail && list.some(r => r.id === detail.id);
  const canReply = !!detail && isAdmin && canReplyOnPlatform(detail) && detail.status !== 'final'
    && ['none', 'redo'].includes(replyState(detail));
  const canDraftReply = canReply && !detail.syncMeta?.replyText;

  return (
    <section className="my-reviews">
      <div className="my-reviews__head">
        {boards.length > 1 && (
          <div className="my-reviews__filter" ref={filterRef}>
            <button
              type="button"
              className={`my-reviews__filter-btn${filterOpen ? ' is-open' : ''}`}
              onClick={() => setFilterOpen(v => !v)}
            >
              {boardFilter && (
                <ClinicMark medCenter={boards.find(b => b.id === boardFilter)?.medCenter} />
              )}
              {boards.find(b => b.id === boardFilter)?.name || 'Все медцентры'}
              <ChevronDown size={14} />
            </button>
            {filterOpen && (
              <div className="my-reviews__menu">
                {[{ id: null, name: 'Все медцентры' }, ...boards].map(b => (
                  <button
                    key={b.id || 'all'}
                    type="button"
                    className={`my-reviews__option${boardFilter === b.id ? ' is-active' : ''}`}
                    onClick={() => { setBoardFilter(b.id); setFilterOpen(false); }}
                  >
                    <span className="my-reviews__option-check">
                      {boardFilter === b.id && <Check size={14} />}
                    </span>
                    {b.id && <ClinicMark medCenter={b.medCenter} />}
                    <span className="my-reviews__option-name">{b.name}</span>
                    <span className="my-reviews__option-count">
                      {b.id ? countByBoard[b.id] || 0 : list.length}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {waitingCount > 0 && (
          <span className="my-reviews__waiting">Ждут ответа: {waitingCount}</span>
        )}
        <div className="my-reviews__pager">
          <button type="button" onClick={() => page(-1)} disabled={start === 0} title="Назад">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => page(1)} disabled={start >= maxStart} title="Дальше">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="my-reviews__viewport">
        <div
          className="my-reviews__track"
          style={{ '--per-view': perView, '--start': start }}
        >
          {ordered.map(review => {
            const state = replyState(review);
            const open = () => setOpenId(review.id);
            return (
              <ReviewCard
                key={review.id}
                review={review}
                nowTick={nowTick}
                role="button"
                tabIndex={0}
                className={`my-review-card${rankOf(review) === 2 ? ' is-done' : ''}${review.id === openId ? ' is-active' : ''}`}
                onClick={open}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                footerExtra={(
                  <>
                    {state === 'redo' && <span className="my-review-card__flag is-danger">ответ не принят</span>}
                    {state === 'sending' && <span className="my-review-card__flag">отправляется</span>}
                    {state === 'answered' && <span className="my-review-card__flag">отвечено</span>}
                    {/* На доске медцентр и так понятен, в общей ленте — нет */}
                    <span className="my-review-card__clinic">
                      <ClinicMark medCenter={review.board?.medCenter} />
                      {review.board?.name}
                    </span>
                  </>
                )}
              />
            );
          })}
        </div>
      </div>

      {openId && (
        <div className="my-review-modal__overlay" onClick={() => setOpenId(null)}>
          <div className="my-review-modal" onClick={e => e.stopPropagation()}>
            <div className="my-review-modal__bar">
              <button type="button" onClick={() => stepTo(-1)} disabled={openIndex <= 0} title="Предыдущий (←)">
                <ChevronLeft size={18} />
              </button>
              <span>{openIndex >= 0 ? `${openIndex + 1} из ${ordered.length}` : 'Отзыв'}</span>
              <button
                type="button"
                onClick={() => stepTo(1)}
                disabled={openIndex < 0 || openIndex >= ordered.length - 1}
                title="Следующий (→)"
              >
                <ChevronRight size={18} />
              </button>
              <button type="button" className="my-review-modal__close" onClick={() => setOpenId(null)} title="Закрыть (Esc)">
                <X size={18} />
              </button>
            </div>

            {!detail || detail.id !== openId ? (
              <div className="my-review-modal__loading"><div className="loading-spinner" /></div>
            ) : (
              <div className="my-review-modal__body">
                {!stillMine && (
                  <div className="my-review-modal__gone">
                    Отзыв больше не назначен на вас — его передал сценарий доски или коллега.
                  </div>
                )}

                <div className="my-review-modal__review">
                  <div className="my-review-modal__head">
                    <span className="my-review-modal__name">{detail.patientName}</span>
                    <span className={`my-review-modal__rating${detail.rating <= 3 ? ' is-negative' : ''}`}>
                      {detail.rating}/5 {getRatingStars(detail.rating)}
                    </span>
                    <span className="my-review-modal__date">
                      {new Date(detail.reviewDate).toLocaleDateString('ru-RU')}
                    </span>
                    <span
                      className="my-review-modal__status"
                      style={{ '--status-color': getStatusColor(detail.status) }}
                    >
                      {getStatusLabel(detail.status)}
                    </span>
                  </div>
                  {detail.reviewText && <div className="review-bubble">{detail.reviewText}</div>}
                  <div className="my-review-modal__source">
                    <PlatformLogo name={detail.platform?.name} size={16} />
                    <span>{detail.platform?.name} · {detail.board?.name}</span>
                    {detail.doctorName && <span>· {detail.doctorName}</span>}
                    {reviewPublicUrl(detail) && (
                      <a href={reviewPublicUrl(detail)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={13} /> на площадке
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/reviews/board/${detail.boardId}?review=${detail.id}`)}
                    >
                      <Kanban size={13} /> на доске
                    </button>
                  </div>
                  {detail.additionalInfo && (
                    <div className="my-review-modal__extra">{detail.additionalInfo}</div>
                  )}
                </div>

                <div className="details-history my-review-modal__history">
                  <h4>История</h4>
                  <ReviewTimeline review={detail} />

                  {detail.status !== 'final' && (
                    <div className="add-comment my-review-composer" ref={composerRef}>
                      <textarea
                        ref={inputRef}
                        value={text}
                        onChange={(e) => { setText(e.target.value); resizeInput(); }}
                        placeholder={canReply ? 'Ответ пациенту или комментарий коллегам...' : 'Комментарий...'}
                        rows={2}
                      />
                      <div className="my-review-composer__actions">
                        {canDraftReply && (
                          <button
                            type="button"
                            onClick={() => setShowDrafts(v => !v)}
                            className={`btn-reply-drafts${showDrafts ? ' is-open' : ''}`}
                            title="Варианты ответа"
                          >
                            <Sparkles size={16} />
                            {!showDrafts && detail.syncMeta?.drafts?.items?.length > 0 && (
                              <span className="btn-reply-drafts__dot" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          className="my-review-composer__comment"
                          onClick={handleComment}
                          disabled={!text.trim() || !!submitting}
                        >
                          <Send size={14} /> Комментарий
                        </button>
                        {canReply && (
                          <button
                            type="button"
                            className="my-review-composer__reply"
                            onClick={handleReply}
                            disabled={!text.trim() || !!submitting}
                          >
                            <Reply size={14} />
                            {submitting === 'reply' ? 'Отправляем...' : 'Ответить на площадке'}
                          </button>
                        )}
                      </div>
                      {showDrafts && canDraftReply && (
                        <ReviewReplyDrafts
                          review={detail}
                          anchorRef={composerRef}
                          onPick={pickDraft}
                          onReviewUpdate={applyReviewUpdate}
                          onClose={() => setShowDrafts(false)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default MyReviewsStrip;
