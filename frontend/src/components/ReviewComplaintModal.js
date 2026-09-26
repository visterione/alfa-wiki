import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { reviews } from '../services/api';

/**
 * Жалоба на отзыв площадке — из карточки, без захода в кабинет (ver. 8.85).
 *
 * Причины у каждой площадки свои и приходят с сервера: они повторяют
 * список кабинета площадки. У Яндекса причин нет — только текст. Файлы не
 * прикладываются: ни одна из площадок их в жалобе не принимает, ПроДокторов
 * сам запрашивает документы у пациента.
 *
 * Жалоба уходит в очередь Альфа Парсера; о том, что площадка её приняла,
 * карточка узнаёт через минуту-две, а удалят ли отзыв — через дни.
 */
function ReviewComplaintModal({ review, onClose, onSent }) {
  const [options, setOptions] = useState(null);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    reviews.getComplaintOptions(review.id)
      .then(res => { if (alive) setOptions(res.data); })
      .catch(err => {
        if (alive) setOptions({ available: false, reason: err.response?.data?.error || 'Не удалось узнать причины' });
      });
    return () => { alive = false; };
  }, [review.id]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      setSending(true);
      const res = await reviews.sendComplaint(review.id, { reason: reason || null, text });
      toast.success('Жалоба отправлена в очередь');
      onSent(res.data.syncMeta);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отправить жалобу');
    } finally {
      setSending(false);
    }
  };

  const reasons = options?.reasons || [];
  const ready = text.trim() && (!reasons.length || reason);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content finalize-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Жалоба на отзыв</h2>
          <button className="btn-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {!options && <div className="complaint-loading">Загрузка…</div>}

        {options && !options.available && (
          <div className="complaint-unavailable">{options.reason}</div>
        )}

        {options?.available && (
          <form onSubmit={submit}>
            {reasons.length > 0 && (
              <div className="form-group">
                <label>Причина</label>
                <select value={reason} onChange={e => setReason(e.target.value)} required>
                  <option value="">Выберите причину</option>
                  {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Почему отзыв нарушает правила</label>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Опишите, что не так: факты, даты, что можно проверить"
                maxLength={2000}
                required
              />
            </div>
            {options.note && <p className="complaint-note">{options.note}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose} disabled={sending}>
                Отмена
              </button>
              <button type="submit" className="btn-submit" disabled={sending || !ready}>
                {sending ? 'Отправка…' : 'Отправить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ReviewComplaintModal;
