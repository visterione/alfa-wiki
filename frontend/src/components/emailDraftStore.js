/**
 * Черновик письма и его версии (ver. 8.43).
 *
 * ── Почему в браузере, а не в базе ───────────────────────────────────────────
 *
 * У несобранного письма нет идентификатора: в базу оно попадает только в
 * момент отправки, до этого его не существует нигде. Чтобы хранить версии на
 * сервере, пришлось бы заводить письму строку заранее — и она засоряла бы
 * историю рассылок черновиками, которые никто не отправлял.
 *
 * Сценарий, ради которого версии и нужны, локальный: «вчера собрал письмо,
 * сегодня всё испортил, верни как было». Это один человек за одним
 * компьютером. Поэтому версии лежат рядом с черновиком, в том же браузере, и
 * честно этим ограничены.
 *
 * ── Когда снимается версия ───────────────────────────────────────────────────
 *
 * Не на каждую правку — иначе список за час заполнится двадцатью снимками
 * одного абзаца. Новая версия появляется, если письмо изменилось и с прошлой
 * прошло не меньше VERSION_INTERVAL. Черновик при этом сохраняется постоянно:
 * он отвечает за «не потерять вообще», версии — за «вернуться к тому, что
 * было».
 */

const DRAFT_KEY = 'alfa-email-draft';
const VERSIONS_KEY = 'alfa-email-versions';

/** Сколько версий держим. Двадцать — это примерно день работы над письмом. */
const MAX_VERSIONS = 20;

/** Минимум между снимками. */
const VERSION_INTERVAL = 3 * 60 * 1000;

/**
 * Чтение из хранилища никогда не должно мешать писать письмо.
 *
 * Запись может не пройти (переполнено, приватный режим), разбор — упасть на
 * испорченной строке. Ни то ни другое не повод показать человеку ошибку вместо
 * редактора.
 */
const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const loadDraft = () => readJson(DRAFT_KEY, null);

export const saveDraft = (snapshot) => writeJson(DRAFT_KEY, { ...snapshot, savedAt: Date.now() });

export const clearDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(VERSIONS_KEY);
  } catch {
    // Не важно: отправленное письмо и так больше не предлагается восстановить.
  }
};

export const loadVersions = () => {
  const list = readJson(VERSIONS_KEY, []);
  return Array.isArray(list) ? list : [];
};

/**
 * Во что превратилось письмо — коротко, для списка версий.
 *
 * Понимает обе версии документа: первая держит блоки списком, вторая —
 * секциями. Без этого версии, снятые до перехода на секции, показывались бы
 * пустыми, и восстанавливать их было бы страшно.
 */
export const describeDesign = (design) => {
  if (!design) return 'готовый HTML';
  const sections = Array.isArray(design.sections) ? design.sections : null;
  if (sections) {
    const blocks = sections.reduce(
      (n, sec) => n + (sec?.columns || []).reduce((m, col) => m + (col?.blocks || []).length, 0),
      0,
    );
    return `${blocks} ${plural(blocks, 'блок', 'блока', 'блоков')} в ${sections.length} ${plural(sections.length, 'секции', 'секциях', 'секциях')}`;
  }
  const blocks = Array.isArray(design.blocks) ? design.blocks.length : 0;
  return `${blocks} ${plural(blocks, 'блок', 'блока', 'блоков')}`;
};

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Одинаковы ли письма по содержимому. Время и служебные поля не в счёт. */
const sameContent = (a, b) => (
  a?.subject === b?.subject
  && JSON.stringify(a?.design ?? null) === JSON.stringify(b?.design ?? null)
  && (a?.htmlContent || '') === (b?.htmlContent || '')
);

/**
 * Снять версию, если пора.
 *
 * Возвращает новый список версий или null, если снимать не понадобилось, —
 * чтобы вызывающий не перерисовывал панель на каждом сохранении черновика.
 */
export const pushVersion = (snapshot, now = Date.now()) => {
  const versions = loadVersions();
  const last = versions[0];

  if (last && sameContent(last, snapshot)) return null;
  if (last && now - (last.savedAt || 0) < VERSION_INTERVAL) return null;

  const next = [{ ...snapshot, savedAt: now }, ...versions].slice(0, MAX_VERSIONS);
  // Не влезло — выбрасываем самые старые и пробуем снова: потерять хвост
  // истории лучше, чем не сохранить свежую версию.
  let list = next;
  while (list.length && !writeJson(VERSIONS_KEY, list)) list = list.slice(0, list.length - 1);
  return list.length ? list : null;
};

export const VERSION_LIMITS = { MAX_VERSIONS, VERSION_INTERVAL };
