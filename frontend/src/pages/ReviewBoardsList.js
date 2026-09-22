import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  MessageSquare, Star, Settings, Archive, UserCheck
} from 'lucide-react';
import { reviews } from '../services/api';
import toast from 'react-hot-toast';
import { fileUrl } from '../utils/fileUrl';
import './ReviewBoardsList.css';

/**
 * Знак филиала на карточке доски.
 *
 * logoUrl и color приходят с доски готовыми: филиал у неё один и обязателен
 * (ver. 8.56), сервер отдаёт его знак вместе с доской.
 */
function BoardBrand({ board }) {
  const [broken, setBroken] = useState(false);

  const src = fileUrl(board.logoUrl);
  if (!src || broken) return null;

  return (
    <span className="board-brand" style={{ '--mc-accent': board.color || 'var(--accent-500)' }}>
      <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
    </span>
  );
}

const ReviewBoardsList = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  // Кнопка «Назад» с доски приводит сюда с ?all — иначе единственную доску мы
  // тут же открыли бы снова, и список (а с ним и архив) стал бы недостижим.
  const showAllBoards = searchParams.has('all');

  useEffect(() => {
    loadBoards();
  }, []);

  const loadBoards = async () => {
    try {
      setLoading(true);
      const response = await reviews.getBoards();
      const list = response.data;

      /**
       * Одна доска по доступу — открываем её сразу, минуя список.
       *
       * Сотруднику медцентра открывают ровно его доску, и выбирать ему не из
       * чего: список из одной карточки — лишний клик на каждый заход в раздел.
       *
       * Владельца доски не уводим: с доски он вернётся сюда кнопкой «Назад»,
       * а больше попасть в список (и в архив) ему неоткуда.
       */
      if (!showAllBoards && list.length === 1 && list[0].userRole !== 'owner') {
        setRedirecting(true);
        navigate(`/reviews/board/${list[0].id}`, { replace: true });
        return;
      }

      setBoards(list);
    } catch (err) {
      console.error('Error loading boards:', err);
      toast.error('Ошибка при загрузке досок');
    } finally {
      setLoading(false);
    }
  };

  if (loading || redirecting) {
    return (
      <div className="reviews-boards-loading">
        <div className="loading-spinner" />
        <p>Загрузка досок...</p>
      </div>
    );
  }

  return (
    <div className="reviews-boards-page">
      <div className="reviews-boards-header">
        <div className="header-left">
          <h1>Отзывы</h1>
        </div>
        <div className="header-actions">
          <button
            className="btn-archive"
            onClick={() => navigate('/reviews/archive')}
            title="Архив отзывов"
          >
            <Archive size={18} />
            Архив
          </button>
        </div>
      </div>

      {boards.length === 0 ? (
        <div className="reviews-boards-empty">
          <MessageSquare size={64} strokeWidth={1} />
          <h2>Нет доступных досок</h2>
          {/* Завести доску отсюда больше нельзя: она есть у каждого медцентра
              (ver. 8.56). Пусто — значит, доступ к ним не выдан */}
          <p>Доски заводятся вместе с медцентрами. Доступ к ним выдаёт администратор</p>
        </div>
      ) : (
        <div className="reviews-boards-grid">
          {boards.map(board => (
            <div key={board.id} className="review-board-card">
              <div className="board-card-header">
                {/* Знак филиала слева от названия: в сетке карточек клинику
                    узнают по логотипу быстрее, чем прочитывают заголовок.
                    Логотип не заполнен в справочнике — знака просто нет */}
                <BoardBrand board={board} />
                <h3 onClick={() => navigate(`/reviews/board/${board.id}`)}>
                  {board.name}
                </h3>
                {board.assignedToMeCount > 0 && (
                  <span className="board-assigned-badge" title="Назначено на меня">
                    <UserCheck size={13} />
                    {board.assignedToMeCount}
                  </span>
                )}
              </div>

              {/* Подпись под названием — адрес из карточки филиала. Раньше
                  здесь было описание доски, и адрес вписывали в него руками */}
              {(board.medCenter?.city || board.medCenter?.address) && (
                <p className="board-description">
                  {[board.medCenter.city, board.medCenter.address].filter(Boolean).join(', ')}
                </p>
              )}

              <div className="board-card-footer">
                <div className="board-actions">
                  <span className="stat">
                    <MessageSquare size={16} />
                    {board.reviewCount || 0} отзывов
                  </span>
                  {board.avgRating && (
                    <span className="stat rating">
                      <Star size={16} />
                      {board.avgRating}
                    </span>
                  )}
                  <div className="board-btns">
                    {board.userRole === 'owner' && (
                      <button
                        className="btn-icon"
                        onClick={() => navigate(`/reviews/board/${board.id}/settings`)}
                        title="Настройки"
                      >
                        <Settings size={18} />
                      </button>
                    )}
                    <button
                      className="btn-open"
                      onClick={() => navigate(`/reviews/board/${board.id}`)}
                    >
                      Открыть
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};

export default ReviewBoardsList;
