import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Edit, ArrowLeft, Star, StarOff, Download, FileText, Image, Film, Music, Archive, Package, File, Table, Scroll, BookOpen, Home, Folder, ChevronRight, FileCode } from 'lucide-react';
import mammoth from 'mammoth';
import { pages, favorites, media as mediaApi, BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import PrintButton from '../components/PrintButton';
import ContentRenderer from '../components/ContentRenderer';
import SpreadsheetEditor from '../components/SpreadsheetEditor';
import './PageView.css';

const getPageIcon = (contentType, metadata) => {
  if (contentType === 'spreadsheet') return Table;
  if (contentType === 'html') return FileCode;
  if (contentType === 'file') {
    const mime = metadata?.mimeType || '';
    if (mime.startsWith('image/')) return Image;
    if (mime.startsWith('video/')) return Film;
    if (mime.startsWith('audio/')) return Music;
    if (mime === 'application/pdf') return Scroll;
    if (mime.includes('spreadsheet') || mime.includes('excel')) return Table;
    if (mime.includes('word') || mime.includes('msword')) return BookOpen;
    if (['application/zip','application/x-zip-compressed','application/x-rar-compressed',
         'application/vnd.rar','application/x-7z-compressed'].includes(mime)) return Archive;
    if (['application/x-msdownload','application/x-msi'].includes(mime)) return Package;
    return File;
  }
  return FileText;
};

const XLSX_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

function FileViewer({ mediaFile }) {
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const blobUrlRef = useRef(null);

  const [xlsxData, setXlsxData] = useState(null);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [xlsxError, setXlsxError] = useState(false);

  const [docxHtml, setDocxHtml] = useState(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxError, setDocxError] = useState(false);

  // Загрузка XLSX → Univer
  useEffect(() => {
    if (!mediaFile || !XLSX_MIMES.has(mediaFile.mimeType)) return;
    setXlsxLoading(true);
    setXlsxError(false);
    mediaApi.asUniver(mediaFile.id)
      .then(({ data }) => setXlsxData(JSON.stringify(data)))
      .catch(() => setXlsxError(true))
      .finally(() => setXlsxLoading(false));
  }, [mediaFile?.id]);

  // Загрузка DOCX → HTML через Mammoth (client-side)
  useEffect(() => {
    if (!mediaFile || !DOCX_MIMES.has(mediaFile.mimeType)) return;
    setDocxLoading(true);
    setDocxError(false);
    fetch(`${BASE_URL}/${mediaFile.path}`)
      .then(r => r.arrayBuffer())
      .then(buf => mammoth.convertToHtml({ arrayBuffer: buf }))
      .then(({ value }) => setDocxHtml(value))
      .catch(() => setDocxError(true))
      .finally(() => setDocxLoading(false));
  }, [mediaFile?.id]);

  useEffect(() => {
    if (!mediaFile || mediaFile.mimeType !== 'application/pdf') return;
    setPdfLoading(true);
    const url = `${BASE_URL}/${mediaFile.path}`;
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        const objUrl = URL.createObjectURL(blob);
        blobUrlRef.current = objUrl;
        setPdfBlobUrl(objUrl);
      })
      .catch(() => {})
      .finally(() => setPdfLoading(false));
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [mediaFile?.path]);

  if (!mediaFile) return (
    <div className="file-viewer-empty">Файл не найден или был удалён.</div>
  );

  const fileUrl = `${BASE_URL}/${mediaFile.path}`;
  const { mimeType, originalName, size } = mediaFile;
  const isVideo = mimeType && (mimeType.startsWith('video/') ||
    ['video/x-msvideo','video/avi','video/msvideo','video/quicktime','video/x-matroska','video/x-ms-wmv'].includes(mimeType));

  const sizeLabel = size
    ? size >= 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(2)} МБ`
      : `${(size / 1024).toFixed(1)} КБ`
    : '';

  const getFileIcon = () => {
    if (!mimeType) return <File size={48} />;
    if (mimeType.startsWith('image/')) return <Image size={48} />;
    if (mimeType.startsWith('video/')) return <Film size={48} />;
    if (mimeType.startsWith('audio/')) return <Music size={48} />;
    if (mimeType === 'application/pdf') return <Scroll size={48} />;
    if (['application/zip','application/x-zip-compressed','application/x-rar-compressed',
         'application/vnd.rar','application/x-7z-compressed','application/x-tar','application/gzip']
        .includes(mimeType)) return <Archive size={48} />;
    if (['application/x-msdownload','application/x-msi','application/octet-stream'].includes(mimeType))
      return <Package size={48} />;
    return <FileText size={48} />;
  };

  const DownloadBtn = () => (
    <a
      className="btn btn-primary"
      href={fileUrl}
      download={originalName}
      target="_blank"
      rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
    >
      <Download size={16} />
      Скачать
    </a>
  );

  // DOCX — конвертируем в HTML через Mammoth (client-side)
  if (DOCX_MIMES.has(mimeType)) {
    return (
      <div className="file-viewer">
        {docxLoading && <div className="file-viewer-pdf-loading">Загрузка документа...</div>}
        {docxError && <div className="file-viewer-pdf-loading">Не удалось открыть файл — скачайте его.</div>}
        {docxHtml && !docxLoading && (
          <div
            className="file-viewer-docx"
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        )}
      </div>
    );
  }

  // XLSX — конвертируем на сервере и показываем в Univer (read-only)
  if (XLSX_MIMES.has(mimeType)) {
    return (
      <div className="file-viewer">
        {xlsxLoading && <div className="file-viewer-pdf-loading">Загрузка таблицы...</div>}
        {xlsxError && <div className="file-viewer-pdf-loading">Не удалось открыть файл — скачайте его.</div>}
        {xlsxData && !xlsxLoading && (
          <SpreadsheetEditor
            content={xlsxData}
            pageId={mediaFile.id}
            readOnly={true}
          />
        )}
      </div>
    );
  }

  // PDF — загружаем через blob URL чтобы обойти X-Frame-Options
  if (mimeType === 'application/pdf') {
    return (
      <div className="file-viewer">
        {pdfLoading && <div className="file-viewer-pdf-loading">Загрузка PDF...</div>}
        {pdfBlobUrl && (
          <iframe src={pdfBlobUrl} title={originalName} className="file-viewer-pdf" />
        )}
      </div>
    );
  }

  // Изображения
  if (mimeType && mimeType.startsWith('image/')) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-image-wrap">
          <img src={fileUrl} alt={originalName} className="file-viewer-image" />
        </div>
      </div>
    );
  }

  // Видео (включая AVI, MOV, MKV)
  if (isVideo) {
    return (
      <div className="file-viewer">
        <video src={fileUrl} controls className="file-viewer-video">
          Ваш браузер не поддерживает воспроизведение видео.
        </video>
      </div>
    );
  }

  // Аудио
  if (mimeType && mimeType.startsWith('audio/')) {
    return (
      <div className="file-viewer">
        <audio src={fileUrl} controls className="file-viewer-audio">
          Ваш браузер не поддерживает воспроизведение аудио.
        </audio>
      </div>
    );
  }

  // Всё остальное — карточка скачивания (Word, Excel, архивы, EXE, LibreOffice и т.д.)
  return (
    <div className="file-viewer">
      <div className="file-viewer-download-card">
        <div className="file-viewer-download-icon">{getFileIcon()}</div>
        <div className="file-viewer-download-info">
          <div className="file-viewer-download-name">{originalName}</div>
          {sizeLabel && <div className="file-viewer-download-size">{sizeLabel}</div>}
        </div>
        <DownloadBtn />
      </div>
    </div>
  );
}

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

  // Закрываем sidebar при открытии страницы с таблицей, восстанавливаем при выходе
  useEffect(() => {
    if (page?.contentType !== 'spreadsheet') return;
    window.dispatchEvent(new CustomEvent('spreadsheet-page', { detail: { active: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent('spreadsheet-page', { detail: { active: false } }));
    };
  }, [page?.contentType]);

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

  const folderBreadcrumbs = [];
  if (page.folder?.parent) folderBreadcrumbs.push(page.folder.parent);
  if (page.folder) folderBreadcrumbs.push(page.folder);

  return (
    <div className={`page-view${page.contentType === 'spreadsheet' ? ' spreadsheet-view' : ''}`}>
      <nav className="page-explorer-breadcrumbs">
        <Link to="/explorer" className="page-breadcrumb-item">
          <Home size={13} />
          <span>Проводник</span>
        </Link>
        {folderBreadcrumbs.map((folder) => (
          <React.Fragment key={folder.id}>
            <ChevronRight size={12} className="page-breadcrumb-sep" />
            <Link
              to={`/explorer?folderId=${folder.id}`}
              className="page-breadcrumb-item"
            >
              <Folder size={13} />
              <span>{folder.title}</span>
            </Link>
          </React.Fragment>
        ))}
        <ChevronRight size={12} className="page-breadcrumb-sep" />
        <span className="page-breadcrumb-current">
          {React.createElement(getPageIcon(page.contentType, page.metadata), { size: 13 })}
          {page.title}
        </span>
      </nav>
      <div className="page-header">
        <div className="page-header-content">
          <h1>{page.title}</h1>
          {page.description && (
            <p className="page-description">{page.description}</p>
          )}
        </div>
        <div className="page-actions">
          <PrintButton title={page.title} />
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
          {page.contentType === 'file' ? (
            <a
              href={`${BASE_URL}/api/media/${page.mediaFile?.id}/download`}
              className="btn btn-primary"
              style={{ textDecoration: 'none' }}
            >
              Скачать
            </a>
          ) : canEdit && (
            <Link to={`/page/${slug}/edit`} className="btn btn-primary">
              Редактировать
            </Link>
          )}
        </div>
      </div>

      <div>
        <div className="printable-header">
          <h1>{page.title}</h1>
          {page.description && (
            <p className="page-description">{page.description}</p>
          )}
        </div>

        {page.contentType === 'file' ? (
          <div className="card">
            <div className="file-viewer-wrap">
              <FileViewer mediaFile={page.mediaFile} />
            </div>
          </div>
        ) : (
        <div className="card">
          <div ref={contentRefCallback} className="page-content">
            {page.contentType === 'wysiwyg' ? (
              <ContentRenderer content={page.content} />
            ) : page.contentType === 'spreadsheet' ? (
              <SpreadsheetEditor
                content={page.content}
                pageId={page.id}
                readOnly={true}
                fullHeight={true}
              />
            ) : (
              <div dangerouslySetInnerHTML={{ __html: getContentWithoutScripts() }} />
            )}
          </div>
        </div>
        )}
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