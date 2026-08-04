import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Download, X, FileText, Table as TableIcon, FileCode, Calendar, User, Folder, Search, History, DollarSign, ChevronDown, ChevronRight } from 'lucide-react';
import { journal, pages, folders, rbActivityLog, mis } from '../../services/api';
import { BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import PageHistoryModal from '../../components/PageHistoryModal';
import '../Admin.css';

const MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function pluralRu(n, forms) {
  const m10 = n % 10, m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return forms[2];
  if (m10 === 1) return forms[0];
  if (m10 >= 2 && m10 <= 4) return forms[1];
  return forms[2];
}

function abbreviateName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  const [last, first, middle] = parts;
  return `${last} ${first[0]}.${middle ? ` ${middle[0]}.` : ''}`;
}

function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now  = new Date();
  const diffMin  = Math.floor((now - date) / 60000);
  const diffDays = Math.floor((now - date) / 86400000);
  const timeStr  = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diffMin  < 1) return 'только что';
  if (diffMin  < 60) return `${diffMin} мин. назад`;
  if (diffDays === 0) return `сегодня, ${timeStr}`;
  if (diffDays === 1) return `вчера, ${timeStr}`;
  if (diffDays < 7)  return date.toLocaleDateString('ru-RU', { weekday: 'short' }) + `, ${timeStr}`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + `, ${timeStr}`;
}

const ACTION_COLORS = {
  create: { bg: '#dcfce7', color: '#166534' },
  save:   { bg: '#dcfce7', color: '#166534' },
  update: { bg: '#dbeafe', color: '#1e40af' },
  delete: { bg: '#fee2e2', color: '#991b1b' },
  reset:  { bg: '#fef3c7', color: '#92400e' },
  import: { bg: '#ede9fe', color: '#5b21b6' },
  grant:  { bg: '#d1fae5', color: '#065f46' },
  revoke: { bg: '#fee2e2', color: '#991b1b' },
};

const ACTION_LABELS_RU = {
  create: 'Создано',
  save:   'Сохранено',
  update: 'Изменено',
  delete: 'Удалено',
  reset:  'Сброс',
  import: 'Импорт',
  grant:  'Доступ выдан',
  revoke: 'Отозвано',
};

// ── Diff viewer ────────────────────────────────────────────────────────────────

const FIELD_LABELS = {
  bonusPercent: 'Процент бонуса', bonusRub: 'Бонус (₽)',
  dateFrom: 'Дата начала', dateTo: 'Дата конца',
  pattern: 'Шаблон', timeFrom: 'Время от', timeTo: 'Время до',
  roleTitle: 'Должность', clinicId: 'Клиника',
  categoryId: 'Категория', cabinetId: 'Кабинет',
  doctorCount: 'Кол-во врачей', name: 'Название',
  amount: 'Сумма', periodLabel: 'Период', note: 'Комментарий', financistName: 'Кассир',
  user: 'Пользователь', permission: 'Права доступа',
  tab1: 'Сотрудники', tabWorkTime: 'Учёт времени', tabHourNorms: 'Норма часов',
  tabSchedule: 'Расписание', tab2: 'Услуги', tab3: 'Направления', tab4: 'Отчёт',
  tabArchiveHistory: 'Архив: история', tabArchiveKassa: 'Архив: касса',
  tabArchiveTabel: 'Архив: табель', tabSummary: 'Сводка', tabKpi: 'KPI',
  clinics: 'Доступные клиники',
  serviceName: 'Услуга', serviceCode: 'Код услуги',
  title: 'Заголовок', reportType: 'Тип отчёта', totalAmount: 'Итого',
  month: 'Месяц', year: 'Год', orgName: 'Организация', subdivision: 'Подразделение',
  comment: 'Комментарий',
  doctor_added: 'Добавлен врач', doctor_removed: 'Исключён врач',
};

const VALUE_LABELS = {
  edit: 'редактирование', read: 'просмотр', block: 'запрет',
  percent: 'процент', amount: 'сумма',
  turnover: 'от оборота', final: 'от з/п',
};

