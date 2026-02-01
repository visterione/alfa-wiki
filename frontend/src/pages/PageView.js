import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Edit, ArrowLeft, Star, StarOff } from 'lucide-react';
import { pages, favorites } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import PrintButton from '../components/PrintButton';
import ContentRenderer from '../components/ContentRenderer';
import SpreadsheetEditor from '../components/SpreadsheetEditor';
import './PageView.css';

export default function PageView() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin, hasPermission } = useAuth();

  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const printRef = useRef();

  // Cleanup функция
  const cleanupScripts = useCallback(() => {
    document.getElementById('page-custom-css')?.remove();
    document.getElementById('page-custom-js')?.remove();
    document.querySelectorAll('script[data-page-script]').forEach(s => s.remove());
  }, []);

  // Функция для подсветки текста на странице
  const highlightSearchText = useCallback((node, searchText) => {
    if (!node || !searchText || searchText.trim().length < 2) return;

    const searchLower = searchText.toLowerCase().trim();

    // Рекурсивная функция для обхода текстовых узлов
    const highlightInNode = (element) => {
      if (!element || !element.childNodes) return;

      const nodesToProcess = Array.from(element.childNodes);

      nodesToProcess.forEach(child => {
        // Пропускаем уже подсвеченные элементы, скрипты и стили
        if (child.nodeType === 1) { // Element node
          const tagName = child.tagName?.toLowerCase();
          if (tagName === 'mark' || tagName === 'script' || tagName === 'style') {
            return;
          }
          // Рекурсивно обрабатываем дочерние элементы
          highlightInNode(child);
        } else if (child.nodeType === 3) { // Text node
          const text = child.textContent;
          const textLower = text.toLowerCase();
          const index = textLower.indexOf(searchLower);

          if (index !== -1) {
            // Создаем новые узлы с подсветкой
            const beforeText = text.substring(0, index);
            const matchedText = text.substring(index, index + searchText.length);
            const afterText = text.substring(index + searchText.length);

            const fragment = document.createDocumentFragment();

            if (beforeText) {
              fragment.appendChild(document.createTextNode(beforeText));
            }

            const mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = matchedText;
            fragment.appendChild(mark);

            if (afterText) {
              const afterNode = document.createTextNode(afterText);
              fragment.appendChild(afterNode);
              // Продолжаем поиск в оставшейся части текста
              const tempSpan = document.createElement('span');
              tempSpan.appendChild(afterNode);
              highlightInNode(tempSpan);
              while (tempSpan.firstChild) {
                fragment.appendChild(tempSpan.firstChild);
              }
            }

            child.parentNode.replaceChild(fragment, child);
          }
        }
      });
    };

    // Удаляем предыдущие подсветки
    node.querySelectorAll('mark.search-highlight').forEach(mark => {
      const text = mark.textContent;
      mark.replaceWith(document.createTextNode(text));
    });

    // Применяем подсветку
    highlightInNode(node);

    // Прокручиваем к первому вхождению
    setTimeout(() => {
      const firstMark = node.querySelector('mark.search-highlight');
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Добавляем анимацию пульсации для первого вхождения
        firstMark.classList.add('search-highlight-first');
      }
    }, 100);
  }, []);

  // Callback ref - вызывается когда DOM элемент создан
  const contentRefCallback = useCallback((node) => {
    if (!node || !page) return;

    console.log('=== contentRefCallback called ===');
    console.log('page.contentType:', page.contentType);

    // Чистим предыдущие скрипты
    cleanupScripts();

    // Добавляем Custom CSS
    if (page.customCss) {
      const style = document.createElement('style');
      style.id = 'page-custom-css';
      style.textContent = page.customCss;
      document.head.appendChild(style);
    }

    // Для HTML-страниц: извлекаем и выполняем скрипты
    if (page.contentType === 'html' && page.content) {
      console.log('=== Processing HTML scripts ===');

      const parser = new DOMParser();
      const doc = parser.parseFromString(page.content, 'text/html');
      const scripts = doc.querySelectorAll('script');

      console.log('Found scripts:', scripts.length);

      scripts.forEach((scriptEl, index) => {
        console.log(`Script ${index} content:`, scriptEl.textContent?.substring(0, 50));

        const newScript = document.createElement('script');
        newScript.setAttribute('data-page-script', 'true');

        if (scriptEl.src) {
          newScript.src = scriptEl.src;
        } else {
          newScript.textContent = scriptEl.textContent;
        }

        document.body.appendChild(newScript);
        console.log(`Script ${index} appended`);
      });
    }

    // Добавляем Custom JS из отдельного поля
    if (page.customJs) {
      const script = document.createElement('script');
      script.id = 'page-custom-js';
      script.setAttribute('data-page-script', 'true');
      script.textContent = page.customJs;
      document.body.appendChild(script);
    }

    // Подсвечиваем поисковый запрос, если он есть в URL
    const searchQuery = searchParams.get('search');
    if (searchQuery) {
      setTimeout(() => {
        highlightSearchText(node, searchQuery);
        // Удаляем параметр search из URL
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete('search');
        const newUrl = newSearchParams.toString()
          ? `${window.location.pathname}?${newSearchParams.toString()}`
          : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }, 500); // Даем время на рендер контента
    }
  }, [page, cleanupScripts, searchParams, highlightSearchText]);

  // Cleanup при размонтировании
  useEffect(() => {
    return () => cleanupScripts();
  }, [cleanupScripts]);

  useEffect(() => {
    loadPage();
  }, [slug]);

  const loadPage = async () => {
    setLoading(true);
    setError(null);
    cleanupScripts(); // Чистим при загрузке новой страницы
    
    try {
      const { data } = await pages.get(slug);
      setPage(data);
      
      try {
        const favResponse = await favorites.list();
        const isFav = favResponse.data.some(f => f.pageId === data.id);
        setIsFavorite(isFav);
      } catch (e) {
        console.error('Failed to check favorites:', e);
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Страница не найдена');
      } else if (err.response?.status === 403) {
        setError('Доступ запрещён');
      } else {
        setError('Ошибка загрузки страницы');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async () => {
    if (favoriteLoading) return;
    setFavoriteLoading(true);
    try {
      if (isFavorite) {
        await favorites.remove(page.id);
      } else {
        await favorites.add(page.id);
      }
      setIsFavorite(!isFavorite);
      toast.success(isFavorite ? 'Удалено из избранного' : 'Добавлено в избранное');
    } catch (error) {
      toast.error('Ошибка');
    } finally {
      setFavoriteLoading(false);
    }
  };

  // Рендерим контент без script тегов
  const getContentWithoutScripts = () => {
    if (!page?.content) return '';
    if (page.contentType !== 'html') return page.content;
    return page.content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <h2>{error}</h2>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          <ArrowLeft size={18} />
          На главную
        </button>
      </div>
    );
  }

  const canEdit = isAdmin || hasPermission('pages', 'write');

  return (
    <div className="page-view">
      <div className="page-header">
        <div className="page-header-content">
          <h1>{page.title}</h1>
          {page.description && (
            <p className="page-description">{page.description}</p>
          )}
        </div>
        <div className="page-actions">
          <PrintButton contentRef={printRef} title={page.title} />
          <button
            className={`btn btn-ghost btn-icon ${favoriteLoading ? 'loading' : ''}`}
            onClick={toggleFavorite}
            title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
            disabled={favoriteLoading}
          >
            {isFavorite ? (
              <Star size={20} style={{ color: 'var(--warning)', fill: 'var(--warning)' }} />
            ) : (
              <StarOff size={20} />
            )}
          </button>
          {canEdit && (
            <Link to={`/page/${slug}/edit`} className="btn btn-primary">
              <Edit size={18} />
              Редактировать
            </Link>
          )}
        </div>
      </div>

      <div ref={printRef}>
        <div className="printable-header">
          <h1>{page.title}</h1>
          {page.description && (
            <p className="page-description">{page.description}</p>
          )}
        </div>

        <div className="card">
          <div ref={contentRefCallback} className="page-content">
            {page.contentType === 'wysiwyg' ? (
              <ContentRenderer content={page.content} />
            ) : page.contentType === 'spreadsheet' ? (
              <SpreadsheetEditor
                content={page.content}
                pageId={page.id}
                readOnly={true}
              />
            ) : (
              <div dangerouslySetInnerHTML={{ __html: getContentWithoutScripts() }} />
            )}
          </div>
        </div>
      </div>

      {page.keywords && page.keywords.length > 0 && (
        <div className="page-keywords">
          {page.keywords.map((keyword, idx) => (
            <span key={idx} className="badge">{keyword}</span>
          ))}
        </div>
      )}
    </div>
  );
}