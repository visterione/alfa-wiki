/**
 * Вкладка «Рекламы» — карта рекламных площадок сети (ver. 8.22).
 *
 * Перенос backend/bot/map.html в React без изменения поведения: те же цвета и
 * категории, та же легенда со счётчиками, та же боковая панель с медиа и тот же
 * центр карты. Отличий ровно три, и все вынужденные:
 *
 *   1. Leaflet теперь зависимость, а не <script> с unpkg. Страница подтягивала
 *      его с чужого CDN при каждом открытии — на рабочем месте без интернета
 *      карта просто не появлялась.
 *   2. Права: раньше правку меток открывало право pages.write, то есть тот же
 *      флаг, что и правку вики-страниц. Теперь — уровень вкладки «Рекламы».
 *   3. Метка удаляется без window.confirm: подтверждение живёт в самой панели,
 *      как везде в портале.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, Loader2, MapPin, Pencil, Play, Plus, Trash2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { map as mapApi, BASE_URL } from '../../services/api';

// Категории площадок. Цвет здесь — не оформление, а сама категория: по нему
// метка опознаётся на карте и попадает в легенду.
const COLOR_CATEGORIES = {
  '#ff4d4d': 'Экраны',
  '#ff6f00': 'Партнёрские рекламы',
  '#cddc39': 'Наши экраны',
  '#1abc9c': 'Остановки',
  '#9999ff': 'Навигация',
  '#de64a1': 'Фасады',
  '#9e9e9e': 'Сити формат',
  '#4a90e2': 'Прочее'
};

const COLOR_PALETTE = [
  '#ff4d4d', '#de64a1', '#ff6f00', '#ed9121', '#ffd54f',
  '#f4d03f', '#cddc39', '#8bc34a', '#00bfa5', '#2ecc71',
  '#1abc9c', '#4a90e2', '#3498db', '#34495e', '#9999ff',
  '#800080', '#8e44ad', '#7f5b3a', '#999999', '#9e9e9e'
];

const DEFAULT_COLOR = '#4a90e2';
const MAP_CENTER = [44.8860, 37.326];
const MAP_ZOOM = 14;

const isVideo = path => /\.(mp4|webm|ogg)$/i.test(path || '');
const mediaUrl = path => (String(path).startsWith('http') ? path : `${BASE_URL}${path}`);

/** Метка-капля цветом категории. Тот же SVG, что рисовала HTML-версия. */
function pinIcon(color) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46">` +
    `<path d="M18 0C11.163 0 5.5 5.663 5.5 12.5 5.5 22.125 18 46 18 46s12.5-23.875 12.5-33.5C30.5 5.663 24.837 0 18 0z" fill="${color || DEFAULT_COLOR}"/>` +
    `<circle cx="18" cy="12.5" r="5.5" fill="#fff" opacity="0.9"/></svg>`
  );
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconSize: [36, 46],
    iconAnchor: [18, 46],
    popupAnchor: [0, -40]
  });
}

