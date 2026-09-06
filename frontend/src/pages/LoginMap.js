import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { User } from 'lucide-react';
import { medCenters as medCentersApi } from '../services/api';
import {
  MAP_W, MAP_H, MAP_PAD, ZOOM_NEAR, cameraTransform, project
} from './loginMapGeo';

/**
 * Карта сети на экране входа.
 *
 * Проекция и рамки камеры лежат в loginMapGeo.js. Суффикс не для красоты: файл
 * с именем loginMap.js отличался бы от этого только регистром первой буквы, а
 * на macOS и Windows это один и тот же путь — файлы схлопываются в один, и
 * сборка падает на «does not match the corresponding name on disk».
 *
 * Камера медленно переезжает от филиала к филиалу и останавливается на каждом.
 * Смысл не декоративный: семь филиалов стоят в Анапе в прямоугольнике два на
 * километр, а Сукко — в тринадцати километрах оттуда. Карта, показывающая всю
 * сеть разом, покажет только кучу и одну точку у края; переезд позволяет
 * держать масштаб всегда локальным.
 *
 * Подложка — статический файл, а не разметка: в нём сто килобайт путей из
 * OpenStreetMap, и браузеру дешевле нарисовать его картинкой один раз, чем
 * держать в дереве три тысячи узлов. Метки идут поверх отдельным слоем: они
 * приходят из справочника и меняются вместе с ним.
 */

// Стоянка выросла с 4.2 с ради полосы отзывов внизу карты. Двенадцать секунд —
// полное прочтение всех трёх — оказались слишком долгими для экрана входа;
// восьми хватает, чтобы прочитать одну-две цитаты, а полностью полоса и не
// обязана быть прочитанной: круг идёт по кольцу, филиал вернётся.
const DWELL_MS = 8000;     // сколько стоим на филиале, прежде чем ехать дальше
const FADE_MS = 850;       // через столько после отправления меняем содержимое
const SETTLE_MS = 420;     // столько метка качается, прежде чем показать карточку
const REVEAL_MS = 700;     // столько синее поле сжимается в плашку (--morph-ms)
const FADE_OUT_MS = 900;   // след гаснет перед сбросом на дальней точке
// Сглаживание хода камеры: радиус усреднения в единицах холста и сколько проб
// берётся в каждую сторону. Значения подобраны замером по самому горному
// перегону — дороге на Сукко: средний поворот камеры за кадр падает с 4,4° до
// 1,9°, а девяносто пятая доля — с 18,7° до 4,6°.
//
// Больше радиуса брать смысла нет: тряска дальше не убывает, а камера всё
// сильнее срезает повороты. При этих значениях она отходит от настоящей дороги
// самое большее на полсотни метров — на таком увеличении это незаметно, зато
// серпантин перестаёт швырять кадр.
const CAM_SMOOTH = 130;
const CAM_TAPS = 6;

// Сколько след договаривается после возврата на вкладку. Ходом, а не
// подстановкой нуля: см. onVisible.
const DRAW_TAIL_MS = 1100;
// Скорость камеры в единицах холста за миллисекунду — одна на все перегоны.
// Раньше длительность подбиралась от длины с потолком, и до Сукко камера
// неслась втрое быстрее, чем по городу: перегоны читались рывками.
// Число подбирается на глаз по самому длинному перегону: при 0.21 дорога до
// Сукко занимала десять секунд, и это оказалось утомительно долго.
const SPEED = 0.40;
const RAMP_MS = 650;       // разгон и торможение, одинаковые у любого перегона
const MIN_MS = 900;        // короткий перегон всё равно должен быть заметен

// Капля метки: круглая голова радиусом 30 и остриё в начале координат.
const PIN_PATH = 'M0 0C-13.4 -23-30 -32-30 -47.7A30 30 0 1 1 30 -47.7C30 -32 13.4 -23 0 0Z';
const PIN_HEAD_Y = -47.7;    // центр головы
const PIN_INNER_R = 23.5;    // белый кружок под логотипом
const PIN_LOGO = 41.5;       // сторона логотипа внутри


