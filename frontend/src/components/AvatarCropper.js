import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import './AvatarCropper.css';

const MAX_ZOOM = 6;
// Сторона готового аватара. Сервер всё равно ужмёт до 200×200, но резать в
// исходном разрешении и отдавать ему запас — дешевле, чем отдать 200 и
// получить мыло, если предел когда-нибудь поднимут
const OUTPUT = 512;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * Выбор области снимка, которая станет аватаром (ver. 7.75).
 *
 * До этого окна область не выбиралась вовсе: сервер обрезал картинку по центру
 * (sharp, fit:'cover'), и у вертикального снимка в кружок попадала не голова, а
 * середина кадра. Узнать об этом можно было только после загрузки.
 *
 * В отличие от мобильного двойника (mobile/src/components/AvatarCropper.js),
 * который отдаёт серверу рамку и просит вырезать её самому, здесь режет сам
 * браузер: canvas есть, и готовый квадрат проходит через все существующие
 * маршруты загрузки без единой правки в них.
 *
 * @param {File}     file      выбранный файл
 * @param {string}   title     заголовок окна
 * @param {Function} onCancel  закрыть, ничего не выбрав
 * @param {Function} onCrop    получает готовый квадратный File
 */
export default function AvatarCropper({ file, title = 'Выберите область', onCancel, onCrop }) {
  const [url, setUrl] = useState('');
  const [source, setSource] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [busy, setBusy] = useState(false);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [box, setBox] = useState(320);

  useEffect(() => {
    if (!file) return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setView({ x: 0, y: 0, z: 1 });
    setSource(null);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // Окно квадратное и подстраивается под экран: на телефоне 320px не помещались
  useEffect(() => {
    // Нижняя граница обязательна: на низком окне вычитание высоты обвязки
    // уводило сторону в ноль, и окно обрезки схлопывалось в полоску
    const fit = () => setBox(Math.max(200, Math.min(320, window.innerWidth - 72, window.innerHeight - 320)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Снимок вписан в окно по короткой стороне: пустых полей в круге быть не
  // должно ни при каком положении
  const base = source ? Math.max(box / source.width, box / source.height) : 1;
  const shownW = source ? source.width * base * view.z : 0;
  const shownH = source ? source.height * base * view.z : 0;
  const left = (box - shownW) / 2 + view.x;
  const top = (box - shownH) / 2 + view.y;

  const limit = useCallback((next, zoom) => {
    if (!source) return next;
    const maxX = Math.max(0, (source.width * base * zoom - box) / 2);
    const maxY = Math.max(0, (source.height * base * zoom - box) / 2);
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY), z: zoom };
  }, [base, box, source]);

  const setZoom = z => setView(v => limit(v, clamp(z, 1, MAX_ZOOM)));

  const onPointerDown = e => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  };

  const onPointerMove = e => {
    const drag = dragRef.current;
    if (!drag) return;
    setView(v => limit({ x: drag.x + (e.clientX - drag.px), y: drag.y + (e.clientY - drag.py) }, v.z));
  };

  const onPointerUp = () => { dragRef.current = null; };

  const onWheel = e => {
    // Именно множитель, а не шаг: у тачпада и колеса мыши deltaY разного
    // масштаба, и одинаковая прибавка ощущалась бы то рывком, то ничем
    setZoom(view.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img || !source || busy) return;
    setBusy(true);

    const scale = base * view.z;
    const x = Math.max(0, -left / scale);
    const y = Math.max(0, -top / scale);
    const side = Math.min(box / scale, source.width - x, source.height - y);

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, x, y, side, side, 0, 0, OUTPUT, OUTPUT);

    canvas.toBlob(blob => {
      setBusy(false);
      if (!blob) { onCancel(); return; }
      const name = (file.name || 'avatar').replace(/\.[^.]+$/, '') + '.jpg';
      onCrop(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  if (!file) return null;

  return (
    <div className="avc-overlay" onClick={onCancel}>
      <div className="avc-modal" onClick={e => e.stopPropagation()}>
        <div className="avc-head">
          <h3>{title}</h3>
          <button className="avc-close" onClick={onCancel}><X size={18} /></button>
        </div>

        <div
          className="avc-box"
          style={{ width: box, height: box }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <img
            ref={imgRef}
            src={url}
            alt=""
            draggable={false}
            onLoad={e => setSource({ width: e.target.naturalWidth, height: e.target.naturalHeight })}
            style={{ left, top, width: shownW, height: shownH }}
          />
          {/* Круглое окно — дырка в затемнении: тень наружу дешевле четырёх
              прямоугольников вокруг круга и не даёт щелей на дробных размерах */}
          <div className="avc-hole" />
        </div>

        <div className="avc-zoom">
          <ZoomOut size={16} />
          <input
            type="range"
            min="1"
            max={MAX_ZOOM}
            step="0.01"
            value={view.z}
            onChange={e => setZoom(Number(e.target.value))}
          />
          <ZoomIn size={16} />
        </div>

        <div className="avc-hint">Перетащите снимок, колесом или ползунком приблизьте</div>

        <div className="avc-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Отмена</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!source || busy}>Готово</button>
        </div>
      </div>
    </div>
  );
}