export default function AdsTab({ level }) {
  const canEdit = level === 'edit';
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [editor, setEditor] = useState(null);   // { latlng, marker? }
  const [viewer, setViewer] = useState(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await mapApi.getMarkers();
      setMarkers(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить метки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Карта создаётся один раз: пересоздание на каждый рендер сбрасывало бы
  // масштаб и положение, а метки меняются чаще, чем сама карта.
  useEffect(() => {
    if (mapRef.current || !hostRef.current) return;
    const instance = L.map(hostRef.current).setView(MAP_CENTER, MAP_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(instance);
    layerRef.current = L.layerGroup().addTo(instance);
    mapRef.current = instance;
    return () => { instance.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  // Обработчик клика по карте переустанавливается вместе с правом: он замыкает
  // canEdit, и без переподписки читатель продолжал бы открывать форму.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return;
    const onClick = e => { if (canEdit) setEditor({ latlng: e.latlng, marker: null }); };
    instance.on('click', onClick);
    return () => instance.off('click', onClick);
  }, [canEdit]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markers.forEach(m => {
      const marker = L.marker([m.lat, m.lng], { icon: pinIcon(m.color) });
      marker.on('click', () => { setSelected(m); setConfirmDelete(false); });
      layer.addLayer(marker);
    });
  }, [markers]);

  const legend = useMemo(() => {
    const stats = {};
    markers.forEach(m => { stats[m.color || DEFAULT_COLOR] = (stats[m.color || DEFAULT_COLOR] || 0) + 1; });
    return Object.entries(COLOR_CATEGORIES).map(([color, label]) => ({ color, label, count: stats[color] || 0 }));
  }, [markers]);

  const remove = async () => {
    try {
      await mapApi.deleteMarker(selected.id);
      toast.success('Метка удалена');
      setSelected(null);
      setConfirmDelete(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось удалить метку');
    }
  };

  return (
    <section className="mk-ads">
      <div className="mk-map-wrap">
        <div ref={hostRef} className="mk-map" />

        {loading && <div className="mk-map-loading"><Loader2 size={18} className="mk-spin" /> Загружаем метки…</div>}

        <div className={`mk-legend ${legendOpen ? '' : 'collapsed'}`}>
          <button className="mk-legend-head" onClick={() => setLegendOpen(v => !v)}>
            <Layers size={15} /> <span>Легенда</span>
          </button>
          {legendOpen && (
            <div className="mk-legend-items">
              {legend.map(item => (
                <div className="mk-legend-item" key={item.color}>
                  <i style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <b>{item.count}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        {canEdit && <div className="mk-map-hint"><MapPin size={13} /> Нажмите на карту, чтобы добавить метку</div>}
      </div>

      {selected && (
        <aside className="mk-panel">
          <button className="ola-icon-btn mk-panel-close" onClick={() => setSelected(null)}><X size={17} /></button>
          <div className="mk-panel-body">
            <div className="mk-panel-head">
              <i style={{ background: selected.color || DEFAULT_COLOR }} />
              <h3>{selected.title}</h3>
            </div>
            {selected.category && <span className="ola-badge muted">{selected.category}</span>}
            {selected.description && <p className="mk-panel-desc">{selected.description}</p>}

            {selected.media?.length > 0 && (
              <div className="mk-panel-media">
                {selected.media.map((path, i) => (
                  <button key={i} onClick={() => setViewer({ url: mediaUrl(path), video: isVideo(path) })}>
                    {isVideo(path)
                      ? <><video src={mediaUrl(path)} /><span className="mk-play"><Play size={26} /></span></>
                      : <img src={mediaUrl(path)} alt="" />}
                  </button>
                ))}
              </div>
            )}

            {selected.creator && (
              <div className="mk-panel-meta">
                Создал: {selected.creator.displayName || selected.creator.username}
              </div>
            )}

            {canEdit && (
              <div className="ola-actions">
                <button
                  className="ola-btn"
                  onClick={() => { setEditor({ latlng: { lat: selected.lat, lng: selected.lng }, marker: selected }); setSelected(null); }}
                >
                  <Pencil size={15} /> Редактировать
                </button>
                {confirmDelete ? (
                  <>
                    <button className="ola-btn danger" onClick={remove}><Trash2 size={15} /> Удалить навсегда</button>
                    <button className="ola-btn" onClick={() => setConfirmDelete(false)}>Отмена</button>
                  </>
                ) : (
                  <button className="ola-btn danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Удалить</button>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {editor && (
        <MarkerEditor
          latlng={editor.latlng}
          marker={editor.marker}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}

      {viewer && (
        <div className="mk-viewer" onClick={() => setViewer(null)}>
          <button className="ola-icon-btn mk-viewer-close"><X size={20} /></button>
          <div onClick={e => e.stopPropagation()}>
            {viewer.video
              ? <video src={viewer.url} controls autoPlay />
              : <img src={viewer.url} alt="" />}
          </div>
        </div>
      )}
    </section>
  );
}

function MarkerEditor({ latlng, marker, onClose, onSaved }) {
  const [title, setTitle] = useState(marker?.title || '');
  const [description, setDescription] = useState(marker?.description || '');
  const [color, setColor] = useState(marker?.color || DEFAULT_COLOR);
  const [existing, setExisting] = useState(marker?.media || []);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const previews = useMemo(() => files.map(f => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach(p => URL.revokeObjectURL(p.url)), [previews]);

  const save = async () => {
    if (!title.trim()) { toast.error('Введите название'); return; }
    setSaving(true);
    try {
      let uploaded = [];
      if (files.length) {
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        const { data } = await mapApi.upload(fd);
        uploaded = data.files || [];
      }
      const payload = {
        lat: marker ? marker.lat : latlng.lat,
        lng: marker ? marker.lng : latlng.lng,
        title: title.trim(),
        description: description.trim(),
        color,
        media: [...existing, ...uploaded],
        category: COLOR_CATEGORIES[color] || null
      };
      if (marker) await mapApi.updateMarker(marker.id, payload);
      else await mapApi.createMarker(payload);
      toast.success(marker ? 'Метка обновлена' : 'Метка создана');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить метку');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mk-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="mk-modal">
        <header className="mk-modal-head">
          <h3>{marker ? 'Редактировать метку' : 'Добавить метку'}</h3>
          <button className="ola-icon-btn" onClick={onClose} disabled={saving}><X size={17} /></button>
        </header>

        <div className="mk-modal-body">
          <div className="ola-field">
            <label>Название</label>
            <input className="ola-input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="ola-field">
            <label>Описание</label>
            <textarea className="ola-textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div className="ola-field">
            <label>Цвет и категория</label>
            <div className="mk-colors">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  className={`mk-color ${c === color ? 'on' : ''}`}
                  style={{ background: c }}
                  title={COLOR_CATEGORIES[c] || c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            {COLOR_CATEGORIES[color] && <p className="mk-hint">Категория: {COLOR_CATEGORIES[color]}</p>}
          </div>

          <div className="ola-field">
            <label>Медиафайлы</label>
            <label className="mk-upload">
              <Upload size={16} /> Загрузить файлы
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                hidden
                onChange={e => { setFiles(f => [...f, ...Array.from(e.target.files)]); e.target.value = ''; }}
              />
            </label>
            {(existing.length > 0 || previews.length > 0) && (
              <div className="mk-thumbs">
                {existing.map((path, i) => (
                  <div className="mk-thumb" key={`e${i}`}>
                    {isVideo(path) ? <video src={mediaUrl(path)} /> : <img src={mediaUrl(path)} alt="" />}
                    <button onClick={() => setExisting(list => list.filter((_, j) => j !== i))}><X size={12} /></button>
                  </div>
                ))}
                {previews.map((p, i) => (
                  <div className="mk-thumb new" key={`n${i}`}>
                    {p.file.type.startsWith('video') ? <video src={p.url} /> : <img src={p.url} alt="" />}
                    <button onClick={() => setFiles(list => list.filter((_, j) => j !== i))}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="mk-modal-foot">
          <div className="mk-foot-right">
            <button className="ola-btn" onClick={onClose} disabled={saving}>Отмена</button>
            <button className="ola-btn primary" onClick={save} disabled={saving}>
              {saving ? <><Loader2 size={15} className="mk-spin" /> Сохранение…</> : <><Plus size={15} /> Сохранить</>}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
