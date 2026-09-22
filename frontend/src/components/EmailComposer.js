import React, { useState, useEffect, useRef } from 'react';
import { X, FileText, Send, Plus, Edit, Trash2, Save, Star, Table2, Clock, History, ArrowLeft, LayoutTemplate, ChevronDown, BadgePercent, Tags, Newspaper, CalendarRange, Gauge } from 'lucide-react';
import toast from 'react-hot-toast';
import EmailBuilder, { createDesign } from './EmailBuilder';
import { PRESETS } from './EmailBuilder/blocks';
import { loadDraft, saveDraft, clearDraft, loadVersions, pushVersion, describeDesign } from './emailDraftStore';
import { email, media } from '../services/api';
import { BASE_URL } from '../services/api';
import './EmailComposer.css';

const moscowDateTimeValue = (date) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).format(date).replace(' ', 'T');
const parseMoscowDateTime = (value) => value ? new Date(`${value}:00+03:00`) : null;

// Дата плана приходит с сервера строкой YYYY-MM-DD по Москве. Разбираем её
// вручную, а не через Date: `new Date('2026-09-22')` — это полночь UTC, и в
// нашем поясе она показалась бы предыдущим днём у половины пользователей.
const DAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function dayParts(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d, date: new Date(y, m - 1, d) };
}

const formatDay = (key) => {
  const p = dayParts(key);
  return p ? `${p.d} ${MONTHS_GEN[p.m - 1]}` : '—';
};

/** «В понедельник 1000» — как заказчик и описывал план. */
const formatWeekday = (key) => {
  const p = dayParts(key);
  return p ? DAY_NAMES[p.date.getDay()] : '';
};

const pluralDays = (n) => {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
};

const nfmt = (n) => Number(n || 0).toLocaleString('ru-RU');

/*
  Иконка заготовки. Раньше у всех четырёх стояли одинаковые «искры», и в списке
  они читались как одна кнопка, продублированная четыре раза. Держим соответствие
  здесь, а не в blocks.js: там описание письма, а не оформление интерфейса.
*/
const PRESET_ICONS = {
  blank: FileText,
  promo: BadgePercent,
  price: Tags,
  news: Newspaper
};

function presetIcon(id) {
  const Icon = PRESET_ICONS[id] || FileText;
  return <Icon size={13} />;
}