const TD = ({ children, style }) => (
  <td style={{ padding: '3px 8px', fontSize: 12, borderBottom: '1px solid #f3f4f6', ...style }}>{children}</td>
);

function formatItem(item) {
  if (item == null) return '—';
  if (typeof item === 'string') return item;
  if (typeof item === 'number') return String(item);

  const parts = [];
  const name = item.name || item.roleTitle || item.role || item.title || item.serviceName;
  if (name) parts.push(name);

  // value + valueType (удержания, расходники, доп. выплаты, материалы по услугам)
  if (item.value != null) {
    parts.push(item.valueType === 'percent' ? `${item.value}%` : `${item.value} ₽`);
  }
  // тип удержания: от оборота или от зарплаты
  if (item.deductionType != null) {
    parts.push(item.deductionType === 'turnover' ? 'оборот' : 'от з/п');
  }

  // нормочасы (ставки по ролям)
  if (item.normHours != null) parts.push(`${item.normHours} ч`);

  // legacy fields
  if (item.amount   != null) parts.push(`${item.amount} ₽`);
  if (item.percent  != null) parts.push(`${item.percent}%`);
  if (item.rate     != null) parts.push(`${item.rate}%`);
  if (item.hours    != null) parts.push(`${item.hours} ч`);

  if (item.locked) parts.push('🔒');

  if (parts.length === 0) return JSON.stringify(item);
  return parts.join(' · ');
}

function formatSchedulePattern(p) {
  const typeMap = { daily: 'ежедн.', weekly: 'нед.', shift: 'сменный', custom: 'произв.' };
  const parts = [typeMap[p.type] || p.type];
  if (p.workDays != null) parts.push(`${p.workDays}р/${p.restDays ?? 0}в`);
  if (p.weekdays?.length) parts.push(`дни: ${p.weekdays.join(',')}`);
  if (p.evenOdd) parts.push(p.evenOdd === 'even' ? 'чёт. нед.' : 'нечёт. нед.');
  return parts.join(' · ');
}

function formatValue(v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
  if (typeof v === 'string' && VALUE_LABELS[v]) return VALUE_LABELS[v];
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (v && typeof v === 'object') {
    if ('type' in v && (v.workDays != null || v.weekdays != null || v.evenOdd != null)) {
      return formatSchedulePattern(v);
    }
    return JSON.stringify(v);
  }
  return String(v);
}

