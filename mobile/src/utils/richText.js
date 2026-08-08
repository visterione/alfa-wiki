/**
 * Разметка текста сообщений — набор и правила как в Telegram.
 *
 *   *жирный*  или  **жирный**
 *   _курсив_
 *   __подчёркнутый__
 *   ~зачёркнутый~  или  ~~зачёркнутый~~
 *   ||спойлер||
 *   `моноширинный`
 *   ```блок кода```
 *   [подпись](https://…)  и  [подпись](/внутренний/путь)
 *   https://…             — «голая» ссылка
 *   \*  \_  \~  \|  \`  \[  — экранирование, символ выводится как есть
 *
 * Разметка вложенная: *жирный с _курсивом_ внутри* работает. Внутри `кода` и
 * ```блока``` не работает ничего — там текст показывается буквально.
 *
 * ВАЖНО: разбор продублирован из frontend/src/utils/richText.js (там же живёт
 * сборка HTML, которая телефону не нужна). Правила обязаны совпадать символ в
 * символ, иначе одно и то же сообщение выглядит в браузере и на телефоне
 * по-разному. Меняете здесь — меняйте и там.
 */

// Буква/цифра/подчёркивание, в том числе кириллица. Нужна, чтобы разметка не
// срабатывала внутри слова: snake_case и «2 * 3» должны остаться текстом
const WORD = /[0-9A-Za-zА-Яа-яЁё_]/;

// Символы, которые можно экранировать обратным слэшем. Всё остальное после
// слэша остаётся как есть — иначе пути вида C:\Users теряли бы разделители
const ESCAPABLE = '*_~|`[\\';

/**
 * Маркеры. Порядок важен: длинный проверяется раньше короткого, иначе
 * __подчёркнутый__ разберётся как два пустых курсива подряд.
 *
 *   raw   — содержимое не разбирается дальше (код)
 *   block — маркер не обязан прилипать к слову и может охватывать несколько строк
 */
const MARKS = [
  {d: '```', mark: 'pre', raw: true, block: true},
  {d: '**', mark: 'bold'},
  {d: '~~', mark: 'strike'},
  {d: '||', mark: 'spoiler'},
  {d: '__', mark: 'underline'},
  {d: '`', mark: 'code', raw: true},
  {d: '*', mark: 'bold'},
  {d: '_', mark: 'italic'},
  {d: '~', mark: 'strike'},
];

// Ссылка с подписью и «голая» ссылка. Оба выражения липкие (y): проверяем
// совпадение ровно с текущей позиции разбора, а не где-то дальше по строке
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/y;
const BARE_URL_RE = /https?:\/\/[^\s<]+/y;

/**
 * Ищет закрывающий маркер для открытого в openIdx.
 *
 * @returns {number} индекс закрывающего маркера или -1, если пары нет
 */
function findClose(text, from, rule, openIdx) {
  if (!rule.block) {
    // Маркер внутри слова разметкой не считается: some_var_name — это имя,
    // а не курсив. И сразу за маркером не может стоять пробел: «2 * 3 * 4»
    const before = text[openIdx - 1];
    if (before && WORD.test(before)) return -1;
    if (!text[from] || /\s/.test(text[from])) return -1;
  }

  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\' && ESCAPABLE.includes(text[j + 1])) {
      j++;
      continue;
    }
    if (!rule.block && text[j] === '\n') return -1;
    if (!text.startsWith(rule.d, j)) continue;
    if (j === from) continue; // пустое содержимое разметкой не считаем

    if (!rule.block) {
      if (/\s/.test(text[j - 1])) continue;
      const after = text[j + rule.d.length];
      if (after && WORD.test(after)) continue;
    }
    return j;
  }
  return -1;
}

/**
 * @typedef {Object} RichSegment
 * @property {string}  text
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [underline]
 * @property {boolean} [strike]
 * @property {boolean} [spoiler]
 * @property {boolean} [code]
 * @property {boolean} [pre]
 * @property {string}  [url]      адрес ссылки, если отрезок — часть ссылки
 * @property {boolean} [internal] ссылка ведёт внутрь вики (начинается с «/»)
 */