const EmailComposer = ({ onClose, initialDraft = null }) => {
  // States
  const [subject, setSubject] = useState(initialDraft?.subject || '');
  const [htmlContent, setHtmlContent] = useState(initialDraft?.htmlContent || '');
  /**
   * Документ конструктора (ver. 8.43).
   *
   * Живёт рядом с htmlContent, а не вместо него: письмо из конструктора хранит и
   * то и другое, а письмо из старого режима — только HTML, и таких в истории
   * большинство.
   *
   * Новое письмо заводит документ сразу, ещё до первой правки. Иначе на каждой
   * перерисовке окна в конструктор уезжал бы свежесозданный документ с новой
   * ссылкой, и предпросмотр пересобирался бы на пустом месте.
   */
  /*
    Состояние объявляется ДО эффектов, которые его читают.
    Массив зависимостей эффекта вычисляется при каждой отрисовке, то есть в теле
    компонента; обращение к константе, объявленной ниже, роняет всё окно с
    «Cannot access before initialization». Порядок здесь — не стиль, а условие
    работоспособности.
  */
  /**
   * Режим составления письма.
   *
   * Остался один — конструктор. Прежние «Визуально» и «HTML» убраны: первый
   * давал разметку, которая разваливается в Outlook, второй означал, что
   * письмо собирают не здесь. Оба были подпоркой на время, пока конструктор не
   * готов; он готов.
   *
   * 'legacy' — не режим правки, а единственный способ открыть письмо, которое
   * пришло из прошлого: у рассылок до этого релиза документа конструктора нет,
   * есть только готовый HTML. Такое письмо показывается как есть и повторяется
   * без изменений — пересобирать чужую вёрстку в блоки мы не умеем и не должны
   * делать вид, что умеем.
   */
  const [editorMode, setEditorMode] = useState(
    !initialDraft?.design && initialDraft?.htmlContent ? 'legacy' : 'builder'
  );

  // Template management
  const [editorKey, setEditorKey] = useState(0);

  const [design, setDesign] = useState(() => (
    initialDraft?.design || (initialDraft?.htmlContent ? null : createDesign())
  ));
  const [recipients, setRecipients] = useState(initialDraft?.recipients || []);
  const [attachments, setAttachments] = useState(initialDraft?.attachments || []);
  const [templates, setTemplates] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [sending, setSending] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  /**
   * План рассылки по дням (ver. 8.57).
   *
   * Список получателей вырос до тысяч, а почтовые службы смотрят не на письмо,
   * а на поведение отправителя: десять тысяч писем за час с одного домена — та
   * самая картина, после которой в спам уходит домен целиком. Поэтому рассылка,
   * не помещающаяся в суточный предел, растягивается по дням, и расклад надо
   * показать ДО нажатия «Отправить», а не сообщить о нём после.
   *
   * Считает план сервер — тем же кодом, что потом и разрезает рассылку. Считать
   * его здесь значило бы завести второй ответ на тот же вопрос.
   */
  const [plan, setPlan] = useState(null);
  // Подтверждение многодневной рассылки: { plan, perDay, total, run }.
  const [planDialog, setPlanDialog] = useState(null);
  const [sendMode, setSendMode] = useState('now');
  const [sendProgress, setSendProgress] = useState(null); // { jobId, sent, failed, total, status }
  const [showTemplates, setShowTemplates] = useState(false);
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateForm, setTemplateForm] = useState({ name: '', subject: '', htmlContent: '', isPublic: true });

  // Favorites
  /**
   * Черновик письма в браузере.
   *
   * Письмо собирается полчаса, а закрывается одним промахом мимо кнопки. До
   * этого вся работа пропадала молча — сохранять было некуда: отправленное
   * письмо попадает в историю, а несобранное не существует нигде.
   *
   * Черновик один и лежит в браузере: это не замена шаблонам, а страховка от
   * случайного закрытия. Поэтому и восстановление предлагается, а не
   * происходит само — человек мог закрыть окно намеренно.
   */
  const [draftOffer, setDraftOffer] = useState(null);

  /**
   * История версий письма.
   *
   * Отмена в конструкторе живёт в текущем сеансе: закрыл вкладку — и вернуться
   * ко вчерашней редакции нельзя. Версии снимаются сами, не чаще раза в
   * несколько минут и только если письмо действительно изменилось, и лежат
   * рядом с черновиком. Подробности — в components/emailDraftStore.js.
   */
  // Узел слота лежит в состоянии, а не в ref: ref не вызывает повторную
  // отрисовку, и портал конструктора остался бы пустым до следующей.
  const [toolbarSlot, setToolbarSlot] = useState(null);
  const [sendMenu, setSendMenu] = useState(false);
  const sendMenuRef = useRef(null);
  const templatesRef = useRef(null);

  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [versionPreview, setVersionPreview] = useState(null);
  // Версия письма из конструктора хранит документ, а не HTML: показать её
  // можно только собрав на сервере той же функцией, что и само письмо.
  const [versionHtml, setVersionHtml] = useState({ loading: false, html: '' });

  const [favoriteRecipients, setFavoriteRecipients] = useState([]); // [{id, email, displayName}]
  const [favoriteTemplateIds, setFavoriteTemplateIds] = useState([]); // [templateId, ...]


  const excelInputRef = useRef(null);
  const recipientPickerRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const [importingExcel, setImportingExcel] = useState(false);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!sendMenu && !showTemplates) return undefined;
    const outside = (e) => {
      if (sendMenu && sendMenuRef.current && !sendMenuRef.current.contains(e.target)) setSendMenu(false);
      if (showTemplates && templatesRef.current && !templatesRef.current.contains(e.target)) setShowTemplates(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [sendMenu, showTemplates]);

  // Предложить восстановление — только для нового письма. Повтор рассылки
  // открывается с готовым содержимым, и подменять его чужим черновиком нельзя.
  useEffect(() => {
    setVersions(loadVersions());
    if (initialDraft) return;
    const saved = loadDraft();
    const hasBlocks = saved?.design?.sections?.length || saved?.design?.blocks?.length || saved?.htmlContent;
    if (hasBlocks) setDraftOffer(saved);
  }, [initialDraft]);

  // Сохраняем с задержкой: письмо правится посимвольно, и писать в хранилище
  // на каждую букву незачем.
  useEffect(() => {
    if (sendProgress) return undefined;
    const timer = setTimeout(() => {
      const snapshot = { subject, design, htmlContent, editorMode, recipients };
      saveDraft(snapshot);
      // Версия снимается из того же обработчика, но по своим правилам: не
      // чаще раза в несколько минут и только если письмо изменилось.
      const next = pushVersion(snapshot);
      if (next) setVersions(next);
    }, 1200);
    return () => clearTimeout(timer);
  }, [subject, design, htmlContent, editorMode, recipients, sendProgress]);

  const restoreDraft = () => {
    const saved = draftOffer;
    setDraftOffer(null);
    if (!saved) return;
    setSubject(saved.subject || '');
    if (saved.design) setDesign(saved.design);
    if (saved.htmlContent) setHtmlContent(saved.htmlContent);
    if (saved.editorMode) setEditorMode(saved.editorMode);
    if (Array.isArray(saved.recipients)) setRecipients(saved.recipients);
    setEditorKey(k => k + 1);
    toast.success('Черновик восстановлен');
  };

  const dropDraft = () => {
    setDraftOffer(null);
    clearDraft();
    setVersions([]);
  };

  /**
   * Вернуться к версии.
   *
   * Перед восстановлением текущее состояние уходит в историю принудительно:
   * восстановление само по себе должно быть обратимым, иначе один неверный
   * клик по списку стирает час работы — ровно то, от чего версии и защищают.
   */
  useEffect(() => {
    if (versionPreview === null) { setVersionHtml({ loading: false, html: '' }); return undefined; }
    const version = versions[versionPreview];
    if (!version) return undefined;

    if (!version.design) {
      setVersionHtml({ loading: false, html: version.htmlContent || '' });
      return undefined;
    }

    let cancelled = false;
    setVersionHtml({ loading: true, html: '' });
    (async () => {
      try {
        const { data } = await email.preview({ design: version.design, subject: version.subject || '' });
        if (!cancelled) setVersionHtml({ loading: false, html: data.html });
      } catch {
        if (!cancelled) setVersionHtml({ loading: false, html: '' });
      }
    })();
    return () => { cancelled = true; };
  }, [versionPreview, versions]);

  const restoreVersion = (version) => {
    const forced = pushVersion({ subject, design, htmlContent, editorMode, recipients }, Date.now());
    setSubject(version.subject || '');
    setDesign(version.design || null);
    setHtmlContent(version.htmlContent || '');
    if (version.editorMode) setEditorMode(version.editorMode);
    setEditorKey(k => k + 1);
    setVersions(forced || loadVersions());
    setShowVersions(false);
    setVersionPreview(null);
    toast.success('Версия восстановлена');
  };

  // Close recipient picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (recipientPickerRef.current && !recipientPickerRef.current.contains(event.target)) {
        setShowRecipientPicker(false);
      }
    };

    if (showRecipientPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showRecipientPicker]);

  const loadData = async () => {
    try {
      const [templatesRes, usersRes, rolesRes, favRecipientsRes, favTemplatesRes] = await Promise.all([
        email.getTemplates(),
        email.getUsers(),
        email.getRoles(),
        email.getFavoriteRecipients(),
        email.getFavoriteTemplates()
      ]);

      setTemplates(templatesRes.data);
      setAllUsers(usersRes.data);
      setRoles(rolesRes.data);
      setFavoriteRecipients(favRecipientsRes.data);
      setFavoriteTemplateIds(favTemplatesRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Ошибка загрузки данных');
    }
  };

  const applyTemplate = (template) => {
    setSubject(template.subject);
    setHtmlContent(template.htmlContent);
    // Шаблон, собранный конструктором, открывается в конструкторе; старый —
    // в том режиме, в каком его сохранили. Иначе повторное применение шаблона
    // молча превращало бы вёрстку в неправимый HTML.
    if (template.design) {
      setDesign(template.design);
      setEditorMode('builder');
    } else {
      setEditorMode(editorMode === 'builder' ? 'html' : editorMode);
    }
    setEditorKey(prev => prev + 1);
    setShowTemplates(false);
    toast.success('Шаблон применен');
  };

  /**
   * Применить заготовку.
   *
   * Заменяет письмо целиком, поэтому спрашивает — но только если в нём уже
   * что-то есть. Подтверждение на пустом холсте это лишний клик на ровном месте.
   */
  const applyPreset = (preset) => {
    const blocks = (design?.sections || []).reduce(
      (n, sec) => n + (sec?.columns || []).reduce((m, col) => m + (col?.blocks || []).length, 0),
      0,
    );
    if (blocks > 3 && !window.confirm(`Заменить содержимое письма заготовкой «${preset.name}»? Текущее письмо будет потеряно.`)) return;
    setDesign(preset.build());
    setEditorKey(k => k + 1);
    setShowTemplates(false);
    toast.success(`Заготовка «${preset.name}» применена`);
  };

  /**
   * Сохранить текущее письмо как шаблон.
   *
   * Отдельная кнопка рядом с конструктором: заводить шаблон через отдельный
   * редактор в менеджере шаблонов — значит собирать письмо дважды.
   */
  const saveCurrentAsTemplate = async () => {
    const name = window.prompt('Название шаблона', subject || '');
    if (name === null) return;
    if (!name.trim()) return toast.error('Название обязательно');
    if (!subject.trim()) return toast.error('Сначала заполните тему письма');
    try {
      await email.createTemplate({
        name: name.trim(),
        subject,
        isPublic: true,
        ...(editorMode === 'builder' ? { design } : { htmlContent }),
      });
      toast.success('Шаблон сохранён');
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить шаблон');
    }
  };

  const openTemplateManager = (template = null) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateForm({
        name: template.name,
        subject: template.subject,
        htmlContent: template.htmlContent,
        // Документ переносится в форму нетронутым. Менеджер шаблонов правит
        // только название, тему и HTML, но сохранять он будет форму целиком —
        // без этой строки правка названия у шаблона из конструктора стёрла бы
        // его документ, и шаблон перестал бы открываться в конструкторе.
        design: template.design || null,
        isPublic: template.isPublic
      });
    } else {
      setEditingTemplate(null);
      setTemplateForm({ name: '', subject: '', htmlContent: '', design: null, isPublic: true });
    }
    setShowTemplateManager(true);
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.subject.trim()) {
      toast.error('Заполните название и тему шаблона');
      return;
    }

    try {
      if (editingTemplate) {
        await email.updateTemplate(editingTemplate.id, templateForm);
        toast.success('Шаблон обновлен');
      } else {
        await email.createTemplate(templateForm);
        toast.success('Шаблон создан');
      }
      setShowTemplateManager(false);
      loadData();
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Ошибка сохранения шаблона');
    }
  };

  const deleteTemplate = async (templateId) => {
    if (!window.confirm('Удалить этот шаблон?')) return;

    try {
      await email.deleteTemplate(templateId);
      toast.success('Шаблон удален');
      loadData();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Ошибка удаления шаблона');
    }
  };

  const toggleFavoriteTemplate = async (templateId, e) => {
    e.stopPropagation();
    try {
      const { data } = await email.toggleFavoriteTemplate(templateId);
      if (data.favorited) {
        setFavoriteTemplateIds(prev => [...prev, templateId]);
      } else {
        setFavoriteTemplateIds(prev => prev.filter(id => id !== templateId));
      }
    } catch (error) {
      console.error('Error toggling favorite template:', error);
      toast.error('Ошибка обновления избранного');
    }
  };

  // Recipient management
  const addRecipient = (recipientData) => {
    // recipientData: { email, displayName, userId? }
    if (recipients.find(r => r.email === recipientData.email)) {
      return; // Already added
    }

    setRecipients(prev => [...prev, {
      userId: recipientData.userId || null,
      email: recipientData.email,
      displayName: recipientData.displayName || recipientData.email
    }]);
  };

  const addUserRecipient = (user) => {
    addRecipient({
      userId: user.id,
      email: user.email,
      displayName: user.displayName || user.username
    });
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Parse and add one or multiple emails from the search field (supports comma-separated list)
  const addEmailsFromQuery = (raw) => {
    const parts = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    const valid = parts.filter(e => emailRegex.test(e));
    const invalid = parts.filter(e => !emailRegex.test(e));

    valid.forEach(e => addRecipient({ email: e, displayName: e }));

    if (valid.length > 0) setUserSearchQuery('');
    if (invalid.length > 0 && parts.length > 1) {
      toast.error(`Некорректные адреса: ${invalid.join(', ')}`);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowRecipientPicker(false);
      return;
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = userSearchQuery.trim().replace(/,$/, '');
      if (val) addEmailsFromQuery(val);
    }
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    // Auto-parse when user pastes comma-separated list
    if (val.includes(',') || val.includes(';')) {
      addEmailsFromQuery(val);
    } else {
      setUserSearchQuery(val);
    }
  };

  const removeRecipient = (recipientEmail) => {
    setRecipients(recipients.filter(r => r.email !== recipientEmail));
  };

  const toggleRoleFilter = async (roleId) => {
    if (selectedRoles.includes(roleId)) {
      setSelectedRoles(selectedRoles.filter(r => r !== roleId));
    } else {
      setSelectedRoles([...selectedRoles, roleId]);

      try {
        const res = await email.getUsersByRole(roleId);
        const newRecipients = res.data
          .filter(u => !recipients.find(r => r.email === u.email))
          .map(u => ({
            userId: u.id,
            email: u.email,
            displayName: u.displayName || u.username
          }));

        setRecipients(prev => [...prev, ...newRecipients]);

        if (newRecipients.length > 0) {
          toast.success(`Добавлено ${newRecipients.length} получателей`);
        }
      } catch (error) {
        console.error('Error loading role users:', error);
        toast.error('Ошибка загрузки пользователей по роли');
      }
    }
  };

  // Favorite recipients
  const addFavoriteRecipient = async (recipientEmail, displayName) => {
    try {
      const { data } = await email.addFavoriteRecipient({ email: recipientEmail, displayName });
      setFavoriteRecipients(prev => {
        if (prev.find(f => f.email === recipientEmail)) return prev;
        return [...prev, data];
      });
      toast.success('Добавлено в избранное');
    } catch (error) {
      console.error('Error adding favorite recipient:', error);
      toast.error('Ошибка добавления в избранное');
    }
  };

  const removeFavoriteRecipient = async (favId, e) => {
    e.stopPropagation();
    try {
      await email.removeFavoriteRecipient(favId);
      setFavoriteRecipients(prev => prev.filter(f => f.id !== favId));
    } catch (error) {
      console.error('Error removing favorite recipient:', error);
      toast.error('Ошибка удаления из избранного');
    }
  };

  const isRecipientFavorite = (recipientEmail) => {
    return favoriteRecipients.some(f => f.email === recipientEmail);
  };

  const getFavoriteId = (recipientEmail) => {
    return favoriteRecipients.find(f => f.email === recipientEmail)?.id;
  };

  const toggleFavoriteRecipient = async (recipientEmail, displayName, e) => {
    e.stopPropagation();
    const favId = getFavoriteId(recipientEmail);
    if (favId) {
      await removeFavoriteRecipient(favId, e);
    } else {
      await addFavoriteRecipient(recipientEmail, displayName);
    }
  };

  // Excel import
  const handleExcelImport = async (e) => {
    const file = e.target.files?.[0];
    if (!excelInputRef.current) return;
    excelInputRef.current.value = '';
    if (!file) return;

    setImportingExcel(true);
    try {
      const { data } = await email.parseExcel(file);
      // Новый разбор возвращает готовых получателей с именем и медцентром;
      // старое поле emails оставлено на случай файла без заголовков.
      const parsed = Array.isArray(data.recipients) && data.recipients.length
        ? data.recipients
        : (data.emails || []).map(addr => ({ email: addr, displayName: addr }));

      if (!parsed.length) {
        toast.error('Email-адреса в файле не найдены');
        return;
      }

      const fresh = parsed.filter(r => !recipients.find(x => x.email === r.email));
      if (fresh.length) {
        setRecipients(prev => [
          ...prev,
          ...fresh.map(r => ({ email: r.email, displayName: r.displayName || r.email, userId: null })),
        ]);
      }

      // Имя из файла в письмо не подставляется — персонализацию убрали. Оно
      // нужно только здесь, в списке получателей: выбирать из сотни строк
      // «Иванов Иван» проще, чем из сотни почтовых адресов.
      toast.success(
        `Добавлено ${fresh.length} из ${parsed.length} адресов`
        + (data.withNames ? ` (с именем — ${data.withNames})` : ''),
      );
    } catch (error) {
      console.error('Error importing Excel:', error);
      toast.error('Ошибка разбора файла');
    } finally {
      setImportingExcel(false);
    }
  };

  /*
    Прикрепление файлов убрано из интерфейса по просьбе заказчика: картинки
    письма живут в конструкторе, а вложения в рекламной рассылке — редкий гость,
    который к тому же тянет вес каждой копии письма.

    Само поле attachments осталось: повтор старой рассылки должен уйти с теми же
    файлами, с какими ушёл в первый раз. Просто добавить новые больше негде.
  */

  // Polling статуса задачи рассылки
  useEffect(() => {
    if (!sendProgress || sendProgress.status !== 'running') return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const { data } = await email.getJobStatus(sendProgress.jobId);
        setSendProgress(prev => ({ ...prev, ...data }));

        if (data.status !== 'running') {
          clearInterval(pollIntervalRef.current);
          if (data.status === 'done' || data.status === 'partial') {
            toast.success(`✅ Отправлено: ${data.sent} писем`);
            if (data.failed > 0) toast.error(`⚠️ Не доставлено: ${data.failed}`);
            onClose();
          } else {
            toast.error('Ошибка отправки рассылки');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1500);

    return () => clearInterval(pollIntervalRef.current);
  }, [sendProgress?.jobId, sendProgress?.status]);

  // Cleanup при размонтировании
  useEffect(() => {
    return () => clearInterval(pollIntervalRef.current);
  }, []);

  const usingBuilder = editorMode === 'builder';

  const messageIsValid = () => {
    if (!subject.trim()) {
      toast.error('Введите тему письма');
      return false;
    }

    if (recipients.length === 0) {
      toast.error('Выберите получателей');
      return false;
    }

    if (usingBuilder) {
      // Документ бывает двух версий: первая держит блоки списком, вторая —
      // секциями. Пустым считается и то и другое, пока в письме нет ни одного
      // блока: секция без содержимого в письме не видна.
      const sections = design?.sections;
      const hasBlocks = Array.isArray(sections)
        ? sections.some(sec => (sec?.columns || []).some(col => (col?.blocks || []).length))
        : Boolean(design?.blocks?.length);
      if (!hasBlocks) {
        toast.error('Письмо пустое — добавьте хотя бы один блок');
        return false;
      }
      return true;
    }

    if (!htmlContent.trim() || htmlContent === '<p></p>') {
      toast.error('Введите текст письма');
      return false;
    }
    return true;
  };

  /**
   * Что уходит на сервер.
   *
   * Из конструктора едет документ, из старых режимов — HTML. Отправлять и то и
   * другое разом нельзя: сервер тогда не знает, что считать правдой, а письмо
   * в истории разойдётся с тем, что ушло людям.
   */
  const messagePayload = () => (usingBuilder
    ? { subject, design, recipients, attachments }
    : { subject, htmlContent, recipients, attachments });

  /**
   * Замечания к письму перед отправкой.
   *
   * Считает их сервер тем же проходом, которым собирает письмо, — иначе
   * проверки разойдутся с разметкой при первом же новом блоке. Ничего не
   * запрещают: человек видит список и решает сам. Запрет на отправку письма,
   * которое «кажется неправильным», кончается тем, что его отправляют в обход.
   */
  const [pendingSend, setPendingSend] = useState(null); // { warnings, run }

  const withWarnings = async (run) => {
    // Проверка обязательного идёт первой: иначе письмо без темы сначала
    // получило бы окно с замечаниями к вёрстке, а про тему узнало бы после.
    if (!messageIsValid()) return undefined;
    if (!usingBuilder) return run();
    try {
      const { data } = await email.preview({ design, subject });
      if (data.warnings?.length) {
        setPendingSend({ warnings: data.warnings, run });
        return undefined;
      }
    } catch {
      // Не смогли проверить — это не повод не отправлять. Само письмо
      // соберётся на сервере тем же кодом, и если он падает, отправка сообщит
      // об этом понятнее, чем предпросмотр.
    }
    return run();
  };

  /**
   * План пересчитывается при каждой правке списка и даты начала.
   *
   * Задержка — не ради экономии запросов: получателей добавляют пачками по
   * роли и файлом, и считать план на каждом шаге этой пачки значит показывать
   * числа, которые тут же меняются.
   */
  useEffect(() => {
    if (!recipients.length) { setPlan(null); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const startAt = parseMoscowDateTime(scheduledAt);
        const { data } = await email.getPlan({
          count: recipients.length,
          startAt: startAt && !Number.isNaN(startAt.getTime()) ? startAt.toISOString() : undefined,
        });
        if (!cancelled) setPlan(data);
      } catch {
        // Не посчитался — значит про предел просто ничего не скажем. Отправку
        // это не трогает: сервер посчитает его заново и сам, а мешать работе
        // из-за неудавшейся справки нельзя.
        if (!cancelled) setPlan(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [recipients.length, scheduledAt]);

  /**
   * Отправка, которая может упереться в суточный предел.
   *
   * Сервер на такую рассылку отвечает 409 и планом: это не ошибка, а вопрос
   * «растянуть на столько-то дней?». Получив согласие, повторяем тот же запрос
   * с acceptPlan — и рассылка расходится порциями по дням.
   */
  const sendWithPlan = async (payload, onDone) => {
    try {
      return await onDone(await email.send(payload));
    } catch (error) {
      const data = error.response?.data;
      if (error.response?.status === 409 && data?.needsPlan) {
        setPlanDialog({
          plan: data.plan,
          perDay: data.perDay,
          total: data.total,
          run: async () => {
            setPlanDialog(null);
            setSending(true);
            try {
              await onDone(await email.send({ ...payload, acceptPlan: true }));
            } catch (retryError) {
              toast.error(retryError.response?.data?.error || 'Не удалось запустить рассылку');
            } finally {
              setSending(false);
            }
          },
        });
        return undefined;
      }
      throw error;
    }
  };

  /** «Рассылка разложена по дням» — один и тот же итог у обоих способов. */
  const reportSplit = (data) => {
    const days = data.parts?.length || 0;
    const last = data.parts?.[days - 1]?.date;
    toast.success(
      `Рассылка на ${data.total} писем разложена по дням: ${days} ${pluralDays(days)}`
      + (last ? `, последняя порция ${formatDay(last)}` : ''),
      { duration: 7000 },
    );
    clearDraft();
    onClose();
  };

  // Send email
  const handleSend = () => withWarnings(async () => {
    if (!messageIsValid()) return;

    setPendingSend(null);
    setSending(true);
    try {
      await sendWithPlan(messagePayload(), (({ data }) => {
        // Рассылка не поместилась в сутки и разложена по дням: немедленной
        // отправки не было, показывать полосу хода нечему.
        if (data.split) return reportSplit(data);
        // Письмо ушло — ни черновик, ни его версии больше не нужны и не должны
        // всплывать в следующий раз как «несохранённая работа».
        clearDraft();
        // Сервер вернул jobId сразу, отправка идёт в фоне
        setSendProgress({ jobId: data.jobId, sent: 0, failed: 0, total: data.total, status: 'running' });
        return undefined;
      }));
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error(error.response?.data?.error || 'Ошибка запуска рассылки');
    } finally {
      setSending(false);
    }
  });

  const handleSchedule = () => withWarnings(async () => {
    if (!messageIsValid()) return;
    const when = parseMoscowDateTime(scheduledAt);
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error('Выберите будущую дату и время');
      return;
    }
    setPendingSend(null);
    setSending(true);
    try {
      await sendWithPlan(
        { ...messagePayload(), scheduledAt: when.toISOString() },
        (({ data }) => {
          if (data.split) return reportSplit(data);
          clearDraft();
          toast.success(`Почтовая рассылка запланирована на ${scheduledAt.slice(0, 10)} ${scheduledAt.slice(11)} МСК`);
          onClose();
          return undefined;
        }),
      );
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось запланировать рассылку');
    } finally {
      setSending(false);
    }
  });

  /**
   * План рассылки в меню отправки.
   *
   * Стоит прямо над кнопкой, а не в настройках раздела: суточный предел важен
   * ровно в ту секунду, когда человек собирается нажать «Отправить». Пока
   * список помещается в сутки, план — одна успокаивающая строка; как только не
   * помещается, разворачивается расклад по дням, ради которого всё и делалось.
   */
  const planDays = plan?.plan || [];
  const planSplit = planDays.length > 1;

  const planTable = (rows) => (
    <ol className="email-plan-days">
      {rows.map((row) => (
        <li key={row.date}>
          <span className="email-plan-when">
            {formatDay(row.date)}
            <i>{formatWeekday(row.date)}</i>
          </span>
          <b>{nfmt(row.count)}</b>
          {row.used > 0 && (
            <span className="email-plan-used" title="В этот день уже занято другими рассылками">
              занято {nfmt(row.used)} из {nfmt(row.limit)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );

  const planSummary = !plan ? null : (
    <div className={`email-plan${planSplit ? ' split' : ''}`}>
      <div className="email-plan-head">
        {planSplit ? <CalendarRange size={14} /> : <Gauge size={14} />}
        <span>
          {!plan.perDay
            ? `${nfmt(plan.total)} писем · суточный предел снят`
            : planSplit
              ? `${nfmt(plan.total)} писем не уместятся в сутки — уйдут за ${planDays.length} ${pluralDays(planDays.length)}`
              : `${nfmt(plan.total)} писем · в пределе ${nfmt(plan.perDay)} в сутки`}
        </span>
      </div>
      {planSplit && planTable(planDays)}
      {planSplit && (
        <p className="email-plan-note">
          Дробим не из осторожности ради осторожности: почтовые службы судят по
          поведению отправителя, и залп в несколько тысяч писем с одного домена
          роняет в спам весь домен, а не одно письмо. Порции уйдут сами, в то же
          время суток; отменить можно всю рассылку целиком — в истории.
        </p>
      )}
    </div>
  );

  // Filter users by search - show favorites first, then rest
  const filteredUsers = allUsers.filter(user => {
    const searchLower = userSearchQuery.toLowerCase();
    return (
      (user.displayName && user.displayName.toLowerCase().includes(searchLower)) ||
      user.username.toLowerCase().includes(searchLower) ||
      (user.email && user.email.toLowerCase().includes(searchLower))
    );
  });

  // Favorites that don't appear in allUsers (external addresses)
  const filteredFavoriteRecipients = favoriteRecipients.filter(fav => {
    if (!userSearchQuery) return true;
    const q = userSearchQuery.toLowerCase();
    return fav.email.toLowerCase().includes(q) || (fav.displayName && fav.displayName.toLowerCase().includes(q));
  });

  // External favorites (not in allUsers)
  const externalFavorites = filteredFavoriteRecipients.filter(
    fav => !allUsers.find(u => u.email === fav.email)
  );

  // Sort allUsers: favorites first
  const sortedUsers = [
    ...filteredUsers.filter(u => isRecipientFavorite(u.email)),
    ...filteredUsers.filter(u => !isRecipientFavorite(u.email))
  ];

  // Sort templates: favorites first
  const sortedTemplates = [
    ...templates.filter(t => favoriteTemplateIds.includes(t.id)),
    ...templates.filter(t => !favoriteTemplateIds.includes(t.id))
  ];

  // Helpers


  return (
    /*
      Письмо собирается в рабочей области модуля, а не в модальном окне.
     
      Конструктору нужно место: холст письма сам по себе 600px, а рядом должны
      уместиться палитра и панель свойств. Модальное окно такого размера
      перестаёт быть окном — оно перекрывает шапку и меню и выбивается из
      остального портала. Поэтому составление письма занимает содержимое
      вкладки целиком, как редактор страницы и проводник, а возврат к списку —
      обычная кнопка «Назад».
     
      Высоту даёт правило .content-wrapper:has(.email-composer) в Layout.css —
      тем же приёмом, что у редактора кода.
    */
    <section className="email-composer">
      {/*
        Одна строка инструментов на всё окно. Раньше их было две — своя у
        конструктора и своя у отправки, — и нужное приходилось искать в двух
        местах, а высоты холсту не хватало. Кнопки конструктора приезжают сюда
        порталом через toolbarSlot.
      */}
      <div className="email-toolbar">
        <button className="btn btn-ghost" onClick={onClose}>
          <ArrowLeft size={16} /> Назад
        </button>

        <div className="email-toolbar-builder" ref={setToolbarSlot} />

        <div className="email-toolbar-right">
          <div className="email-templates-dropdown" ref={templatesRef}>
            {/*
              Кнопки панели — иконками. Слов в строке инструментов набралось
              столько, что до кнопки «Отправить» приходилось читать всю полосу;
              иконка узнаётся быстрее, а что она делает, говорит подсказка.
            */}
            <button
              className={`btn btn-ghost btn-icon-only ${showTemplates ? 'active' : ''}`}
              onClick={() => setShowTemplates(v => !v)}
              title="Шаблоны и заготовки писем"
              aria-label="Шаблоны и заготовки писем"
            >
              <LayoutTemplate size={16} />
            </button>
              {showTemplates && (
                <div className="email-templates-list">
                  {/*
                    Заготовки и шаблоны в одном списке. Раньше это были две
                    кнопки в разных панелях — «Макеты» у конструктора и
                    «Шаблоны» у отправки, — делавшие одно и то же: начать письмо
                    не с чистого листа. Разница только в происхождении: заготовки
                    зашиты в код, шаблоны сохраняют сами и хранят в базе.
                  */}
                  <div className="email-templates-header">Заготовки</div>
                  <div className="email-presets-row">
                    {PRESETS.map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        className="email-preset"
                        onClick={() => applyPreset(preset)}
                      >
                        {presetIcon(preset.id)}
                        <b>{preset.name}</b>
                        <small>{preset.hint}</small>
                      </button>
                    ))}
                  </div>

                  <div className="email-templates-header">
                    Сохранённые
                    <button className="btn-icon-sm" onClick={saveCurrentAsTemplate} title="Сохранить текущее письмо как шаблон">
                      <Save size={14} />
                    </button>
                  </div>
                  {sortedTemplates.length === 0 ? null : (
                    sortedTemplates.map(template => {
                      const isFavTemplate = favoriteTemplateIds.includes(template.id);
                      return (
                        <div key={template.id} className="email-template-item-wrapper">
                          <div
                            className="email-template-item"
                            onClick={() => applyTemplate(template)}
                          >
                            {/*
                              Миниатюра — это само письмо, уменьшенное в iframe,
                              а не картинка. Рисовать снимок на сервере значит
                              держать там headless-браузер ради превью размером
                              в спичечный коробок; уменьшенный iframe показывает
                              ровно тот HTML, который лежит в шаблоне, и всегда
                              совпадает с ним.

                              sandbox пустой: внутри чужая разметка, и ни
                              скриптам, ни формам там делать нечего.
                            */}
                            {template.htmlContent && (
                              <div className="email-template-thumb" aria-hidden="true">
                                <iframe
                                  title={template.name}
                                  srcDoc={template.htmlContent}
                                  sandbox=""
                                  scrolling="no"
                                  tabIndex={-1}
                                />
                              </div>
                            )}
                            <div className="email-template-name">
                              {isFavTemplate && <Star size={11} style={{ color: 'var(--amber-500)', marginRight: 4, flexShrink: 0 }} />}
                              {template.name}
                              {template.design && <span className="email-template-badge">конструктор</span>}
                            </div>
                            <div className="email-template-subject">{template.subject}</div>
                          </div>
                          <div className="email-template-actions">
                            <button
                              className={`btn-icon-sm ${isFavTemplate ? 'email-star-btn active' : 'email-star-btn'}`}
                              onClick={(e) => toggleFavoriteTemplate(template.id, e)}
                              title={isFavTemplate ? 'Убрать из избранного' : 'В избранное'}
                            >
                              <Star size={13} />
                            </button>
                            <button
                              className="btn-icon-sm"
                              onClick={(e) => { e.stopPropagation(); openTemplateManager(template); }}
                              title="Редактировать"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              className="btn-icon-sm"
                              onClick={(e) => { e.stopPropagation(); deleteTemplate(template.id); }}
                              title="Удалить"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
          </div>
          {versions.length > 0 && (
            <button
              className="btn btn-ghost btn-icon-only"
              onClick={() => setShowVersions(true)}
              title={`Версии письма · ${versions.length}`}
              aria-label={`Версии письма, всего ${versions.length}`}
            >
              <History size={16} />
            </button>
          )}
          <div className="email-send" ref={sendMenuRef}>
            <button className="btn btn-primary" onClick={() => setSendMenu(v => !v)} disabled={sending}>
              <Send size={16} /> {sending ? 'Запуск…' : 'Отправить'}
              <ChevronDown size={14} />
            </button>
            {sendMenu && (
              <div className="email-send-menu">
                {planSummary}
                <button className="email-send-now" onClick={() => { setSendMenu(false); handleSend(); }}>
                  <Send size={15} /> {plan?.plan?.length > 1 ? 'Начать рассылку' : 'Отправить сейчас'}
                </button>
                <div className="email-send-later">
                  <label>
                    <Clock size={14} /> Отложить до
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      min={moscowDateTimeValue(new Date(Date.now() + 60000))}
                      onChange={e => setScheduledAt(e.target.value)}
                    />
                    <span>МСК</span>
                  </label>
                  <button
                    className="btn btn-primary"
                    disabled={!scheduledAt || sending}
                    onClick={() => { setSendMenu(false); handleSchedule(); }}
                  >
                    Запланировать
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

        {draftOffer && (
          <div className="email-draft-bar">
            <FileText size={14} />
            <span>
              Осталось незаконченное письмо
              {draftOffer.subject ? <> — «{draftOffer.subject}»</> : null}
              {draftOffer.savedAt ? `, ${new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(draftOffer.savedAt))}` : ''}
            </span>
            <button className="btn btn-primary" onClick={restoreDraft}>Восстановить</button>
            <button className="btn btn-ghost" onClick={dropDraft}>Удалить</button>
          </div>
        )}

      <div className="email-composer-body">
          {/* To: Recipients */}
          <div className="email-field-row" style={{ position: 'relative' }} ref={recipientPickerRef}>
            <div className="email-field-label">Кому:</div>
            <div className="email-field-content">
              <div className="email-recipients-chips">
                {recipients.map(r => {
                  const isFav = isRecipientFavorite(r.email);
                  return (
                    <div key={r.email} className="email-recipient-chip">
                      <button
                        className={`chip-star-btn ${isFav ? 'active' : ''}`}
                        onClick={(e) => toggleFavoriteRecipient(r.email, r.displayName, e)}
                        title={isFav ? 'Убрать из избранного' : 'Добавить в избранное'}
                      >
                        <Star size={11} />
                      </button>
                      {r.displayName}
                      <button onClick={() => removeRecipient(r.email)}>
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
                <button
                  className="btn-add-recipients"
                  onClick={() => setShowRecipientPicker(!showRecipientPicker)}
                >
                  + Добавить получателей
                </button>
              </div>

              {/* Recipient Picker Dropdown */}
              {showRecipientPicker && (
                <div className="email-recipient-picker">
                  <div className="email-recipient-picker-header">
                    <input
                      type="text"
                      className="email-recipient-search"
                      placeholder="Поиск, email или список через запятую..."
                      value={userSearchQuery}
                      onChange={handleSearchChange}
                      onKeyDown={handleSearchKeyDown}
                      autoFocus
                    />
                    <button
                      className="btn-icon-sm"
                      style={{ marginTop: '6px', flexShrink: 0 }}
                      onClick={() => excelInputRef.current?.click()}
                      disabled={importingExcel}
                      title="Импорт из Excel"
                    >
                      {importingExcel ? '...' : <Table2 size={15} />}
                    </button>
                    <input
                      ref={excelInputRef}
                      type="file"
                      hidden
                      accept=".xlsx,.xls,.csv"
                      onChange={handleExcelImport}
                    />
                    <button
                      className="btn-icon-sm"
                      style={{ marginTop: '6px', marginLeft: 'auto', display: 'flex' }}
                      onClick={() => setShowRecipientPicker(false)}
                      title="Закрыть"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  {/* Role Filters */}
                  {roles.length > 0 && (
                    <div className="email-role-filters">
                      {roles.map(role => (
                        <div key={role.id} className="email-role-filter-item">
                          <input
                            type="checkbox"
                            id={`role-${role.id}`}
                            checked={selectedRoles.includes(role.id)}
                            onChange={() => toggleRoleFilter(role.id)}
                          />
                          <label htmlFor={`role-${role.id}`}>{role.name}</label>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* External favorites (not in user list) */}
                  {externalFavorites.length > 0 && (
                    <>
                      <div className="email-picker-section-label">Избранные адреса</div>
                      {externalFavorites.map(fav => (
                        <div
                          key={fav.id}
                          className="email-user-item"
                          onClick={() => addRecipient({ email: fav.email, displayName: fav.displayName })}
                        >
                          <div className="email-user-name">
                            <Star size={12} style={{ color: 'var(--amber-500)', marginRight: 4, flexShrink: 0 }} />
                            {fav.displayName || fav.email}
                          </div>
                          <div className="email-user-actions">
                            <div className="email-user-email">{fav.email}</div>
                            <button
                              className="btn-icon-sm email-star-btn active"
                              onClick={(e) => removeFavoriteRecipient(fav.id, e)}
                              title="Убрать из избранного"
                            >
                              <Star size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {sortedUsers.length > 0 && <div className="email-picker-section-label">Пользователи системы</div>}
                    </>
                  )}

                  {/* Users List */}
                  <div className="email-users-list">
                    {sortedUsers.length === 0 && externalFavorites.length === 0 ? (
                      <div style={{ padding: '12px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {userSearchQuery
                          ? emailRegex.test(userSearchQuery.trim())
                            ? <span>Нажмите <strong>Enter</strong>, чтобы добавить «{userSearchQuery.trim()}»</span>
                            : 'Пользователи не найдены'
                          : 'Начните вводить имя или email'
                        }
                      </div>
                    ) : (
                      sortedUsers.map(user => {
                        const isFav = isRecipientFavorite(user.email);
                        return (
                          <div
                            key={user.id}
                            className="email-user-item"
                            onClick={() => addUserRecipient(user)}
                          >
                            <div className="email-user-name">
                              {isFav && <Star size={12} style={{ color: 'var(--amber-500)', marginRight: 4, flexShrink: 0 }} />}
                              {user.displayName || user.username}
                            </div>
                            <div className="email-user-actions">
                              <div className="email-user-email">{user.email}</div>
                              <button
                                className={`btn-icon-sm email-star-btn ${isFav ? 'active' : ''}`}
                                onClick={(e) => toggleFavoriteRecipient(user.email, user.displayName || user.username, e)}
                                title={isFav ? 'Убрать из избранного' : 'Добавить в избранное'}
                              >
                                <Star size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Subject */}
          <div className="email-field-row">
            <div className="email-field-label">Тема:</div>
            <div className="email-field-content">
              <input
                type="text"
                className="email-field-input"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Введите тему письма"
              />
            </div>
          </div>

          <div className="email-editor-container">
            {editorMode === 'legacy' ? (
              /*
                Письмо из прошлого: показываем ровно то, что уйдёт людям, и не
                притворяемся, что его можно править. Изменить в нём что-то
                можно единственным честным способом — собрать заново в
                конструкторе.
              */
              <div className="email-legacy">
                <div className="email-legacy-bar">
                  <FileText size={14} />
                  <span>Письмо свёрстано до конструктора — открыто только для повтора</span>
                  <button className="btn btn-ghost" onClick={() => { setDesign(createDesign()); setEditorMode('builder'); }}>
                    Собрать заново
                  </button>
                </div>
                <iframe title="Письмо" sandbox="" srcDoc={htmlContent} />
              </div>
            ) : (
              <EmailBuilder
                value={design}
                onChange={setDesign}
                subject={subject}
                toolbarSlot={toolbarSlot}
              />
            )}
          </div>
        </div>

      {/*
        Ход отправки. Полосой под инструментами, а не в нижней панели: панели
        больше нет, а следить за отправкой на тысячу адресов человек будет
        минуту-другую, и полоса должна быть на виду.
      */}
      {sendProgress && (
        <div className="email-progress-bar-row">
          <div className="email-progress-label">
            {sendProgress.status === 'running'
              ? `Отправлено ${sendProgress.sent} из ${sendProgress.total}…`
              : `Готово: ${sendProgress.sent} из ${sendProgress.total}`}
            {sendProgress.failed > 0 && `, ошибок: ${sendProgress.failed}`}
            {/* Отписавшихся отсеивает отправка, а не набор списка, поэтому
                сказать о них можно только здесь. Молчать нельзя: иначе
                «отправлено 95» вместо выбранных ста выглядит сбоем. */}
            {sendProgress.skipped > 0 && `, отписаны: ${sendProgress.skipped}`}
          </div>
          <div className="email-progress-bar">
            <div
              className="email-progress-fill"
              style={{ width: `${sendProgress.total > 0 ? ((sendProgress.sent + sendProgress.failed) / sendProgress.total) * 100 : 0}%` }}
            />
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            {sendProgress.status === 'running' ? 'Закрыть (отправка продолжится)' : 'Закрыть'}
          </button>
        </div>
      )}

      {/*
        Замечания к письму. Показываются один раз, перед самой отправкой, и
        ничего не запрещают: человек видит список и решает сам. Отдельное окно,
        а не строка в углу, — потому что после нажатия «Отправить» внимание уже
        на кнопке, и уведомление сбоку читать некому.
      */}
      {pendingSend && (
        <div className="modal-overlay email-dialog" style={{ zIndex: 10002 }} onClick={() => setPendingSend(null)}>
          <div className="modal email-warn-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Проверьте письмо</h2>
              <button className="modal-close" onClick={() => setPendingSend(null)}><X size={20} /></button>
            </div>
            <div className="email-warn-body">
              <ul>
                {pendingSend.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <p className="email-warn-note">Ничего из этого не мешает отправить письмо — но исправить проще сейчас, чем объяснять потом.</p>
            </div>
            <div className="email-warn-actions">
              <button className="btn btn-ghost" onClick={() => setPendingSend(null)}>Вернуться к письму</button>
              <button className="btn btn-primary" onClick={() => { const run = pendingSend.run; setPendingSend(null); run(); }}>
                Всё равно отправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        Подтверждение многодневной рассылки.

        Отдельным окном, потому что решение здесь не косметическое: человек
        соглашается на то, что письма будут уходить ещё неделю, и последние
        получатели прочтут его тогда, когда акция уже может закончиться. Это
        надо увидеть до нажатия, а не после.
      */}
      {planDialog && (
        <div className="modal-overlay email-dialog" style={{ zIndex: 10002 }} onClick={() => setPlanDialog(null)}>
          <div className="modal email-plan-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Рассылка растянется на {planDialog.plan.length} {pluralDays(planDialog.plan.length)}</h2>
              <button className="modal-close" onClick={() => setPlanDialog(null)}><X size={20} /></button>
            </div>
            <div className="email-plan-body">
              <p>
                Получателей {nfmt(planDialog.total)}, а суточный предел —{' '}
                {nfmt(planDialog.perDay)} писем. Рассылка уйдёт порциями:
              </p>
              {planTable(planDialog.plan)}
              <p className="email-warn-note">
                Каждая порция станет отдельной строкой в истории, уйдёт сама и в
                то же время суток. Отменить можно всю рассылку целиком, пока
                порции ещё не ушли. Последние получатели увидят письмо{' '}
                {formatDay(planDialog.plan[planDialog.plan.length - 1].date)} — если
                письмо про акцию, проверьте, что она к этому дню не кончится.
              </p>
            </div>
            <div className="email-warn-actions">
              <button className="btn btn-ghost" onClick={() => setPlanDialog(null)}>Вернуться к письму</button>
              <button className="btn btn-primary" onClick={planDialog.run}>
                Разложить по дням и запустить
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        История версий. Отдельным окном, а не панелью сбоку: к ней обращаются
        редко и всегда с одной мыслью — «верни как было», а места ей нужно
        столько, чтобы письмо было видно целиком.
      */}
      {showVersions && (
        <div className="modal-overlay email-dialog" style={{ zIndex: 10002 }} onClick={() => { setShowVersions(false); setVersionPreview(null); }}>
          <div className="modal email-versions-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Версии письма</h2>
              <button className="modal-close" onClick={() => { setShowVersions(false); setVersionPreview(null); }}><X size={20} /></button>
            </div>
            <div className="email-versions-body">
              <div className="email-versions-list">
                {versions.map((version, i) => (
                  <button
                    key={version.savedAt || i}
                    type="button"
                    className={`email-version ${versionPreview === i ? 'active' : ''}`}
                    onClick={() => setVersionPreview(i)}
                  >
                    <b>
                      {i === 0 ? 'Сейчас в работе' : new Intl.DateTimeFormat('ru-RU', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      }).format(new Date(version.savedAt))}
                    </b>
                    <span>{version.subject || 'без темы'}</span>
                    <small>{describeDesign(version.design)}</small>
                  </button>
                ))}
              </div>
              <div className="email-versions-preview">
                {versionPreview === null ? (
                  <p className="email-versions-hint">
                    Выберите версию слева, чтобы посмотреть, каким письмо было тогда.
                    Версии снимаются сами, пока вы работаете, и хранятся в этом браузере.
                  </p>
                ) : (
                  <>
                    {versionHtml.loading
                      ? <p className="email-versions-hint">Собираем письмо этой версии…</p>
                      : <iframe title="Версия письма" sandbox="" srcDoc={versionHtml.html || '<p style="font-family:sans-serif;padding:24px;color:#8E8E93">Эта версия пустая.</p>'} />}
                    <div className="email-versions-actions">
                      <button className="btn btn-ghost" onClick={() => setVersionPreview(null)}>Назад к списку</button>
                      <button className="btn btn-primary" onClick={() => restoreVersion(versions[versionPreview])}>
                        Восстановить эту версию
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Manager Modal */}
      {showTemplateManager && (
        <div className="modal-overlay email-dialog" onClick={() => setShowTemplateManager(false)} style={{ zIndex: 10001 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>{editingTemplate ? 'Редактировать шаблон' : 'Новый шаблон'}</h2>
              <button className="modal-close" onClick={() => setShowTemplateManager(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Template Name */}
              <div className="email-field-row">
                <div className="email-field-label">Название:</div>
                <div className="email-field-content">
                  <input
                    type="text"
                    className="email-field-input"
                    value={templateForm.name}
                    onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })}
                    placeholder="Приветственное письмо"
                  />
                </div>
              </div>

              {/* Subject */}
              <div className="email-field-row">
                <div className="email-field-label">Тема:</div>
                <div className="email-field-content">
                  <input
                    type="text"
                    className="email-field-input"
                    value={templateForm.subject}
                    onChange={e => setTemplateForm({ ...templateForm, subject: e.target.value })}
                    placeholder="Введите тему письма"
                  />
                </div>
              </div>

              {/*
                Вёрстка шаблона здесь не правится — только название и тема.
                Шаблон из конструктора меняют, применив его к письму и сохранив
                заново; шаблон из прошлого правится ровно так же. Держать
                отдельный редактор ради этого незачем: он и был тем самым
                архаичным путём, от которого мы ушли.
              */}
              <div className="email-template-shot">
                <iframe title="Шаблон" sandbox="" srcDoc={templateForm.htmlContent || ''} />
              </div>

              {/* Public Template Checkbox */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={templateForm.isPublic}
                    onChange={e => setTemplateForm({ ...templateForm, isPublic: e.target.checked })}
                  />
                  Публичный шаблон (доступен всем пользователям)
                </label>
              </div>
            </div>

            <div className="email-compose-footer">
              <div className="email-footer-actions"></div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost" onClick={() => setShowTemplateManager(false)}>
                  Отмена
                </button>
                <button className="btn btn-primary" onClick={saveTemplate}>
                  <Save size={16} /> {editingTemplate ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default EmailComposer;
