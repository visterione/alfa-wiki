import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ScanLine, Camera, CameraOff, Keyboard, AlertTriangle, Info, Package, DoorOpen } from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Сканер QR и ручной ввод инвентарного номера.
 *
 * ── Почему ручной ввод здесь равноправен, а не «на всякий случай» ────────────
 *
 * Камера в браузере доступна только в защищённом контексте: https или localhost.
 * На боевом 443 через nginx всё в порядке, а на dev-сервере :9000 сканер не
 * запустится вообще — это ровно та ловушка, о которой предупреждает CLAUDE.md, и
 * первое, обо что спотыкается проверка «а работает ли QR».
 *
 * Второе: распознавание сделано на встроенном BarcodeDetector, который есть в
 * Chrome и Edge, но отсутствует в Safari и Firefox. Тянуть ради этого стороннюю
 * библиотеку в проект без шага сборки для bot/-страниц не хочется, а в React-часть
 * — это +200 КБ на один экран. Поэтому: где есть нативный детектор — сканируем,
 * где нет — честно говорим и оставляем ввод с клавиатуры. На складе штрих-сканер
 * в режиме клавиатуры всё равно быстрее камеры.
 *
 * Что распознаём: и полный URL из QR (https://…/p/a/<token>), и просто
 * инвентарный номер, набранный руками. Разбор — на бэкенде, в /assets/lookup.
 */

export default function WarehouseScanner({ onOpenRoom }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);

  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const detectorSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const lookup = useCallback(async (code) => {
    if (!code) return;
    try {
      const { data } = await warehouseApi.lookup(code);
      setResult(data);
      setHistory(prev => [{ code, at: new Date(), kind: data.kind }, ...prev].slice(0, 10));
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (e) {
      toast.error(e.response?.data?.error || 'По этому коду ничего не найдено');
      setHistory(prev => [{ code, at: new Date(), kind: 'notfound' }, ...prev].slice(0, 10));
    }
  }, []);

  const stop = useCallback(() => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const start = async () => {
    setError(null);
    if (!secureContext) {
      setError('Камера недоступна: страница открыта не по HTTPS. Откройте портал по защищённому адресу — на dev-сервере :9000 камера не работает.');
      return;
    }
    if (!detectorSupported) {
      setError('Браузер не поддерживает встроенное распознавание QR (BarcodeDetector). Работает в Chrome и Edge; в Safari и Firefox воспользуйтесь ручным вводом.');
      return;
    }
    try {
      // facingMode environment — задняя камера: сканируют прибор, а не себя.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      // eslint-disable-next-line no-undef
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      let busy = false;
      let lastCode = null;

      loopRef.current = setInterval(async () => {
        if (busy || !videoRef.current) return;
        busy = true;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes?.[0]?.rawValue;
          // Один и тот же код в кадре держится секундами — без этой проверки
          // запросы полетели бы четыре раза в секунду.
          if (value && value !== lastCode) {
            lastCode = value;
            await lookup(value);
          }
        } catch {
          /* кадр не распознан — это норма, ждём следующий */
        } finally {
          busy = false;
        }
      }, 250);
    } catch (e) {
      setError(e.name === 'NotAllowedError'
        ? 'Доступ к камере запрещён. Разрешите его в настройках браузера для этого сайта.'
        : `Не удалось включить камеру: ${e.message}`);
    }
  };

  useEffect(() => stop, [stop]);

  return (
    <div className="wh-scanner">
      <div className="wh-scanner__cols">
        <div className="wh-panel wh-scanner__cam">
          <div className="wh-panel__head">
            <div className="wh-panel__title"><ScanLine size={15} /> Сканирование QR</div>
          </div>
          <div className="wh-panel__body">

          <div className={`wh-scanner__video ${scanning ? 'is-live' : ''}`}>
            <video ref={videoRef} muted playsInline />
            {!scanning && (
              <div className="wh-scanner__placeholder">
                <Camera size={34} />
                <span>Камера выключена</span>
              </div>
            )}
            {scanning && <div className="wh-scanner__frame" />}
          </div>

          <div className="wh-scanner__actions">
            {scanning
              ? <button className="wh-btn wh-btn--danger-ghost" onClick={stop}><CameraOff size={15} /> Остановить</button>
              : <button className="wh-btn wh-btn--primary" onClick={start}><Camera size={15} /> Включить камеру</button>}
          </div>

          {error && (
            <div className="wh-alert wh-alert--warning">
              <AlertTriangle size={15} />
              <div>{error}</div>
            </div>
          )}

          {!error && !scanning && (
            <div className="wh-alert wh-alert--info">
              <Info size={15} />
              <div>
                Камера требует HTTPS: {secureContext ? 'соединение защищённое ✓' : 'страница открыта без HTTPS ✗'}.
                Встроенное распознавание QR: {detectorSupported ? 'поддерживается ✓' : 'не поддерживается ✗ (Chrome/Edge)'}.
                Ручной ввод работает всегда — в том числе со штрих-сканером в режиме клавиатуры.
              </div>
            </div>
          )}
          </div>
        </div>

        <div className="wh-panel wh-scanner__manual">
          <div className="wh-panel__head">
            <div className="wh-panel__title"><Keyboard size={15} /> Ручной ввод</div>
          </div>
          <div className="wh-panel__body">
          <form onSubmit={e => { e.preventDefault(); lookup(manual.trim()); setManual(''); }}>
            <input autoFocus
                   value={manual}
                   onChange={e => setManual(e.target.value)}
                   placeholder="МЦ-2025-ХИРУРГ-00341 или ссылка из QR" />
            <button className="wh-btn wh-btn--primary" type="submit" disabled={!manual.trim()}>Найти</button>
          </form>
          <p className="wh-hint">
            Принимается инвентарный номер с этикетки или полная ссылка из QR-кода.
            Поле держит фокус — штрих-сканер, эмулирующий клавиатуру, работает без настройки.
          </p>

          {history.length > 0 && (
            <>
              <h4 className="wh-subhead">Последние сканирования</h4>
              <ul className="wh-scanner__history">
                {history.map((h, i) => (
                  <li key={i} className={h.kind === 'notfound' ? 'is-fail' : ''}>
                    <span className="wh-mono">{h.code.length > 40 ? `…${h.code.slice(-30)}` : h.code}</span>
                    <small>{h.at.toLocaleTimeString('ru-RU')} · {
                      h.kind === 'asset' ? 'актив' : h.kind === 'room' ? 'кабинет' : 'не найдено'
                    }</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          </div>
        </div>
      </div>

      {result?.kind === 'asset' && (
        <div className="wh-panel wh-scanner__result">
          <div className="wh-panel__body">
          <div className="wh-scanner__result-head">
            <Package size={18} />
            <div>
              <div className="wh-scanner__result-title">{result.asset.name}</div>
              <div className="wh-mono wh-cell-sub">{result.asset.inventoryNumber}</div>
            </div>
            <span className={`wh-status wh-status--${result.asset.status}`}>
              {{ in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
                 storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано' }[result.asset.status]}
            </span>
          </div>
          <div className="wh-grid2">
            <div className="wh-field-ro">
              <span className="wh-field-ro__label">Размещение</span>
              <span className="wh-field-ro__value">
                {result.asset.room ? `Каб. ${result.asset.room.number}` : 'не размещён'}
                {result.asset.room && (
                  <button className="wh-btn wh-btn--link" onClick={() => onOpenRoom?.(result.asset.room.id)}>
                    дашборд
                  </button>
                )}
              </span>
            </div>
            <div className="wh-field-ro">
              <span className="wh-field-ro__label">МОЛ</span>
              <span className="wh-field-ro__value">{result.asset.responsible?.displayName || '—'}</span>
            </div>
            <div className="wh-field-ro">
              <span className="wh-field-ro__label">Следующее ТО</span>
              <span className="wh-field-ro__value">
                {result.asset.nextMaintenanceDate
                  ? new Date(result.asset.nextMaintenanceDate).toLocaleDateString('ru-RU')
                  : '—'}
              </span>
            </div>
            <div className="wh-field-ro">
              <span className="wh-field-ro__label">Серийный номер</span>
              <span className="wh-field-ro__value wh-mono">{result.asset.serialNumber || '—'}</span>
            </div>
          </div>
          </div>
        </div>
      )}

      {result?.kind === 'room' && (
        <div className="wh-panel wh-scanner__result">
          <div className="wh-panel__body">
          <div className="wh-scanner__result-head">
            <DoorOpen size={18} />
            <div>
              <div className="wh-scanner__result-title">Каб. {result.room.number}</div>
              <div className="wh-cell-sub">{result.room.name} · {result.room.department?.name || '—'}</div>
            </div>
          </div>
          <button className="wh-btn wh-btn--primary" onClick={() => onOpenRoom?.(result.room.id)}>
            Открыть дашборд кабинета
          </button>
          </div>
        </div>
      )}
    </div>
  );
}
