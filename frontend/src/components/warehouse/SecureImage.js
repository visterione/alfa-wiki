import React, { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Картинка с закрытого эндпоинта.
 *
 * Обычный <img src="/api/…"> уходит без заголовка Authorization: браузер шлёт
 * только куки, а портал авторизуется токеном из localStorage через интерцептор
 * axios. Эндпоинты QR и этикеток закрыты authenticate, поэтому такой запрос
 * получал 401 и на экране висела битая картинка — ровно то, что и наблюдалось.
 *
 * Поэтому файл забирается через тот же axios-клиент, что и остальные запросы, и
 * подставляется как blob-URL. Blob освобождается при смене адреса и размонтировании:
 * без этого каждая перерисованная этикетка навсегда оставалась бы в памяти вкладки.
 *
 * Альтернатива — открыть эндпоинты и пускать по токену в query — отвергнута: тогда
 * ссылка на этикетку с инвентарными номерами утекала бы в историю браузера и логи
 * nginx, а сам токен светился бы в адресной строке.
 */
export default function SecureImage({
  url,
  alt = '',
  className = '',
  style,
  onLoaded = null,
  fallback = null,
}) {
  const [state, setState] = useState({ src: null, loading: true, error: null });

  useEffect(() => {
    if (!url) { setState({ src: null, loading: false, error: null }); return undefined; }

    let objectUrl = null;
    let cancelled = false;
    setState({ src: null, loading: true, error: null });

    // Адрес приходит абсолютным (BASE_URL + путь), а у axios-клиента свой
    // baseURL с /api — отрезаем общую часть, чтобы не получить /api/api.
    const path = url.replace(/^.*\/api\//, '/');

    api.get(path, { responseType: 'blob' })
      .then(({ data }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setState({ src: objectUrl, loading: false, error: null });
        onLoaded?.(objectUrl);
      })
      .catch(err => {
        if (cancelled) return;
        setState({
          src: null,
          loading: false,
          error: err.response?.status === 403
            ? 'Нет прав на просмотр'
            : 'Не удалось загрузить изображение',
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    /* eslint-disable-next-line */
  }, [url]);

  if (state.loading) {
    return <div className={`wh-secimg wh-secimg--loading ${className}`} style={style} aria-busy="true" />;
  }
  if (state.error) {
    return (
      <div className={`wh-secimg wh-secimg--error ${className}`} style={style} title={state.error}>
        {fallback || state.error}
      </div>
    );
  }
  return <img src={state.src} alt={alt} className={className} style={style} />;
}
