/**
 * Словарь предметов: что за вещь стоит за строкой ведомости.
 *
 * ── Какой вопрос он решает ───────────────────────────────────────────────────
 *
 * Разбор ведомости отвечает на два независимых вопроса, и до ver. 6.79 на оба
 * отвечало одно число — порог 10 000 ₽:
 *
 *   • ЧТО ЭТО — оборудование, инструмент, мебель, расходник. Отвечает название.
 *   • КАК УЧИТЫВАТЬ — карточкой с инвентарным номером или количеством на полке.
 *     Отвечает цена за единицу.
 *
 * Цена честно отвечает только на второй вопрос. «Ножницы глазные 113 мм» за
 * 522 ₽ и «Одеяло 145*210» за 1350 ₽ по стоимости неразличимы, а это инструмент
 * и мягкий инвентарь — разные категории, разный срок службы, разный порядок
 * списания.
 *
 * ── Почему ведущее слово ─────────────────────────────────────────────────────
 *
 * Первое слово названия в ведомости — почти всегда тип предмета, и слов этих
 * мало: 625 разных на 2992 строки августовской выгрузки. Топ-50 покрывает 51 %
 * строк, топ-200 — 81 %, топ-300 — 88,5 %. Значит человек размечает двести
 * слов, а не три тысячи строк, и результат переживает следующий месяц: словарь
 * не завязан ни на путь по дереву 1С, ни на ключ строки, которые рвутся при
 * первом переименовании группы.
 *
 * ── Порядок правил ───────────────────────────────────────────────────────────
 *
 * regex → head → contains, внутри одного вида выигрывает более длинное
 * выражение.
 *
 * Регулярное выражение стоит ВЫШЕ ведущего слова намеренно, хотя интуиция
 * подсказывает обратное. Его пишут ровно тогда, когда общее правило по слову
 * ошибается на части строк: «электрод» — карточка, но одноразовые электроды
 * расходник. Если бы ведущее слово перекрывало выражение, задать исключение
 * было бы нечем и писать regex было бы незачем.
 *
 * Сам словарь — третье звено разбора: правило по строке → правило ветки →
 * СЛОВАРЬ → порог цены. Явное решение человека всегда сильнее словаря, а порог
 * остаётся последним фолбэком — при пустом словаре разбор работает ровно так
 * же, как до его появления.
 */

const MATCH_WEIGHT = { regex: 3, head: 2, contains: 1 };

/**
 * Название в сравнимый вид: без регистра, без ё и без неразрывных пробелов.
 * 1С отдаёт одно и то же слово и «Шкаф», и «ШКАФ», а «Ёмкость» пишут через обе
 * буквы в пределах одной выгрузки.
 */
function normalize(name) {
  return String(name || '')
    .replace(/[\s ]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/**
 * Ведущее слово названия.
 *
 * Кавычки и скобки в начале срезаются: «"САД-М-МИЗ" стетоскоп» и «Стетоскоп
 * "САД-М-МИЗ"» — один и тот же предмет. Дефис внутри слова сохраняется, потому
 * что он часть типа: «сплит-система» и «система» — разные вещи, а «IP-телефон»
 * без дефиса распадается на бессмысленное «ip».
 */
function headWord(name) {
  const clean = normalize(name).replace(/^[^a-zа-я0-9]+/, '');
  const match = clean.match(/^[a-zа-я0-9]+(?:-[a-zа-я0-9]+)*/);
  return match ? match[0] : '';
}

/**
 * Подготовка правил к прогону: разбор выражений и сортировка по конкретности.
 *
 * Выражения компилируются один раз на весь расчёт, а не на каждую из трёх тысяч
 * строк. Сломанное выражение не роняет разбор: правило выключается, а причина
 * возвращается наверх — иначе одна опечатка в словаре сделала бы недоступной
 * всю ведомость, и понять почему было бы нечем.
 */
function compileRules(rules) {
  const compiled = [];
  const broken = [];

  for (const raw of rules || []) {
    const rule = typeof raw.get === 'function' ? raw.get({ plain: true }) : raw;
    if (rule.isActive === false) continue;

    const matchType = rule.matchType || 'head';
    const pattern = String(rule.pattern || '').trim();
    if (!pattern) continue;

    let test;
    if (matchType === 'regex') {
      try {
        const re = new RegExp(pattern, 'i');
        test = name => re.test(name);
      } catch (err) {
        broken.push({ id: rule.id, pattern, reason: err.message });
        continue;
      }
    } else if (matchType === 'contains') {
      const needle = normalize(pattern);
      test = (name, norm) => norm.includes(needle);
    } else {
      const needle = normalize(pattern);
      test = (name, norm, head) => head === needle;
    }

    compiled.push({ rule, matchType, pattern, test });
  }

  compiled.sort((a, b) => (
    (MATCH_WEIGHT[b.matchType] || 0) - (MATCH_WEIGHT[a.matchType] || 0)
    || b.pattern.length - a.pattern.length
    || String(a.rule.id).localeCompare(String(b.rule.id))
  ));

  return { compiled, broken };
}

/** Первое подошедшее правило или null. Порядок задан в compileRules. */
function classify(name, compiled) {
  if (!compiled?.length) return null;
  const norm = normalize(name);
  const head = headWord(name);
  for (const item of compiled) {
    if (item.test(String(name || ''), norm, head)) return item.rule;
  }
  return null;
}

/**
 * Ведущие слова снимка с тем, насколько они закрыты словарём.
 *
 * Это рабочий список экрана разметки: человек идёт сверху вниз и видит, сколько
 * строк и денег закрывает каждое решение. Сортировка по числу строк, а не по
 * алфавиту, именно поэтому — первые полсотни строк списка закрывают половину
 * ведомости, и это должно быть видно сразу.
 *
 * Слово считается закрытым, если строка подошла ЛЮБОМУ правилу, а не только
 * правилу по ведущему слову: позицию мог закрыть regex-исключение или
 * подстрока, и требовать поверх этого ещё правило по слову значит просить
 * работу, которая ничего не меняет.
 */
function headStats(lines, compiled) {
  const buckets = new Map();

  for (const line of lines || []) {
    const head = headWord(line.name) || '—';
    if (!buckets.has(head)) {
      buckets.set(head, {
        head,
        lines: 0,
        covered: 0,
        units: 0,
        sum: 0,
        samples: [],
        rules: new Map(),
      });
    }

    const bucket = buckets.get(head);
    bucket.lines += 1;
    bucket.units += Number(line.closingQty) || 0;
    bucket.sum += Number(line.closingSum) || 0;
    if (bucket.samples.length < 3) bucket.samples.push(line.name);

    const rule = classify(line.name, compiled);
    if (rule) {
      bucket.covered += 1;
      if (!bucket.rules.has(rule.id)) {
        bucket.rules.set(rule.id, {
          id: rule.id, pattern: rule.pattern, matchType: rule.matchType,
          accounting: rule.accounting, count: 0,
        });
      }
      bucket.rules.get(rule.id).count += 1;
    }
  }

  return [...buckets.values()]
    .map(b => ({ ...b, rules: [...b.rules.values()] }))
    .sort((a, b) => (b.lines - a.lines) || (b.sum - a.sum));
}

module.exports = {
  normalize,
  headWord,
  compileRules,
  classify,
  headStats,
  MATCH_WEIGHT,
};