/**
 * Порядок объезда: с юга на север.
 *
 * Не порядок из справочника: там филиалы отсортированы по значимости, и камера
 * прыгала бы через весь район туда-обратно. По широте выходит один проход
 * снизу вверх, а замыкающий перегон возвращает камеру на юг.
 *
 * Важное следствие: первым оказывается самый южный филиал — сейчас это Сукко, в
 * тринадцати километрах от остальных. Именно на нём стирается след прошлого
 * круга, и остальные метки в этот момент далеко за краем экрана. Сортировка это
 * даёт сама: заведут новый филиал — он встанет по своей широте, и точка сброса
 * останется самой дальней.
 */
function order(points) {
  return [...points].sort((a, b) => a.lat - b.lat);
}

/** Длина ломаной. Отрезки прямые, поэтому сумма их длин — и есть длина пути. */
function polylineLength(line) {
  let sum = 0;
  for (let i = 1; i < line.length; i += 1) {
    sum += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  return sum;
}

/** Ломаная в атрибут d. */
function routeD(line) {
  return line.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «2026-08-27» → «27 августа 2026». Дата приходит строкой DATEONLY. */
function quoteDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.4 6.2 20.4l1.1-6.4L2.6 9.4l6.5-.9z" />
  </svg>
);
const STARS = [0, 1, 2, 3, 4].map(i => <React.Fragment key={i}>{STAR}</React.Fragment>);

/** «176 отзывов» с правильным окончанием. */
function reviewsLabel(n) {
  const count = Number(n) || 0;
  const tail = count % 100;
  if (tail > 10 && tail < 20) return `${count} отзывов`;
  const last = count % 10;
  if (last === 1) return `${count} отзыв`;
  if (last >= 2 && last <= 4) return `${count} отзыва`;
  return `${count} отзывов`;
}

/**
 * Карта сети на экране входа.
 *
 * @param active — открыта ли карта. На первом шаге входа её закрывает синее
 *   поле с лентами (Login.css), и до его схлопывания объезд стоит: иначе к
 *   моменту, когда карту откроют, камера окажется где-нибудь посреди перегона,
 *   а то и на третьем филиале — человек увидит не начало показа, а его
 *   середину.
 */
export default function LoginMap({ active = true }) {
  const [points, setPoints] = useState([]);
  const [at, setAt] = useState(0);
  // Отдельно от at: метка вздрагивает не когда её выбрали, а когда камера до неё
  // доехала. Между этими моментами почти три секунды переезда.
  // Начинаем с -1: первое покачивание играет не при монтировании, а когда поле
  // сойдёт с карты, — см. эффект открытия ниже.
  const [settled, setSettled] = useState(-1);
  const [visible, setVisible] = useState(false);
  // След камеры: копится за круг и рисуется одной ломаной. Отдельными кусками
  // по перегонам он выглядел бы рваным, а весь пройденный путь — это как раз
  // то, что стоит видеть на экране.
  const [base, setBase] = useState('');
  const [trail, setTrail] = useState(null);
  const [trailFading, setTrailFading] = useState(false);
  const viewRef = useRef(null);
  const frameRef = useRef(null);
  const atRef = useRef(0);
  const routesRef = useRef(null);
  const trailRef = useRef([]);
  const routePathRef = useRef(null);
  const routeCaseRef = useRef(null);
  const rafRef = useRef(0);

  // Подложка карты. Тянем текстом, чтобы встроить разметкой: см. ниже, почему
  // не картинкой.
  useEffect(() => {
    let alive = true;
    fetch('/map/anapa.svg')
      .then(r => (r.ok ? r.text() : null))
      .then(text => { if (alive && text) setBase(text); })
      // Не загрузилась — половина останется цветом земли, форма работает
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Маршруты по улицам между филиалами. Посчитаны заранее (алгоритм Дейкстры
  // по графу улиц из OpenStreetMap) и лежат готовыми ломаными: возить на экран
  // входа дорожный граф и поиск пути ради семи точек незачем.
  useEffect(() => {
    let alive = true;
    fetch('/map/routes.json')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (alive && data) routesRef.current = data; })
      // Не загрузились — камера просто поедет напрямую
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    medCentersApi.map()
      .then(({ data }) => {
        if (!alive || !Array.isArray(data)) return;
        setPoints(order(data.map(mc => ({ ...mc, ...project(mc.lat, mc.lng) }))));
      })
      // Карта — украшение экрана входа, а не его часть: не загрузилась — молчим
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // logoUrl из справочника — путь относительно фронтенда (/lab-logos/…), файлы
  // лежат в public. Дописывать к нему адрес API нельзя: бэкенд их не отдаёт.

  /** Ставит холст так, чтобы точка оказалась в кадре. */
  const moveTo = useCallback((point, zoom, duration) => {
    const view = viewRef.current;
    const frame = frameRef.current;
    if (!view || !frame) return;
    const box = frame.getBoundingClientRect();
    if (duration) view.style.transitionDuration = `${duration}ms`;
    view.style.transform = cameraTransform(point.x, point.y, zoom, box.width, box.height);
  }, []);

  // Первая точка выставляется без перехода: экран не должен открываться
  // проездом от левого верхнего угла.
  useEffect(() => {
    if (!points.length) return;
    const view = viewRef.current;
    if (!view) return;
    view.style.transitionDuration = '0ms';
    moveTo(points[0], ZOOM_NEAR);
  }, [points, moveTo]);

  /** Ломаная маршрута между двумя филиалами или null, если её нет. */
  const routeFor = useCallback((from, to) => {
    const table = routesRef.current;
    if (!table) return null;
    const k = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    const a = k(from);
    const b = k(to);
    if (a === b) return null;
    const line = table[[a, b].sort().join('|')];
    if (!line) return null;
    // В файле ломаная хранится от меньшего ключа к большему — при обратном
    // ходе читаем её с конца.
    const forward = a < b ? line : [...line].reverse();
    // Концы подтягиваем к самим меткам: ближайший узел улицы стоит в паре
    // десятков метров от входа, и без этого линия обрывалась бы у поребрика.
    return [[from.x, from.y], ...forward, [to.x, to.y]];
  }, []);

  useEffect(() => {
    if (points.length < 2) return undefined;
    // Пока карту закрывает поле, ехать некуда: стоим на первом филиале.
    if (!active) return undefined;
    // Переезд идёт сам, без участия человека, — это ровно то движение, от
    // которого защищает системная настройка. Гасить его одним CSS нельзя:
    // без перехода камера не остановится, а начнёт прыгать между филиалами.
    const still = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) return undefined;

    let alive = true;
    const timers = [];
    const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };

    /**
     * Проезд по ломаной.
     *
     * Кадр за кадром, а не переходом CSS: переход умеет вести только по прямой
     * между двумя положениями, а нам нужно вести камеру по улицам. Заодно тем
     * же ходом рисуется сама линия — она обязана расти ровно с той же
     * скоростью, с какой едет камера, иначе смотрится рассинхроном.
     */
    const travel = (line, drawnBefore, duration, done) => {
      const view = viewRef.current;
      const frame = frameRef.current;
      if (!view || !frame) return done();
      const box = frame.getBoundingClientRect();

      const steps = [];
      let total = 0;
      for (let i = 1; i < line.length; i += 1) {
        total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        steps.push(total);
      }
      if (!total) return done();

      // Пунктир длиной во весь след: сдвиг задаёт, сколько от начала уже
      // нарисовано. Пройденная часть остаётся на месте, растёт только хвост.
      // Длины считаем сами, а не через getTotalLength: ломаная состоит из
      // прямых отрезков, и сумма их длин — это ровно длина пути.
      const path = routePathRef.current;
      const shell = routeCaseRef.current;
      if (!path || !shell) {
        // Линии в разметке нет — ехать по ней нечем. Раньше это молча
        // приводило к перегону без линии; теперь просто переставляем камеру.
        moveTo(line[line.length - 1], ZOOM_NEAR, duration);
        return later(done, duration);
      }
      const whole = drawnBefore + total;
      [path, shell].forEach(el => {
        el.style.strokeDasharray = String(whole);
        el.style.strokeDashoffset = String(total);
      });
      view.style.transitionDuration = '0ms';
      const began = performance.now();

      // Ход камеры: разгон, ровный проезд, торможение. Разгон и торможение
      // занимают фиксированное время, а не долю перегона, — иначе на длинном
      // пути середина проносится вдвое быстрее краёв, и это те самые рывки.
      const ramp = Math.min(RAMP_MS, duration / 2);
      const cruise = total / (duration - ramp);

      /** Пройденный путь к моменту t от начала перегона. */
      const passed = (t) => {
        if (t <= ramp) return (cruise * t * t) / (2 * ramp);
        if (t >= duration - ramp) {
          const left = duration - t;
          return total - (cruise * left * left) / (2 * ramp);
        }
        return cruise * (t - ramp / 2);
      };

      /** Точка на ломаной по пройденному пути. */
      const pointAt = (d) => {
        const at = Math.max(0, Math.min(total, d));
        let i = 0;
        while (i < steps.length - 1 && steps[i] < at) i += 1;
        const before = i === 0 ? 0 : steps[i - 1];
        const k = steps[i] === before ? 0 : (at - before) / (steps[i] - before);
        return {
          x: line[i][0] + (line[i + 1][0] - line[i][0]) * k,
          y: line[i][1] + (line[i + 1][1] - line[i][1]) * k
        };
      };

      /**
       * Сглаженное положение камеры.
       *
       * По самой ломаной камеру вести нельзя: дорога на Сукко идёт по горам
       * сплошными серпантинами, и камера, повторяющая каждый поворот, трясётся.
       * Поэтому она едет не по точке пути, а по среднему из нескольких проб,
       * взятых вокруг неё: петли усредняются, общее направление остаётся.
       *
       * Сглаживается только ход камеры. Сама линия рисуется по настоящему
       * маршруту до последнего поворота — она и должна лежать на улицах.
       *
       * У концов перегона сглаживание сходит на нет: там среднее тянуло бы
       * камеру назад, и метка не встала бы в середину кадра.
       */
      const smoothAt = (d) => {
        const exact = pointAt(d);
        const edge = Math.min(d, total - d);
        const w = Math.min(1, edge / CAM_SMOOTH);
        if (w <= 0) return exact;

        let sx = 0;
        let sy = 0;
        for (let k = -CAM_TAPS; k <= CAM_TAPS; k += 1) {
          const p = pointAt(d + (k * CAM_SMOOTH) / CAM_TAPS);
          sx += p.x;
          sy += p.y;
        }
        const n = CAM_TAPS * 2 + 1;
        return {
          x: exact.x + (sx / n - exact.x) * w,
          y: exact.y + (sy / n - exact.y) * w
        };
      };

      /**
       * Кончик линии идёт ровно там же, где камера, — они трогаются и
       * останавливаются вместе.
       *
       * Обе попытки развести их отвергнуты. Опережение (кончик впереди камеры)
       * не работает по устройству: камера привязана к кончику, поэтому при
       * любом постоянном опережении кончик стоит в одной и той же точке кадра,
       * а уводить его дальше кромки некуда — предел в 130 единиц на увеличении
       * 2.4 как раз равен расстоянию от центра кадра до края, и кончик всю
       * дорогу шёл по самому краю. Отставание с дорисовкой на стоянке читается
       * лучше, но заказчику не понравилось запаздывание линии: карандаш обязан
       * идти вместе с кадром, а не догонять его.
       *
       * Значит, рисование читается не движением кончика по экрану, а тем, что
       * под ним уезжает карта. Отсюда и требования к остальному: ход камеры
       * сглажен (смотри smoothAt), а разгон и торможение занимают одинаковое
       * время на любом перегоне — иначе линия местами вылетает рывком, и
       * жалуются уже на это.
       */
      const frameStep = (now) => {
        if (!alive || document.hidden) return;
        const t = Math.min(duration, now - began);
        const drawn = passed(t);

        const here = smoothAt(drawn);
        view.style.transform = cameraTransform(here.x, here.y, ZOOM_NEAR, box.width, box.height);

        const left = String(Math.max(0, total - drawn));
        path.style.strokeDashoffset = left;
        shell.style.strokeDashoffset = left;

        if (t < duration) rafRef.current = requestAnimationFrame(frameStep);
        else done();
      };
      rafRef.current = requestAnimationFrame(frameStep);
    };

    const leg = () => {
      const from = points[atRef.current];
      const next = (atRef.current + 1) % points.length;
      const to = points[next];
      atRef.current = next;

      // Карточку убираем сразу, а содержимое подменяем чуть погодя — пока её
      // уже не видно. Показываем не здесь: она обязана выехать в момент
      // остановки, а не посреди дороги.
      setVisible(false);
      setSettled(-1);
      later(() => setAt(next), FADE_MS);

      const arrive = () => {
        if (!alive) return;
        setSettled(next);
        // Сначала метка договаривает своё покачивание, и только потом из-под
        // неё выезжает карточка: вместе они мешали бы друг другу.
        later(() => setVisible(true), SETTLE_MS);
        // Приехали в точку сброса — гасим след заранее, чтобы он не исчез
        // рывком в тот момент, когда камера тронется дальше.
        if (next === 0) later(() => setTrailFading(true), DWELL_MS - FADE_OUT_MS);
        later(leg, DWELL_MS);
      };

      // Маршрута может не быть: два филиала по одному адресу или файл
      // маршрутов не загрузился. Во втором случае ведём прямой отрезок — след
      // обязан оставаться непрерывным. В первом ехать некуда и рисовать нечего:
      // точки совпадают, и любой отрезок между ними был бы выдумкой.
      //
      // Метки при этом накладываются друг на друга, и так и задумано: активная
      // рисуется отдельным слоем поверх остальных, так что видно ту, о которой
      // сейчас речь. Разводить их в отрисовке пробовали — тогда к сдвинутым
      // точкам тянулись концы маршрута, и линия шла мимо улиц.
      const line = routeFor(from, to)
        || (to.x !== from.x || to.y !== from.y
          ? [[from.x, from.y], [to.x, to.y]]
          : null);

      if (!line) {
        later(arrive, FADE_MS);
        return;
      }

      // Круг начался заново — стираем прошлый след и ведём новый. Стираем в
      // начале следующего круга, а не в конце предыдущего: иначе замыкающий
      // перегон не успел бы дорисоваться и кольцо никогда не замыкалось бы.
      if (from === points[0]) {
        trailRef.current = [];
        setTrailFading(false);
      }

      const before = trailRef.current;
      const drawnBefore = polylineLength(before);
      // Первая точка перегона совпадает с последней точкой следа — не двоим её
      const joined = before.length ? [...before, ...line.slice(1)] : line;
      trailRef.current = joined;
      // flushSync, а не обычный setTrail: проезд сразу после него читает
      // ссылку на элемент линии и правит у него пунктир, а обычная правка
      // состояния попадает в разметку когда-нибудь потом. Ожидание кадра,
      // которое стояло здесь раньше, этого не гарантировало — React успевал
      // не всегда. На первом перегоне круга линии в разметке ещё нет вовсе:
      // ссылка оказывалась пустой, пунктир не выставлялся, и весь перегон
      // Сукко → 3К проходил без линии — она возникала разом уже на следующем.
      flushSync(() => setTrail(joined));

      // Длинному перегону — больше времени: до Сукко тринадцать километров, и
      // на одной длительности он пролетал бы, а поездка по городу тянулась.
      // Длительность считается от длины, а не подбирается: скорость на всех
      // перегонах одна. Разгон и торможение занимают одинаковое время, поэтому
      // прибавляются к пути отдельным слагаемым.
      const legLength = polylineLength(joined) - drawnBefore;
      const duration = Math.max(MIN_MS, legLength / SPEED + RAMP_MS);
      travel(line, drawnBefore, duration, arrive);
    };

    /** Договаривает след до конца тем же ходом, что и хвост перегона. */
    const finishLine = (then) => {
      const path = routePathRef.current;
      const shell = routeCaseRef.current;
      const left = path ? parseFloat(path.style.strokeDashoffset) : NaN;
      if (!path || !shell || !(left > 0)) return then();
      const began = performance.now();
      const step = (now) => {
        if (!alive || document.hidden) return;
        const u = Math.min(1, (now - began) / DRAW_TAIL_MS);
        const v = String(left * (1 - u * u * (3 - 2 * u)));
        path.style.strokeDashoffset = v;
        shell.style.strokeDashoffset = v;
        if (u < 1) rafRef.current = requestAnimationFrame(step);
        else then();
      };
      rafRef.current = requestAnimationFrame(step);
      return undefined;
    };

    /**
     * Возврат на вкладку.
     *
     * Пока вкладка скрыта, браузер не даёт кадров, и проезд замирает на месте:
     * линия остаётся дорисованной до середины перегона, камера стоит, а цепочка
     * переездов не идёт дальше — она заводится только по окончании кадра.
     * Вернувшись, человек видит застывшую половину линии, а следующий кадр
     * доводит перегон одним скачком.
     *
     * Поэтому на возврате мы прерванный проезд не продолжаем, а завершаем:
     * ставим камеру на цель и договариваем след. Договариваем именно ходом, а
     * не подстановкой нуля, как было раньше. Подстановка и есть та самая
     * отрисовка одним кадром, и попадаться на неё легко: вкладка считается
     * скрытой и когда окно ушло за другое приложение или на соседний рабочий
     * стол, то есть при обычном переключении между редактором и браузером. Кто
     * так проверяет карту, видит скачок каждый раз, как возвращается в окно, —
     * и никакой правки хода перегона этого не лечит.
     */
    const onVisible = () => {
      if (document.hidden || !alive) return;
      cancelAnimationFrame(rafRef.current);
      timers.forEach(clearTimeout);
      timers.length = 0;

      const here = points[atRef.current];
      moveTo(here, ZOOM_NEAR, 0);
      finishLine(() => {
        setSettled(atRef.current);
        setVisible(true);
        later(leg, DWELL_MS);
      });
    };
    document.addEventListener('visibilitychange', onVisible);

    later(leg, DWELL_MS);

    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      timers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [points, moveTo, routeFor, active]);

  /**
   * Открытие карты: поле сходит с неё, и филиал представляется заново.
   *
   * Порядок тот же, что при обычной остановке в объезде: сперва метка
   * договаривает покачивание, потом из-под неё выезжает карточка. Ждём
   * схлопывания поля — показать карточку раньше значит выпустить её из-под
   * уезжающего края.
   *
   * Числа согласованы с --morph-ms в Login.css. Держать их врозь неприятно, но
   * лучше, чем читать длительность перехода из стилей: она задана переменной,
   * которую тема вправе переопределить, и getComputedStyle вернул бы уже не то
   * значение, на которое здесь рассчитано.
   */
  useEffect(() => {
    if (!active) {
      setVisible(false);
      setSettled(-1);
      return undefined;
    }
    const timers = [
      setTimeout(() => setSettled(atRef.current), REVEAL_MS),
      setTimeout(() => setVisible(true), REVEAL_MS + SETTLE_MS)
    ];
    return () => timers.forEach(clearTimeout);
  }, [active]);

  // Ширина половины резиновая, и кадр от неё зависит: без пересчёта после
  // поворота планшета камера показывает не то место.
  useEffect(() => {
    if (!points.length) return undefined;
    const onResize = () => {
      const view = viewRef.current;
      if (!view) return;
      view.style.transitionDuration = '0ms';
      moveTo(points[atRef.current], ZOOM_NEAR);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [points, moveTo]);

  const current = points[at];


  if (!points.length) return <div className="login-map" ref={frameRef} />;

  return (
    <div className="login-map" ref={frameRef}>
      <div className="login-map-view" ref={viewRef} style={{ width: MAP_W, height: MAP_H }}>
        {/* Подложка встроена разметкой, а не картинкой.
            <img> с SVG браузер растрирует по размеру в разметке, и увеличение
            камеры растягивало бы готовый растр — карта мылилась. Встроенный SVG
            остаётся вектором при любом увеличении. Разметка своя, из
            public/map, не пользовательская — оттого и dangerously здесь без
            опаски. Сдвиг на MAP_PAD: рамка файла начинается не в нуле
            координат карты, а левее и выше на величину запаса. */}
        <div
          className="login-map-base"
          aria-hidden="true"
          style={{
            left: -MAP_PAD,
            top: -MAP_PAD,
            width: MAP_W + MAP_PAD * 2,
            height: MAP_H + MAP_PAD * 2
          }}
          dangerouslySetInnerHTML={{ __html: base }}
        />
        <svg
          className="login-map-pins"
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          width={MAP_W}
          height={MAP_H}
          aria-hidden="true"
        >

          {/* Маршрут рисуется под метками: линия поверх капли выглядела бы
              проводом, наброшенным на метку. Белая подложка под цветной
              линией — тот же приём, что у дорог: без неё маршрут теряется на
              светлой карте. */}
          {trail && (
            <g className={`login-route${trailFading ? ' fading' : ''}`}>
              <path className="login-route-case" ref={routeCaseRef} d={routeD(trail)} />
              <path className="login-route-line" ref={routePathRef} d={routeD(trail)} />
            </g>
          )}
          {/* Тень и обрезка логотипа общие на все метки */}
          <defs>
            <filter id="loginPinShadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="1.6" stdDeviation="1.6" floodColor="#2A2116" floodOpacity="0.35" />
            </filter>
            {points.map(p => (
              <clipPath key={p.id} id={`loginPinClip-${p.id}`}>
                <circle cx="0" cy={PIN_HEAD_Y} r={PIN_LOGO / 2} />
              </clipPath>
            ))}
          </defs>
          {points.map((p, i) => (i === at ? null : (
            <g key={p.id} className="login-pin" transform={`translate(${p.x} ${p.y})`}>
              {/* Обратный масштаб гасит увеличение камеры: метка нарисована в
                  натуральную величину и должна остаться такой на экране.
                  Покачивание живёт этажом ниже — кадр анимации задаёт transform
                  через CSS и перебил бы им атрибут этой группы целиком. */}
              <g transform={`scale(${1 / ZOOM_NEAR})`}>
                <g className={i === settled ? 'login-pin-settle' : undefined}>
                  <path className="login-pin-body" d={PIN_PATH} fill={p.color || '#6B7280'} />
                  <circle cx="0" cy={PIN_HEAD_Y} r={PIN_INNER_R} fill="#FFFFFF" />
                  {p.logoUrl ? (
                    <image
                      href={p.logoUrl}
                      x={-PIN_LOGO / 2}
                      y={PIN_HEAD_Y - PIN_LOGO / 2}
                      width={PIN_LOGO}
                      height={PIN_LOGO}
                      clipPath={`url(#loginPinClip-${p.id})`}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  ) : (
                    <text
                      className="login-pin-letter"
                      x="0"
                      y={PIN_HEAD_Y + 10}
                      textAnchor="middle"
                      fill={p.color || '#6B7280'}
                    >
                      {(p.shortName || p.name).charAt(0)}
                    </text>
                  )}
                </g>
              </g>
            </g>
          )))}
        </svg>

        {/* Активная метка отдельным слоем поверх карточки: карточка выезжает
            из-под неё, а соседние метки должны оставаться под карточкой, иначе
            они перекрывают текст. */}
        <svg
          className="login-map-pins login-map-pins-top"
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          width={MAP_W}
          height={MAP_H}
          aria-hidden="true"
        >
          {current && (
            <g className="login-pin" transform={`translate(${current.x} ${current.y})`}>
              <g transform={`scale(${1 / ZOOM_NEAR})`}>
                <g className={at === settled ? 'login-pin-settle' : undefined}>
                  <path className="login-pin-body" d={PIN_PATH} fill={current.color || '#6B7280'} />
                  <circle cx="0" cy={PIN_HEAD_Y} r={PIN_INNER_R} fill="#FFFFFF" />
                  {current.logoUrl ? (
                    <image
                      href={current.logoUrl}
                      x={-PIN_LOGO / 2}
                      y={PIN_HEAD_Y - PIN_LOGO / 2}
                      width={PIN_LOGO}
                      height={PIN_LOGO}
                      clipPath={`url(#loginPinClip-${current.id})`}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  ) : (
                    <text
                      className="login-pin-letter"
                      x="0"
                      y={PIN_HEAD_Y + 10}
                      textAnchor="middle"
                      fill={current.color || '#6B7280'}
                    >
                      {(current.shortName || current.name).charAt(0)}
                    </text>
                  )}
                </g>
              </g>
            </g>
          )}
        </svg>

        {/* Карточка филиала. Лежит слоем ниже меток и стартует спрятанной под
            своей меткой: раскрываясь, она выезжает из-под неё вправо, а не
            всплывает рядом готовой плашкой.

            Стоит в координатах холста и гасит увеличение камеры обратным
            масштабом — едет вместе с картой, но не растёт вместе с ней, а всё
            внутри верстается обычными пикселями. */}
        {current && (
          <div
            className="login-pin-card-anchor"
            style={{
              left: current.x,
              top: current.y,
              transform: `scale(${1 / ZOOM_NEAR})`
            }}
          >
            <div className={`login-pin-card${visible ? ' shown' : ''}`}>
              {/* Логотипа здесь нет намеренно: логотип — это сама метка, из-под
                  которой карточка выезжает. Второй такой же рядом и был тем
                  самым «двойным лого».

                  Содержимое разложено в строку, а не в столбик: карточка
                  обязана уложиться в высоту метки. */}
              <div className="lpc-text">
                <b>{current.shortName || current.name}</b>
                {current.address && (
                  <span className="lpc-addr">
                    {current.city ? `${current.city}, ` : ''}{current.address}
                  </span>
                )}
                {current.rating != null && (
                  <span className="lpc-rating">
                    <span className="stars">
                      <span className="stars-off">{STARS}</span>
                      <span className="stars-on" style={{ width: `${(current.rating / 5) * 100}%` }}>
                        {STARS}
                      </span>
                    </span>
                    <b>{current.rating.toFixed(1).replace('.', ',')}</b>
                    <span className="lpc-reviews">{reviewsLabel(current.reviews)}</span>
                  </span>
                )}
              </div>

            </div>
          </div>
        )}
      </div>

      {/* Полоса отзывов о филиале, на котором сейчас стоит камера.
          
          Лежит рядом с холстом, а не внутри него: холст увеличен камерой, и всё
          вложенное в него пришлось бы гасить обратным масштабом, как это делает
          выноска. Полосе это не нужно — она не привязана к точке на карте.

          Матового стекла здесь намеренно нет, хотя по остальному оформлению
          просилось бы. `backdrop-filter` заставляет браузер растрировать то, что
          за элементом, а за ним — увеличенная карта: она разом теряет резкость.
          На этом уже попадались с выноской. Поэтому подложка карточек сплошная,
          а к карте полоса пришита градиентной растушёвкой.

          Филиала без отзывов полоса не касается вовсе: у Сукко доски отзывов
          нет, и вместо пустой рамки там просто карта во всю высоту. */}
      {current && current.quotes && current.quotes.length > 0 && (
        <div
          className={`login-quotes${visible ? ' shown' : ''}`}
          /* Цвет филиала уходит в карточки переменной: кружки аватарок красятся
             им же, чем метка и полоса связываются в одно целое. Меняется он на
             каждой остановке — это и есть тот цвет, которого полосе не хватало,
             и он не выдуман, а взят из справочника. */
          style={{ '--lq-accent': current.color || '#6B7280' }}
        >
          {current.quotes.map((q, i) => (
            <figure
              className="login-quote"
              key={`${current.id}-${i}`}
              /* Появляются лесенкой, а исчезают разом: уходящая лесенка читается
                 не как приём, а как подтормаживание. */
              style={visible ? { transitionDelay: `${i * 90}ms` } : undefined}
            >
              <div className="lq-head">
                {/* Настоящих аватарок у отзывов с площадок нет и не будет.
                    Значок человека это признаёт молча; инициалы, которые стояли
                    здесь раньше, наоборот притворялись содержательными — из
                    «ОС» ничего не следует, а выглядело оно как что-то значащее.
                    Один и тот же серый на всех: аватарка не должна оттягивать
                    внимание от имени, рядом с которым стоит. */}
                <span className="lq-avatar" aria-hidden="true">
                  <User size={17} strokeWidth={2} />
                </span>
                <span className="lq-meta">
                  <span className="lq-line">
                    <b>{q.author}</b>
                    <time dateTime={q.date}>{quoteDate(q.date)}</time>
                  </span>
                  <span className="stars">
                    <span className="stars-off">{STARS}</span>
                    <span className="stars-on" style={{ width: `${(q.rating / 5) * 100}%` }}>
                      {STARS}
                    </span>
                  </span>
                </span>
              </div>
              <blockquote>{q.text}</blockquote>
            </figure>
          ))}
        </div>
      )}

    </div>
  );
}