/** Render a single array field change (added / removed / modified items) */
function buildArrayRows(change, showClinic, prefix, clinicMap = {}) {
  const clinicLabel = clinicMap[change.clinicId] || change.clinicName || (change.clinicId === 'global' ? 'Общие' : change.clinicId ? `Клиника ${change.clinicId}` : null);
  const rows = [];

  for (let j = 0; j < (change.added || []).length; j++) {
    const item = change.added[j];
    rows.push(
      <tr key={`${prefix}-a${j}`}>
        {showClinic && <TD style={{ color: '#6b7280' }}>{clinicLabel || ''}</TD>}
        <TD style={{ fontWeight: 500 }}>{change.label}</TD>
        <TD style={{ color: '#9ca3af' }}>—</TD>
        <TD style={{ background: '#dcfce7', color: '#166534' }}>+ {formatItem(item)}</TD>
      </tr>
    );
  }
  for (let j = 0; j < (change.removed || []).length; j++) {
    const item = change.removed[j];
    rows.push(
      <tr key={`${prefix}-r${j}`}>
        {showClinic && <TD style={{ color: '#6b7280' }}>{clinicLabel || ''}</TD>}
        <TD style={{ fontWeight: 500 }}>{change.label}</TD>
        <TD style={{ background: '#fee2e2', color: '#991b1b' }}>− {formatItem(item)}</TD>
        <TD style={{ color: '#9ca3af' }}>—</TD>
      </tr>
    );
  }
  for (let j = 0; j < (change.modified || []).length; j++) {
    const mod = change.modified[j];
    const subKeys = new Set([...Object.keys(mod.before || {}), ...Object.keys(mod.after || {})]);
    const changedSubs = [...subKeys].filter(k =>
      JSON.stringify((mod.before || {})[k]) !== JSON.stringify((mod.after || {})[k])
    );
    const name = mod.key || formatItem(mod.before);
    const SUB_LABELS = { value: 'значение', valueType: 'тип значения', deductionType: 'тип удержания', normHours: 'нормочасы', locked: 'фиксация', rate: 'Ставка' };
    const beforeDesc = changedSubs.map(k => `${SUB_LABELS[k] || FIELD_LABELS[k] || k}: ${formatValue((mod.before || {})[k])}`).join('; ');
    const afterDesc  = changedSubs.map(k => `${SUB_LABELS[k] || FIELD_LABELS[k] || k}: ${formatValue((mod.after  || {})[k])}`).join('; ');
    rows.push(
      <tr key={`${prefix}-m${j}`}>
        {showClinic && <TD style={{ color: '#6b7280' }}>{clinicLabel || ''}</TD>}
        <TD style={{ fontWeight: 500 }}>✎ {name}</TD>
        <TD style={{ background: beforeDesc ? '#fee2e2' : 'transparent', color: '#991b1b' }}>{beforeDesc || '—'}</TD>
        <TD style={{ background: afterDesc  ? '#dcfce7' : 'transparent', color: '#166534' }}>{afterDesc  || '—'}</TD>
      </tr>
    );
  }

  return rows;
}

