import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Search, QrCode, Printer, X, Wrench, ArrowRightLeft, FileText,
  Copy, Info, AlertTriangle, Plus, Pencil, Check,
} from 'lucide-react';
import { warehouseApi, BASE_URL } from '../../services/api';
import SecureImage from '../../components/warehouse/SecureImage';
import WarehouseAssetForm from './WarehouseAssetForm';

/**
 * Оборудование: список, карточка, QR и печать этикеток.
 *
 * Печать сделана через SVG в миллиметрах и window.print(), а не через генерацию
 * PDF на сервере. Причина практическая: этикетки печатают на разных принтерах и
 * на разной бумаге, и подгонять поля куда проще в диалоге печати браузера, чем
 * пересобирать PDF на каждую попытку. Для термопринтера есть отдельная выгрузка
 * ZPL — там браузер не участвует вовсе.
 */

const STATUS_LABELS = {
  in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
  storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано',
};

export default function WarehouseAssets({ access, tree, onOpenRoom, initialAssetId, onInitialAssetShown }) {
  const [filters, setFilters] = useState({ q: '', status: '', medCenterId: '', departmentId: '', maintenanceDue: false });
  const [data, setData] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [labelSize, setLabelSize] = useState('58x40');
  // null — форма закрыта; { asset: null } — постановка на учёт; { asset } — правка.
  const [form, setForm] = useState(null);

  const departments = useMemo(() => {
    if (!filters.medCenterId) return tree?.departments || [];
    return (tree?.departments || []).filter(d => d.medCenterId === filters.medCenterId);
  }, [tree, filters.medCenterId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (filters.q) params.q = filters.q;
      if (filters.status) params.status = filters.status;
      if (filters.medCenterId) params.medCenterId = filters.medCenterId;
      if (filters.departmentId) params.departmentId = filters.departmentId;
      if (filters.maintenanceDue) params.maintenanceDue = 'true';
      const { data: res } = await warehouseApi.assets(params);
      setData(res);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить список');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, filters.q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);

  // Приход из отчёта по ссылке на инвентарный номер: карточка открывается сразу,
  // не дожидаясь списка, и запрос на открытие сбрасывается — иначе она всплывала
  // бы снова при каждом возврате на вкладку.
  useEffect(() => {
    if (!initialAssetId) return;
    (async () => {
      try {
        const { data: res } = await warehouseApi.asset(initialAssetId);
        setSelected(res);
      } catch (e) {
        toast.error(e.response?.data?.error || 'Карточка недоступна');
      } finally {
        onInitialAssetShown?.();
      }
    })();
    /* eslint-disable-next-line */
  }, [initialAssetId]);

  const openCard = async (id) => {
    try {
      const { data: res } = await warehouseApi.asset(id);
      setSelected(res);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось открыть карточку');
    }
  };

  const toggle = (id) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const printLabels = async () => {
    if (!checked.size) return toast.error('Отметьте активы для печати');
    try {
      const { data: res } = await warehouseApi.labelsBatch({ ids: [...checked], size: labelSize });
      openPrintWindow(res);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось подготовить этикетки');
    }
  };

  return (
    <div className="wh-assets">
      <div className="wh-assets__filters">
        <div className="wh-search">
          <Search size={15} />
          <input placeholder="Наименование, инв. номер, серийный номер…"
                 value={filters.q}
                 onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
        </div>
        <select value={filters.medCenterId}
                onChange={e => setFilters(f => ({ ...f, medCenterId: e.target.value, departmentId: '' }))}>
          <option value="">Все медцентры</option>
          {(tree?.medCenters || []).map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
        </select>
        <select value={filters.departmentId} onChange={e => setFilters(f => ({ ...f, departmentId: e.target.value }))}>
          <option value="">Все отделения</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">Любой статус</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="wh-check">
          <input type="checkbox" checked={filters.maintenanceDue}
                 onChange={e => setFilters(f => ({ ...f, maintenanceDue: e.target.checked }))} />
          ТО в течение 30 дней и просроченные
        </label>
        {access?.capabilities?.canManageAssets && (
          <button className="wh-btn wh-btn--primary" style={{ marginLeft: 'auto' }}
                  onClick={() => setForm({ asset: null })}>
            <Plus size={15} /> Поставить на учёт
          </button>
        )}
      </div>

      {access?.capabilities?.canPrintLabels && (
        <div className="wh-assets__bulk">
          <span>{checked.size ? `Отмечено: ${checked.size}` : 'Отметьте активы для печати этикеток'}</span>
          <select value={labelSize} onChange={e => setLabelSize(e.target.value)}>
            <option value="58x40">Этикетка 58 × 40 мм</option>
            <option value="100x70">Этикетка 100 × 70 мм</option>
          </select>
          <button className="wh-btn wh-btn--ghost" onClick={printLabels} disabled={!checked.size}>
            <Printer size={15} /> Печать этикеток
          </button>
          {checked.size > 0 && (
            <button className="wh-btn wh-btn--link" onClick={() => setChecked(new Set())}>Снять отметки</button>
          )}
        </div>
      )}

      <div className="wh-table-wrap">
        <table className="wh-table">
          <thead>
            <tr>
              {access?.capabilities?.canPrintLabels && <th style={{ width: 30 }} />}
              <th>Инв. №</th>
              <th>Наименование</th>
              <th>Серийный №</th>
              <th>Размещение</th>
              <th>МОЛ</th>
              <th>Статус</th>
              <th>След. ТО</th>
              {access?.capabilities?.canSeeCosts && <th className="wh-num">Первонач., ₽</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="wh-table__loading"><div className="loading-spinner" /></td></tr>
            )}
            {!loading && data.items.map(a => {
              const overdue = a.nextMaintenanceDate && a.nextMaintenanceDate < today();
              return (
                <tr key={a.id} onClick={() => openCard(a.id)} className="wh-table__row">
                  {access?.capabilities?.canPrintLabels && (
                    <td onClick={e => { e.stopPropagation(); toggle(a.id); }}>
                      <input type="checkbox" checked={checked.has(a.id)} onChange={() => {}} />
                    </td>
                  )}
                  <td className="wh-mono">{a.inventoryNumber}</td>
                  <td>
                    <div className="wh-cell-main">{a.name}</div>
                    {a.model && <div className="wh-cell-sub">{a.model}</div>}
                  </td>
                  <td className="wh-mono wh-cell-sub">{a.serialNumber || '—'}</td>
                  <td>
                    {a.room ? (
                      <>
                        <div className="wh-cell-main">Каб. {a.room.number}</div>
                        <div className="wh-cell-sub">{a.room.department?.name || '—'}</div>
                      </>
                    ) : <span className="wh-muted">не размещён</span>}
                  </td>
                  <td className="wh-cell-sub">{a.responsible?.displayName || '—'}</td>
                  <td><span className={`wh-status wh-status--${a.status}`}>{STATUS_LABELS[a.status]}</span></td>
                  <td className={overdue ? 'wh-danger' : ''}>
                    {a.nextMaintenanceDate ? fmt(a.nextMaintenanceDate) : '—'}
                    {overdue && <AlertTriangle size={12} />}
                  </td>
                  {access?.capabilities?.canSeeCosts && (
                    <td className="wh-num">{Number(a.initialCost).toLocaleString('ru-RU')}</td>
                  )}
                </tr>
              );
            })}
            {!loading && !data.items.length && (
              <tr><td colSpan={9} className="wh-empty">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="wh-assets__count">Показано {data.items.length} из {data.total}</div>

      {selected && (
        <AssetCard data={selected}
                   access={access}
                   labelSize={labelSize}
                   onClose={() => setSelected(null)}
                   onOpenRoom={onOpenRoom}
                   onReload={() => openCard(selected.asset.id)}
                   onEdit={() => setForm({ asset: selected.asset })} />
      )}

      {/* Форма идёт после карточки намеренно. Обе модалки лежат на одном z-index,
          и при обратном порядке форма правки, открытая из карточки, оказывалась под
          ней: её было видно снизу, но добраться до неё можно было только закрыв
          карточку. Порядок в разметке плюс явный wh-modal--nested держат её сверху. */}
      {form && (
        <WarehouseAssetForm asset={form.asset} tree={tree} access={access}
                            nested={Boolean(selected)}
                            onClose={() => setForm(null)}
                            onSaved={async () => {
                              await load();
                              if (selected?.asset?.id) await openCard(selected.asset.id);
                            }} />
      )}
    </div>
  );
}

// ── Карточка актива ──────────────────────────────────────────────────────────

function AssetCard({ data, access, labelSize, onClose, onOpenRoom, onReload, onEdit }) {
  const { asset, publicUrl, depreciation, files, maintenance, repairs, movements } = data;
  const [tab, setTab] = useState('info');
  const [serviceModal, setServiceModal] = useState(null);

  const copyUrl = () => {
    navigator.clipboard?.writeText(publicUrl)
      .then(() => toast.success('Ссылка на публичную карточку скопирована'))
      .catch(() => toast.error('Не удалось скопировать'));
  };

  const printOne = async () => {
    try {
      const { data: res } = await warehouseApi.labelsBatch({ ids: [asset.id], size: labelSize });
      openPrintWindow(res);
    } catch (e) {
      toast.error('Не удалось подготовить этикетку');
    }
  };

  const downloadZpl = async () => {
    try {
      const { data: zpl } = await warehouseApi.zpl(asset.id, 1);
      const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${asset.inventoryNumber}.zpl`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error('Не удалось выгрузить ZPL');
    }
  };

  return (<>
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div>
            <div className="wh-modal__title">{asset.name}</div>
            <div className="wh-modal__sub">
              {asset.model} · <span className="wh-mono">{asset.inventoryNumber}</span>
            </div>
          </div>
          <div className="wh-modal__head-actions">
            {access?.capabilities?.canManageAssets && (
              <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={onEdit}>
                <Pencil size={14} /> Редактировать
              </button>
            )}
            <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="wh-modal__tabs">
          {[
            ['info', 'Карточка'],
            ['qr', 'QR и этикетка'],
            ['maintenance', `ТО и ремонты (${maintenance.length + repairs.length})`],
            ['timeline', `История (${movements.length})`],
            ['files', `Документы (${files.length})`],
          ].map(([k, label]) => (
            <button key={k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        <div className="wh-modal__body">
          {tab === 'info' && (
            <div className="wh-grid2">
              <Field label="Производитель" value={asset.manufacturer} />
              <Field label="Серийный номер" value={asset.serialNumber} mono />
              <Field label="Статус" value={STATUS_LABELS[asset.status]} />
              <Field label="Категория" value={asset.category?.name} />
              <Field label="Размещение" value={asset.room
                ? `Каб. ${asset.room.number}${asset.room.name ? ` — ${asset.room.name}` : ''}`
                : 'не размещён'}
                action={asset.room && (
                  <button className="wh-btn wh-btn--link" onClick={() => { onClose(); onOpenRoom?.(asset.room.id); }}>
                    дашборд кабинета
                  </button>
                )} />
              <Field label="Отделение" value={asset.room?.department?.name} />
              <Field label="МОЛ" value={asset.responsible?.displayName} />
              <Field label="Дата ввода в эксплуатацию" value={fmt(asset.commissioningDate)} />
              <Field label="Гарантия до" value={fmt(asset.warrantyUntil)} />
              <Field label="Поставщик" value={asset.supplier?.name} />
              <Field label="Интервал ТО, мес." value={asset.maintenanceIntervalMonths} />
              <Field label="Следующее ТО" value={fmt(asset.nextMaintenanceDate)} />

              {access?.capabilities?.canSeeCosts && (
                <>
                  <div className="wh-grid2__full wh-subhead">
                    Стоимость и амортизация
                    <span className="wh-badge wh-badge--neutral" title="Значения внесены вручную: обмена с 1С нет">
                      источник: ручной ввод
                    </span>
                  </div>
                  <Field label="Первоначальная стоимость" value={money(depreciation.initialCost)} />
                  <Field label="Накопленная амортизация" value={money(depreciation.accumulated)} />
                  <Field label="Остаточная стоимость" value={money(depreciation.residual)} />
                  <Field label="Износ" value={`${depreciation.wearPercent} %`} />
                  <Field label="СПИ, мес." value={asset.usefulLifeMonths} />
                  <Field label="ОКОФ / аморт. группа"
                         value={[asset.okof, asset.depreciationGroup].filter(Boolean).join(' / ')} />
                  {depreciation.fullyDepreciatedInUse && (
                    <div className="wh-grid2__full wh-note wh-note--warn">
                      <AlertTriangle size={15} />
                      <div>Полностью самортизировано, но в эксплуатации — кандидат на замену.</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'qr' && (
            <div className="wh-qr">
              <div className="wh-qr__col">
                <SecureImage url={warehouseApi.assetQrUrl(asset.id)}
                             alt="QR-код актива" className="wh-qr__img" />
                <div className="wh-qr__url">
                  <code>{publicUrl}</code>
                  <button className="wh-icon-btn" onClick={copyUrl} title="Скопировать"><Copy size={15} /></button>
                </div>
                <div className="wh-note wh-note--subtle">
                  <Info size={15} />
                  <div>
                    Карточка по этой ссылке открывается <b>без авторизации</b> — QR наклеен на
                    прибор, и подходят к нему с телефона, где портал не залогинен. Поэтому наружу
                    отдаётся только назначение прибора, статус и даты ТО. Стоимость, амортизация,
                    ФИО ответственного и документы на публичной карточке не показываются.
                  </div>
                </div>
              </div>
              <div className="wh-qr__col">
                <div className="wh-qr__label-preview">
                  <SecureImage url={warehouseApi.labelUrl(asset.id, labelSize)}
                               alt={`Этикетка ${labelSize} мм`} />
                </div>
                <div className="wh-qr__actions">
                  <button className="wh-btn wh-btn--primary" onClick={printOne}>
                    <Printer size={15} /> Печать этикетки {labelSize.replace('x', ' × ')} мм
                  </button>
                  {access?.capabilities?.canPrintLabels && (
                    <button className="wh-btn wh-btn--ghost" onClick={downloadZpl}>
                      <FileText size={15} /> Выгрузить ZPL (термопринтер)
                    </button>
                  )}
                </div>
                {asset.labelPrintedAt && (
                  <div className="wh-hint">Этикетка печаталась {fmt(asset.labelPrintedAt)}</div>
                )}
              </div>
            </div>
          )}

          {tab === 'maintenance' && (
            <>
              <div className="wh-section-head">
                <h4 className="wh-subhead">График и факт ТО</h4>
                {access?.capabilities?.canMaintenance && (
                  <button className="wh-btn wh-btn--secondary wh-btn--sm"
                          onClick={() => setServiceModal({ kind: 'maintenance-create' })}>
                    <Plus size={14} /> Запланировать ТО
                  </button>
                )}
              </div>
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr><th>Наряд</th><th>Тип</th><th>План</th><th>Факт</th><th>Статус</th><th>Результат</th><th className="wh-num">Стоимость</th><th>Подрядчик</th>{access?.capabilities?.canMaintenance && <th />}</tr>
                </thead>
                <tbody>
                  {maintenance.map(o => (
                    <tr key={o.id}>
                      <td className="wh-mono">{o.number}</td>
                      <td>{maintType(o.type)}</td>
                      <td>{fmt(o.plannedDate)}</td>
                      <td>{fmt(o.factDate)}</td>
                      <td><span className={`wh-status wh-status--${o.status}`}>{maintStatus(o.status)}</span></td>
                      <td>{maintResult(o.result)}</td>
                      <td className="wh-num">{o.cost ? money(o.cost) : '—'}</td>
                      <td>{o.contractor?.name || '—'}</td>
                      {access?.capabilities?.canMaintenance && <td>{!o.factDate && <button className="wh-btn wh-btn--link" onClick={() => setServiceModal({ kind: 'maintenance-close', row: o })}>Закрыть</button>}</td>}
                    </tr>
                  ))}
                  {!maintenance.length && <tr><td colSpan={8} className="wh-empty">Нарядов нет</td></tr>}
                </tbody>
              </table>

              <div className="wh-section-head">
                <h4 className="wh-subhead">Журнал ремонтов</h4>
                {access?.capabilities?.canMaintenance && (
                  <button className="wh-btn wh-btn--secondary wh-btn--sm"
                          onClick={() => setServiceModal({ kind: 'repair-create' })}>
                    <Plus size={14} /> Открыть ремонт
                  </button>
                )}
              </div>
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr><th>№</th><th>Начало</th><th>Окончание</th><th>Описание</th><th className="wh-num">Стоимость</th><th>Простой, ч</th><th>Результат</th>{access?.capabilities?.canMaintenance && <th />}</tr>
                </thead>
                <tbody>
                  {repairs.map(r => (
                    <tr key={r.id}>
                      <td className="wh-mono">{r.number}</td>
                      <td>{fmt(r.startedAt)}</td>
                      <td>{r.finishedAt ? fmt(r.finishedAt) : <b className="wh-danger">в ремонте</b>}</td>
                      <td>{r.description || '—'}</td>
                      <td className="wh-num">{money(r.cost)}</td>
                      <td className="wh-num">{r.downtimeHours}</td>
                      <td>{r.result === 'written_off' ? 'Списан' : r.result === 'repaired' ? 'Отремонтирован' : '—'}</td>
                      {access?.capabilities?.canMaintenance && <td>{!r.finishedAt && <button className="wh-btn wh-btn--link" onClick={() => setServiceModal({ kind: 'repair-close', row: r })}>Закрыть</button>}</td>}
                    </tr>
                  ))}
                  {!repairs.length && <tr><td colSpan={7} className="wh-empty">Ремонтов не было</td></tr>}
                </tbody>
              </table>
            </>
          )}

          {tab === 'timeline' && (
            <ul className="wh-timeline">
              {movements.map(m => (
                <li key={m.id} className={`wh-timeline__item wh-timeline__item--${m.type}`}>
                  <div className="wh-timeline__date">{fmtDateTime(m.occurredAt)}</div>
                  <div className="wh-timeline__body">
                    <b>{moveType(m.type)}</b>
                    {(m.fromRoom || m.toRoom) && (
                      <span className="wh-timeline__path">
                        {m.fromRoom ? `Каб. ${m.fromRoom.number}` : '—'}
                        <ArrowRightLeft size={12} />
                        {m.toRoom ? `Каб. ${m.toRoom.number}` : '—'}
                      </span>
                    )}
                    {m.reasonText && <div className="wh-timeline__reason">{m.reasonText}</div>}
                    <div className="wh-timeline__who">
                      {m.fromResponsible?.displayName && `сдал: ${m.fromResponsible.displayName}`}
                      {m.toResponsible?.displayName && ` · принял: ${m.toResponsible.displayName}`}
                      {m.initiator?.displayName && ` · оформил: ${m.initiator.displayName}`}
                    </div>
                  </div>
                </li>
              ))}
              {!movements.length && <li className="wh-empty">История пуста</li>}
            </ul>
          )}

          {tab === 'files' && (
            <AssetFiles assetId={asset.id} files={files} canEdit={access?.capabilities?.canManageAssets} onReload={onReload} />
          )}
        </div>
      </div>
    </div>
    {serviceModal && (
      <ServiceModal asset={asset} action={serviceModal}
                    onClose={() => setServiceModal(null)}
                    onSaved={async () => { setServiceModal(null); await onReload(); }} />
    )}
  </>);
}

function ServiceModal({ asset, action, onClose, onSaved }) {
  const creatingMaintenance = action.kind === 'maintenance-create';
  const closingMaintenance = action.kind === 'maintenance-close';
  const creatingRepair = action.kind === 'repair-create';
  const [contractors, setContractors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: 'maintenance', plannedDate: '', factDate: new Date().toISOString().slice(0, 10),
    startedAt: new Date().toISOString().slice(0, 10), finishedAt: new Date().toISOString().slice(0, 10),
    contractorId: '', isMandatory: false, cost: '', downtimeHours: '',
    description: '', result: closingMaintenance ? 'normal' : 'repaired', resultNote: '',
  });

  useEffect(() => {
    warehouseApi.contractors({ kind: 'service' })
      .then(({ data }) => setContractors(data))
      .catch(() => {});
  }, []);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const submit = async () => {
    if (creatingMaintenance && !form.plannedDate) return toast.error('Укажите плановую дату');
    if (creatingRepair && !form.startedAt) return toast.error('Укажите дату начала ремонта');
    setSaving(true);
    try {
      if (creatingMaintenance) {
        await warehouseApi.createMaintenance({
          assetId: asset.id, type: form.type, plannedDate: form.plannedDate,
          contractorId: form.contractorId || null, isMandatory: form.isMandatory,
          cost: form.cost || 0,
        });
        toast.success('Наряд ТО создан');
      } else if (closingMaintenance) {
        await warehouseApi.closeMaintenance(action.row.id, {
          factDate: form.factDate, result: form.result, resultNote: form.resultNote,
          cost: form.cost === '' ? action.row.cost : form.cost,
          downtimeHours: form.downtimeHours === '' ? action.row.downtimeHours : form.downtimeHours,
        });
        toast.success('Наряд ТО закрыт');
      } else if (creatingRepair) {
        await warehouseApi.createRepair({
          assetId: asset.id, startedAt: form.startedAt, description: form.description,
          contractorId: form.contractorId || null, cost: form.cost || 0,
        });
        toast.success('Ремонт открыт');
      } else {
        await warehouseApi.closeRepair(action.row.id, {
          finishedAt: form.finishedAt, result: form.result, description: form.description || undefined,
          cost: form.cost === '' ? action.row.cost : form.cost,
          downtimeHours: form.downtimeHours === '' ? undefined : form.downtimeHours,
        });
        toast.success('Ремонт закрыт');
      }
      await onSaved();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const title = creatingMaintenance ? 'Новый наряд ТО'
    : closingMaintenance ? `Закрытие наряда ${action.row.number}`
    : creatingRepair ? 'Передача оборудования в ремонт'
    : `Закрытие ремонта ${action.row.number}`;

  return (
    <div className="wh-modal wh-modal--nested" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div><div className="wh-modal__title">{title}</div><div className="wh-modal__sub">{asset.inventoryNumber} · {asset.name}</div></div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body"><div className="wh-form">
          {creatingMaintenance && <>
            <label>Вид обслуживания
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="maintenance">ТО</option><option value="verification">Поверка</option>
                <option value="calibration">Калибровка</option><option value="dosimetry">Дозиметрия</option>
                <option value="inspection">Осмотр</option>
              </select>
            </label>
            <label>Плановая дата <input type="date" value={form.plannedDate} onChange={e => set('plannedDate', e.target.value)} /></label>
            <label className="wh-check"><input type="checkbox" checked={form.isMandatory} onChange={e => set('isMandatory', e.target.checked)} /> Обязательное по НПА</label>
          </>}
          {closingMaintenance && <>
            <label>Фактическая дата <input type="date" value={form.factDate} onChange={e => set('factDate', e.target.value)} /></label>
            <label>Результат
              <select value={form.result} onChange={e => set('result', e.target.value)}>
                <option value="normal">Норма</option><option value="with_remarks">С замечаниями</option><option value="failed">Не пройдено</option>
              </select>
            </label>
            <label>Заключение <textarea rows={3} value={form.resultNote} onChange={e => set('resultNote', e.target.value)} /></label>
          </>}
          {creatingRepair && <label>Дата начала <input type="date" value={form.startedAt} onChange={e => set('startedAt', e.target.value)} /></label>}
          {!creatingMaintenance && !closingMaintenance && !creatingRepair && <>
            <label>Дата окончания <input type="date" value={form.finishedAt} onChange={e => set('finishedAt', e.target.value)} /></label>
            <label>Результат
              <select value={form.result} onChange={e => set('result', e.target.value)}>
                <option value="repaired">Отремонтировано</option><option value="written_off">Не подлежит ремонту — списать</option>
              </select>
            </label>
          </>}
          {(creatingMaintenance || creatingRepair) && <label>Подрядчик
            <select value={form.contractorId} onChange={e => set('contractorId', e.target.value)}>
              <option value="">—</option>{contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>}
          {(creatingRepair || (!creatingMaintenance && !closingMaintenance)) && <label>Описание
            <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
          </label>}
          <div className="wh-form__row2">
            <label>Стоимость, ₽ <input type="number" min="0" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)} /></label>
            {!creatingMaintenance && !creatingRepair && <label>Простой, ч <input type="number" min="0" step="0.5" value={form.downtimeHours} onChange={e => set('downtimeHours', e.target.value)} /></label>}
          </div>
        </div></div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit} disabled={saving}><Check size={14} /> {saving ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}

function AssetFiles({ assetId, files, canEdit, onReload }) {
  const [uploading, setUploading] = useState(false);

  const upload = async (e) => {
    const list = e.target.files;
    if (!list?.length) return;
    const fd = new FormData();
    for (const f of list) fd.append('files', f);
    fd.append('kind', 'other');
    setUploading(true);
    try {
      await warehouseApi.uploadAssetFiles(assetId, fd);
      toast.success('Файлы загружены');
      onReload();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const togglePublic = async (file) => {
    try {
      await warehouseApi.patchAssetFile(file.id, { isPublic: !file.isPublic });
      onReload();
    } catch {
      toast.error('Не удалось изменить видимость');
    }
  };

  return (
    <div>
      {canEdit && (
        <label className="wh-btn wh-btn--ghost">
          <Plus size={15} /> {uploading ? 'Загрузка…' : 'Добавить файлы'}
          <input type="file" multiple hidden onChange={upload} />
        </label>
      )}
      <div className="wh-note wh-note--subtle">
        <Info size={15} />
        <div>
          Флажок «на публичной карточке» открывает файл всем, у кого есть QR-ссылка.
          По умолчанию выключен: рядом с паспортом прибора обычно лежат договоры и акты с ценами.
        </div>
      </div>
      <ul className="wh-files">
        {files.map(f => (
          <li key={f.id}>
            <a href={`${BASE_URL}/uploads/warehouse/assets/${f.storedName}`} target="_blank" rel="noreferrer">
              {f.originalName}
            </a>
            <span className="wh-cell-sub">{(f.size / 1024).toFixed(0)} КБ · {f.uploader?.displayName || '—'}</span>
            {canEdit && (
              <label className="wh-check wh-check--inline">
                <input type="checkbox" checked={f.isPublic} onChange={() => togglePublic(f)} />
                на публичной карточке
              </label>
            )}
          </li>
        ))}
        {!files.length && <li className="wh-empty">Документов нет</li>}
      </ul>
    </div>
  );
}

// ── Печать этикеток ──────────────────────────────────────────────────────────
/**
 * Открывает окно печати с этикетками. @page задаётся ровно в размер этикетки,
 * иначе браузер печатает её по центру листа A4 и рулонный принтер выдаёт пустую
 * ленту с маленькой наклейкой посередине.
 */
function openPrintWindow({ labels, sizeMm }) {
  const w = window.open('', '_blank');
  if (!w) return toast.error('Браузер заблокировал окно печати');
  const { w: mmW, h: mmH } = sizeMm;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Этикетки (${labels.length})</title>
    <style>
      @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .label { width: ${mmW}mm; height: ${mmH}mm; page-break-after: always; overflow: hidden; }
      .label:last-child { page-break-after: auto; }
      @media screen {
        body { background: #eef1f5; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
        .label { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
      }
    </style></head><body>
    ${labels.map(l => `<div class="label">${l.svg}</div>`).join('')}
    <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
    </body></html>`);
  w.document.close();
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
function Field({ label, value, mono, action }) {
  return (
    <div className="wh-field-ro">
      <span className="wh-field-ro__label">{label}</span>
      <span className={`wh-field-ro__value ${mono ? 'wh-mono' : ''}`}>
        {value || value === 0 ? value : '—'} {action}
      </span>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fmt = d => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const fmtDateTime = d => (d ? new Date(d).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—');
const money = n => `${Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const maintType = t => ({ maintenance: 'ТО', verification: 'Поверка', calibration: 'Калибровка', dosimetry: 'Дозиметрия', inspection: 'Осмотр' }[t] || t);
const maintStatus = s => ({ planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен', overdue: 'Просрочен', cancelled: 'Отменён' }[s] || s);
const maintResult = r => ({ normal: 'Норма', with_remarks: 'С замечаниями', failed: 'Не пройдено' }[r] || (r ? r : '—'));
const moveType = t => ({
  receipt: 'Приём', return: 'Возврат', issue: 'Выдача', transfer: 'Перемещение', repair_out: 'В ремонт',
  repair_in: 'Из ремонта', writeoff: 'Списание', inventory: 'Инвентаризация', surplus: 'Оприходование излишков',
}[t] || t);