/**
 * Разбирает текст в плоский список отрезков с набором признаков на каждом.
 *
 * @param {string} text
 * @param {Object} [base] признаки, унаследованные от внешней разметки
 * @returns {RichSegment[]}
 */
export function parseRich(text, base = {}) {
  if (!text) return [];

  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push({...base, text: buf});
      buf = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '\\' && ESCAPABLE.includes(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Ссылка с подписью — раньше маркеров: скобки не должны растащить URL
    LINK_RE.lastIndex = i;
    const link = LINK_RE.exec(text);
    if (link) {
      // Конец совпадения запоминаем до рекурсии: разбор подписи снова войдёт
      // в это же выражение и собьёт lastIndex
      const next = LINK_RE.lastIndex;
      flush();
      // Внутри подписи разметка работает: [*жирная ссылка*](…)
      out.push(...parseRich(link[1], {...base, url: link[2], internal: link[2].startsWith('/')}));
      i = next;
      continue;
    }

    if (!base.url && ch === 'h') {
      BARE_URL_RE.lastIndex = i;
      const bare = BARE_URL_RE.exec(text);
      if (bare) {
        flush();
        out.push({...base, text: bare[0], url: bare[0]});
        i += bare[0].length;
        continue;
      }
    }

    // Повторно тот же признак не открываем: он уже действует, а рекурсия
    // на том же маркере зациклилась бы
    const rule = MARKS.find(r => text.startsWith(r.d, i) && !base[r.mark]);
    if (rule) {
      const close = findClose(text, i + rule.d.length, rule, i);
      if (close !== -1) {
        flush();
        const inner = text.slice(i + rule.d.length, close);
        if (rule.raw) {
          // ```\nкод\n``` — переводы строки сразу за маркерами часть оформления,
          // а не кода: иначе блок начинается и кончается пустой строкой
          out.push({...base, text: rule.block ? inner.replace(/^\n|\n$/g, '') : inner, [rule.mark]: true});
        } else {
          out.push(...parseRich(inner, {...base, [rule.mark]: true}));
        }
        i = close + rule.d.length;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return out;
}

/**
 * Текст без разметки — для превью в списке чатов, баннера ответа и уведомлений:
 * там форматирования нет, а звёздочки и круглые скобки с URL превращают строку
 * в мусор.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripFormatting(text) {
  return parseRich(text).map(s => s.text).join('');
}

/**
 * Оборачивает выделенный кусок текста маркерами разметки — для кнопок панели
 * форматирования над полем ввода.
 *
 * Повторное нажатие на уже размеченном куске снимает разметку.
 *
 * @param {string} text      весь текст поля ввода
 * @param {number} start     начало выделения
 * @param {number} end       конец выделения
 * @param {string} delimiter маркер, например '*' или '||'
 * @returns {{text: string, start: number, end: number}} новый текст и выделение в нём
 */
export function toggleMarkup(text, start, end, delimiter) {
  if (start === end) return {text, start, end};

  const selected = text.slice(start, end);
  const len = delimiter.length;

  // Маркеры уже внутри выделения — снимаем их
  if (selected.length > len * 2 && selected.startsWith(delimiter) && selected.endsWith(delimiter)) {
    const stripped = selected.slice(len, -len);
    return {
      text: text.slice(0, start) + stripped + text.slice(end),
      start,
      end: start + stripped.length,
    };
  }

  // Маркеры вокруг выделения — тоже снимаем: выделять их руками неудобно
  if (text.slice(start - len, start) === delimiter && text.slice(end, end + len) === delimiter) {
    return {
      text: text.slice(0, start - len) + selected + text.slice(end + len),
      start: start - len,
      end: end - len,
    };
  }

  return {
    text: text.slice(0, start) + delimiter + selected + delimiter + text.slice(end),
    start: start + len,
    end: end + len,
  };
}