function DiffViewer({ diff, clinicMap = {} }) {
  if (!diff) return null;

  // Executor-style changes array (per-clinic per-field)
  if (Array.isArray(diff.changes) && diff.changes.length > 0) {
    const showClinic = diff.changes.some(c => c.clinicId !== undefined);

    const rows = [];
    for (let i = 0; i < diff.changes.length; i++) {
      const c = diff.changes[i];

      if (c.type === 'array') {
        // Item-level diff
        rows.push(...buildArrayRows(c, showClinic, `c${i}`, clinicMap));
      } else {
        // Scalar diff (нормы часов, поля настроек)
        const rawLabel = c.label || c.field || c.profession || c.role || c.serviceCode || c.category || c.categoryName || String(i);
        const label = FIELD_LABELS[rawLabel] || rawLabel;
        const clinicLabel = clinicMap[c.clinicId] || c.clinicName || (c.clinicId === 'global' ? 'Общие' : c.clinicId ? `Клиника ${c.clinicId}` : null);
        rows.push(
          <tr key={i}>
            {showClinic && <TD style={{ color: '#6b7280' }}>{clinicLabel || ''}</TD>}
            <TD style={{ fontWeight: 500 }}>{label}</TD>
            <TD style={{ background: c.before != null ? '#fee2e2' : 'transparent', color: '#991b1b' }}>
              {formatValue(c.before)}
            </TD>
            <TD style={{ background: c.after != null ? '#dcfce7' : 'transparent', color: '#166534' }}>
              {formatValue(c.after)}
            </TD>
          </tr>
        );
      }
    }

    if (rows.length === 0) return null;
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            {showClinic && <th style={{ padding: '3px 8px', fontSize: 11, textAlign: 'left', color: '#6b7280', minWidth: 100 }}>Клиника</th>}
            <th style={{ padding: '3px 8px', fontSize: 11, textAlign: 'left', color: '#6b7280' }}>Поле / раздел</th>
            <th style={{ padding: '3px 8px', fontSize: 11, textAlign: 'left', color: '#991b1b', width: '35%' }}>До</th>
            <th style={{ padding: '3px 8px', fontSize: 11, textAlign: 'left', color: '#166534', width: '35%' }}>После</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    );
  }

  // Generic before/after object diff
  const hasBefore = diff.before != null && typeof diff.before === 'object';
  const hasAfter  = diff.after  != null && typeof diff.after  === 'object';
  if (!hasBefore && !hasAfter) return null;

  const allKeys = new Set([...Object.keys(diff.before || {}), ...Object.keys(diff.after || {})]);
  const rows = [...allKeys].filter(k =>
    JSON.stringify((diff.before || {})[k]) !== JSON.stringify((diff.after || {})[k])
  );
  if (rows.length === 0) return null;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
      <thead>
        <tr style={{ background: '#f9fafb' }}>
          <th style={{ padding: '3px 8px', fontSize: 11, textAlign: 'left', color: '#6b7280' }}>Поле</th>
          <th style={{ padding: '3px 8px', fontSize: 11, textAlign: 'left', color: '#991b1b', width: '40%' }}>До</th>
          <th style={{ padding: '3px 8px', fontSize: 11, textAlign: 'left', color: '#166534', width: '40%' }}>После</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(key => (
          <tr key={key}>
            <TD style={{ fontWeight: 500 }}>{FIELD_LABELS[key] || key}</TD>
            <TD style={{ background: '#fee2e2', color: '#991b1b' }}>{formatValue((diff.before || {})[key])}</TD>
            <TD style={{ background: '#dcfce7', color: '#166534' }}>{formatValue((diff.after  || {})[key])}</TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AdminJournal() {
  const [activeTab, setActiveTab] = useState('pages');

  // === PAGES TAB STATE ===
  const [pageList, setPageList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    contentType: '', dateFrom: '', dateTo: '', folderId: '', createdBy: '', isPublished: ''
  });
  const [authorList, setAuthorList] = useState([]);
  const [folderList, setFolderList] = useState([]);
  const [historyPage, setHistoryPage] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);


  // === ЗАРПЛАТА TAB STATE ===
  const [rbLogs, setRbLogs] = useState([]);
  const [rbLoading, setRbLoading] = useState(false);
  const [rbTotal, setRbTotal] = useState(0);
  const [rbTabs, setRbTabs] = useState([]);
  const [rbUsers, setRbUsers] = useState([]);
  const [rbFilters, setRbFilters] = useState({ tab: '', userId: '', misUserId: '', doctorName: '', dateFrom: '', dateTo: '' });
  const [rbPage, setRbPage] = useState(1);
  const [rbPerPage] = useState(100);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [clinicMap, setClinicMap] = useState({});
  const [selectedEntry, setSelectedEntry] = useState(null);

  // === INITIAL LOAD ===
  useEffect(() => {
    loadPageAuthors();
    loadFolders();
    loadRbMeta();
    mis.getClinics()
      .then(res => {
        if (res.data?.success && Array.isArray(res.data?.data)) {
          const map = {};
          res.data.data.forEach(c => { map[String(c.id)] = c.name; });
          setClinicMap(map);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'pages') loadJournal();
  }, [filters, currentPage, searchQuery, activeTab]);


  useEffect(() => {
    if (activeTab === 'salary') loadRbLogs();
  }, [rbFilters, rbPage, activeTab]);

  const loadPageAuthors = async () => {
    try {
      const { data } = await journal.pageAuthors();
      setAuthorList(data);
    } catch (error) {
      console.error('Error loading page authors:', error);
    }
  };

  const loadFolders = async () => {
    try {
      const { data } = await folders.tree();
      setFolderList(data);
    } catch (error) {
      console.error('Error loading folders:', error);
    }
  };


  const loadRbMeta = async () => {
    try {
      const [tabsRes, usersRes] = await Promise.all([rbActivityLog.tabs(), rbActivityLog.users()]);
      setRbTabs(tabsRes.data);
      setRbUsers(usersRes.data);
    } catch (err) {
      console.error('Error loading rb meta:', err);
    }
  };

  const loadJournal = async () => {
    setLoading(true);
    try {
      const params = { search: searchQuery, ...filters, limit: itemsPerPage, offset: (currentPage - 1) * itemsPerPage };
      Object.keys(params).forEach(key => { if (params[key] === '') delete params[key]; });
      const { data } = await journal.list(params);
      setPageList(data.rows);
      setTotalCount(data.count);
    } catch (error) {
      toast.error('Ошибка загрузки журнала');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };


  const loadRbLogs = async () => {
    setRbLoading(true);
    try {
      const params = { ...rbFilters, limit: rbPerPage, offset: (rbPage - 1) * rbPerPage };
      Object.keys(params).forEach(k => { if (!params[k]) delete params[k]; });
      const { data } = await rbActivityLog.list(params);
      setRbLogs(data.rows);
      setRbTotal(data.count);
    } catch (err) {
      toast.error('Ошибка загрузки журнала зарплаты');
      console.error(err);
    } finally {
      setRbLoading(false);
    }
  };

  // === HANDLERS ===
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilters({ contentType: '', dateFrom: '', dateTo: '', folderId: '', createdBy: '', isPublished: '' });
    setCurrentPage(1);
  };


  const handleRbFilterChange = (key, value) => {
    setRbFilters(prev => ({ ...prev, [key]: value }));
    setRbPage(1);
  };

  const handleClearRbFilters = () => {
    setRbFilters({ tab: '', userId: '', misUserId: '', doctorName: '', dateFrom: '', dateTo: '' });
    setRbPage(1);
  };

  const handleSelectRbEntry = async (entry) => {
    if (selectedEntry?.id === entry.id) {
      setSelectedEntry(null);
      return;
    }

    // Совместимость при поэтапном деплое: старый backend уже отдаёт diff в списке.
    if (Object.prototype.hasOwnProperty.call(entry, 'diff')) {
      setSelectedEntry(entry);
      return;
    }

    setSelectedEntry({ ...entry, detailLoading: true });
    try {
      const { data } = await rbActivityLog.get(entry.id);
      // Не перезатираем drawer, если пока шёл запрос открыли другую запись.
      setSelectedEntry(current => current?.id === entry.id ? data : current);
    } catch (err) {
      toast.error('Ошибка загрузки деталей записи');
      console.error(err);
      setSelectedEntry(current => current?.id === entry.id ? null : current);
    }
  };

  const toggleRow = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadPdf = async (pageId, pageTitle) => {
    try {
      const response = await pages.exportHistoryPdf(pageId);
      const url = `${process.env.REACT_APP_API_URL || 'http://localhost:9001'}/${response.data.filePath}`;
      const link = document.createElement('a');
      link.href = url;
      link.download = `История изменений - ${pageTitle}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('PDF отчет создан');
    } catch (error) {
      toast.error('Ошибка создания PDF');
      console.error(error);
    }
  };

  // === HELPERS ===
  const getPageTypeIcon = (contentType) => {
    switch (contentType) {
      case 'spreadsheet': return <TableIcon size={16} style={{ color: '#16a34a' }} />;
      case 'html': return <FileCode size={16} style={{ color: '#f97316' }} />;
      default: return <FileText size={16} style={{ color: '#3b82f6' }} />;
    }
  };

  const totalPages   = Math.ceil(totalCount / itemsPerPage);
  const rbTotalPages = Math.ceil(rbTotal / rbPerPage);

  const tabStyle = (name) => ({
    padding: '8px 18px', border: 'none', cursor: 'pointer', background: 'none', fontWeight: 500,
    fontSize: 14, color: activeTab === name ? '#2563eb' : '#6b7280',
    borderBottom: activeTab === name ? '2px solid #2563eb' : '2px solid transparent',
    marginBottom: -1
  });

  // === RENDER ===
  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Журнал изменений</h1>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
        <button onClick={() => setActiveTab('pages')} style={tabStyle('pages')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={15} />Страницы Wiki
          </span>
        </button>

        <button onClick={() => setActiveTab('salary')} style={tabStyle('salary')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <DollarSign size={15} />Зарплата
          </span>
        </button>
      </div>

      {/* ── PAGES TAB ── */}
      {activeTab === 'pages' && (
        <>
          <div className="admin-toolbar">
            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                placeholder="Поиск по названию..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="admin-filters-panel">
            <div className="admin-filters-row">
              <div className="form-group">
                <label className="form-label"><FileText size={14} />Тип страницы</label>
                <select className="form-control" value={filters.contentType} onChange={(e) => handleFilterChange('contentType', e.target.value)}>
                  <option value="">Все типы</option>
                  <option value="wysiwyg">Документ</option>
                  <option value="html">HTML</option>
                  <option value="spreadsheet">Таблица</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><Folder size={14} />Папка</label>
                <select className="form-control" value={filters.folderId} onChange={(e) => handleFilterChange('folderId', e.target.value)}>
                  <option value="">Все папки</option>
                  <option value="null">Корневая папка</option>
                  {folderList.map(folder => (
                    <option key={folder.id} value={folder.id}>{folder.title}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />Изменено с</label>
                <input type="date" className="form-control" value={filters.dateFrom} onChange={(e) => handleFilterChange('dateFrom', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />Изменено до</label>
                <input type="date" className="form-control" value={filters.dateTo} onChange={(e) => handleFilterChange('dateTo', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><User size={14} />Автор</label>
                <select className="form-control" value={filters.createdBy} onChange={(e) => handleFilterChange('createdBy', e.target.value)}>
                  <option value="">Все авторы</option>
                  {authorList.map(user => (
                    <option key={user.id} value={user.id}>{user.displayName || user.username}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Статус</label>
                <select className="form-control" value={filters.isPublished} onChange={(e) => handleFilterChange('isPublished', e.target.value)}>
                  <option value="">Все статусы</option>
                  <option value="true">Опубликовано</option>
                  <option value="false">Черновик</option>
                </select>
              </div>
              <button className="btn btn-secondary filter-reset-btn" onClick={handleClearFilters}>
                <X size={16} />Сбросить
              </button>
            </div>
          </div>

          <div className="admin-table-container">
            {loading ? (
              <div className="admin-loading"><div className="loading-spinner" /><p>Загрузка журнала...</p></div>
            ) : pageList.length === 0 ? (
              <div className="admin-empty-state"><FileText size={48} /><p>Страницы не найдены</p></div>
            ) : (
              <>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Название</th>
                      <th>Путь (папка)</th>
                      <th>Автор</th>
                      <th>Последнее изменение</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageList.map(page => (
                      <tr key={page.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {getPageTypeIcon(page.contentType)}
                            <a href={`/page/${page.slug}`} target="_blank" rel="noopener noreferrer" className="page-title-link">
                              {page.title}
                            </a>
                          </div>
                        </td>
                        <td><span className="folder-path">{page.folderPath || '(Корневая папка)'}</span></td>
                        <td>{page.author?.id ? <Link to={`/users/${page.author.id}`} className="user-profile-link">{page.author.displayName || page.author.username}</Link> : (page.author?.displayName || page.author?.username || '—')}</td>
                        <td>
                          <div className="date-cell"><Calendar size={14} />{formatDate(page.updatedAt)}</div>
                        </td>
                        <td>
                          <span className={`status-badge ${page.isPublished ? 'published' : 'draft'}`}>
                            {page.isPublished ? 'Опубликовано' : 'Черновик'}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-icon" onClick={() => setHistoryPage({ id: page.id, title: page.title })} title="Просмотреть историю изменений">
                            <History size={16} />
                          </button>
                          <button className="btn btn-icon" onClick={() => handleDownloadPdf(page.id, page.title)} title="Скачать PDF отчет">
                            <Download size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="admin-pagination">
                    <div className="admin-pagination-info">Показано {pageList.length} из {totalCount}</div>
                    <div className="admin-pagination-controls">
                      <button className="btn btn-secondary" disabled={currentPage === 1} onClick={() => setCurrentPage(prev => prev - 1)}>Назад</button>
                      <span className="pagination-page">Страница {currentPage} из {totalPages}</span>
                      <button className="btn btn-secondary" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(prev => prev + 1)}>Вперед</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}


      {/* ── ЗАРПЛАТА TAB ── */}
      {activeTab === 'salary' && (
        <>
          <div className="admin-filters-panel">
            <div className="admin-filters-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">Вкладка</label>
                <select className="form-control" value={rbFilters.tab} onChange={e => handleRbFilterChange('tab', e.target.value)}>
                  <option value="">Все вкладки</option>
                  {rbTabs.map(t => (
                    <option key={t.tab} value={t.tab}>{t.label} ({t.count})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><User size={14} />Пользователь</label>
                <select className="form-control" value={rbFilters.userId} onChange={e => handleRbFilterChange('userId', e.target.value)}>
                  <option value="">Все пользователи</option>
                  {rbUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Сотрудник</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Поиск по имени..."
                  value={rbFilters.doctorName}
                  onChange={e => handleRbFilterChange('doctorName', e.target.value)}
                  style={{ minWidth: 160 }}
                />
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />С даты</label>
                <input type="date" className="form-control" value={rbFilters.dateFrom} onChange={e => handleRbFilterChange('dateFrom', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />По дату</label>
                <input type="date" className="form-control" value={rbFilters.dateTo} onChange={e => handleRbFilterChange('dateTo', e.target.value)} />
              </div>
              <button className="btn btn-secondary filter-reset-btn" onClick={handleClearRbFilters}>
                <X size={16} />Сбросить
              </button>
            </div>
          </div>

          <div className="admin-table-container">
            {rbLoading ? (
              <div className="admin-loading"><div className="loading-spinner" /><p>Загрузка...</p></div>
            ) : rbLogs.length === 0 ? (
              <div className="admin-empty-state"><DollarSign size={48} /><p>Записей не найдено</p></div>
            ) : (
              <>
                {/* ── Event list ── */}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'stretch', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {[
                      { label: 'Время',        w: 140 },
                      { label: 'Пользователь', w: 130 },
                      { label: 'Раздел',       w: 110 },
                      { label: 'Описание',     w: null },
                    ].map(({ label, w }, i, arr) => (
                      <span key={label} style={{
                        ...(w ? { width: w, flexShrink: 0 } : { flex: 1 }),
                        padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, color: '#9ca3af',
                        textTransform: 'uppercase', letterSpacing: '.04em',
                        borderRight: i < arr.length - 1 ? '1px solid #e5e7eb' : 'none',
                      }}>{label}</span>
                    ))}
                  </div>

                  {/* Rows */}
                  {rbLogs.map((entry, idx) => {
                    const isSelected = selectedEntry?.id === entry.id;
                    return (
                      <div
                        key={entry.id}
                        onClick={() => handleSelectRbEntry(entry)}
                        style={{
                          display: 'flex', alignItems: 'stretch', cursor: 'pointer',
                          borderBottom: idx < rbLogs.length - 1 ? '1px solid #e5e7eb' : 'none',
                          borderLeft: `3px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
                          background: isSelected ? '#eff6ff' : '#fff',
                          transition: 'background .1s',
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f9fafb'; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff'; }}
                      >
                        {/* Time */}
                        <div style={{ width: 140, flexShrink: 0, padding: '10px 12px', borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#111827', lineHeight: 1.3 }}>
                            {formatRelativeTime(entry.created_at || entry.createdAt)}
                          </span>
                        </div>

                        {/* User */}
                        <div style={{ width: 130, flexShrink: 0, padding: '10px 12px', borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                          <span style={{ fontSize: 12, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {abbreviateName(entry.user?.displayName || entry.user?.username || '')}
                          </span>
                        </div>

                        {/* Tab label */}
                        <div style={{ width: 110, flexShrink: 0, padding: '10px 12px', borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                          <span style={{ fontSize: 13, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {entry.tabLabel}
                          </span>
                        </div>

                        {/* Description + chevron */}
                        <div style={{ flex: 1, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <div style={{ flex: 1, fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {entry.summary}
                          </div>
                          <ChevronRight size={14} style={{ color: isSelected ? '#3b82f6' : '#d1d5db', flexShrink: 0 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {rbTotalPages > 1 && (
                  <div className="admin-pagination">
                    <div className="admin-pagination-info">Показано {rbLogs.length} из {rbTotal}</div>
                    <div className="admin-pagination-controls">
                      <button className="btn btn-secondary" disabled={rbPage === 1} onClick={() => setRbPage(prev => prev - 1)}>Назад</button>
                      <span className="pagination-page">Страница {rbPage} из {rbTotalPages}</span>
                      <button className="btn btn-secondary" disabled={rbPage >= rbTotalPages} onClick={() => setRbPage(prev => prev + 1)}>Вперед</button>
                    </div>
                  </div>
                )}

                {/* ── Detail drawer ── */}
                {selectedEntry && (
                  <>
                    <div
                      onClick={() => setSelectedEntry(null)}
                      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 400 }}
                    />
                    <div style={{
                      position: 'fixed', right: 0, top: 0, bottom: 0, width: 500,
                      background: '#fff', boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
                      zIndex: 401, overflowY: 'auto', display: 'flex', flexDirection: 'column',
                    }}>
                      {/* Drawer header */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px',
                        borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 1,
                      }}>
                        {(() => {
                          const as = ACTION_COLORS[selectedEntry.action] || { bg: '#f3f4f6', color: '#374151' };
                          return (
                            <span style={{ padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600, background: as.bg, color: as.color }}>
                              {ACTION_LABELS_RU[selectedEntry.action] || selectedEntry.action}
                            </span>
                          );
                        })()}
                        <span style={{ padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 500, background: '#eff6ff', color: '#1d4ed8' }}>
                          {selectedEntry.tabLabel}
                        </span>
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={() => setSelectedEntry(null)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 22, lineHeight: 1, padding: '0 4px' }}
                        >×</button>
                      </div>

                      {/* Drawer body */}
                      <div style={{ padding: '20px 24px', flex: 1 }}>

                        {/* Doctor + summary */}
                        {selectedEntry.doctorName && (
                          <div style={{ fontSize: 17, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
                            {selectedEntry.doctorName}
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.5 }}>
                          {selectedEntry.summary}
                        </div>

                        {/* Metadata card */}
                        <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 16px', marginBottom: 24 }}>
                          {[
                            { label: 'Дата и время', value: formatDate(selectedEntry.created_at || selectedEntry.createdAt) },
                            { label: 'Пользователь', value: selectedEntry.user ? (selectedEntry.user.displayName || selectedEntry.user.username) : '—' },
                            { label: 'Раздел',       value: selectedEntry.tabLabel },
                            ...(selectedEntry.clinicId ? [{ label: 'Клиника', value: clinicMap[selectedEntry.clinicId] || selectedEntry.clinicId }] : []),
                            ...(selectedEntry.misUserId ? [{ label: 'ID врача', value: selectedEntry.misUserId }] : []),
                          ].map(({ label, value }) => (
                            <div key={label} style={{ display: 'flex', gap: 16, marginBottom: 7, alignItems: 'baseline' }}>
                              <span style={{ fontSize: 12, color: '#9ca3af', width: 110, flexShrink: 0 }}>{label}</span>
                              <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{value}</span>
                            </div>
                          ))}
                        </div>

                        {/* Diff */}
                        {selectedEntry.detailLoading ? (
                          <div style={{ fontSize: 13, color: '#6b7280' }}>Загрузка деталей…</div>
                        ) : selectedEntry.diff ? (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
                              Изменения
                            </div>
                            <DiffViewer diff={selectedEntry.diff} clinicMap={clinicMap} />
                          </>
                        ) : (
                          <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>Детализация недоступна</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {historyPage && (
        <PageHistoryModal
          pageId={historyPage.id}
          onClose={() => setHistoryPage(null)}
        />
      )}
    </div>
  );
}
