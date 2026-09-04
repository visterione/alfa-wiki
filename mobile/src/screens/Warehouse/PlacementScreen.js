/**
 * Размещение имущества ведомости по кабинетам — с телефона.
 *
 * ── Почему это мобильная работа по природе ───────────────────────────────────
 *
 * Ветка 1С («Кабинет Хирурга») не отвечает на вопрос, где вещь стоит: под ней
 * лежит имущество пяти-шести физических кабинетов, а строка «Стул СТ 6, 3 шт» —
 * это три стула в трёх разных местах. Ответа нет ни в файле, ни в голове у того,
 * кто сидит за компьютером: его знает только человек, стоящий в кабинете и
 * видящий, что там есть.
 *
 * Поэтому здесь работа устроена так же, как в вебе, но начинается с двери:
 * отсканировал QR на кабинете — и дальше отмечаешь то, что видишь вокруг.
 * Кабинет выбирается один раз, позиции набрасываются пачкой.
 *
 * ── Почему в количестве стоит единица (ver. 7.46) ────────────────────────────
 *
 * Раньше поле было пустым, и пустота означала «весь нераспределённый остаток»:
 * считалось, что позиция целиком лежит там, где на неё смотрят. На бою вышло
 * ровно наоборот — вещи лежат по одной, а одно касание строки без ввода цифры
 * записывало на кабинет все пятьдесят единиц. Заметили это не сразу: после
 * разбора размещение снимается только перемещением.
 *
 * Поэтому отметка ставит единицу, и она же видна в поле — человек правит её,
 * когда стульев действительно шесть, а не когда их один.
 *
 * ── Сначала кабинет, потом ведомость (ver. 7.23) ─────────────────────────────
 *
 * Раньше экран открывался списком из трёх тысяч позиций, над которым висела
 * строка «выберите кабинет». Читать этот список до выбора кабинета незачем — он
 * всё равно один и тот же для всей сети, — а промахнуться и разложить в чужой
 * кабинет было легко. Теперь кабинет это первый шаг, и до него ведомость не
 * показывается вовсе.
 *
 * ── Почему раскладка сразу же заводит карточки ───────────────────────────────
 *
 * До ver. 7.23 размещение только фиксировало за кабинетом намерение: карточки
 * оборудования и остатки материалов появлялись позже, общим прогоном разбора из
 * веба. То есть человек обходил этаж с телефоном, а баланс кабинета оставался
 * нулевым, пока кто-то не сядет за компьютер и не нажмёт «Проверить и создать».
 * Мобильная раскладка была работой, которую всё равно надо было доделывать за
 * столом, — и смысла в ней не оставалось.
 *
 * Теперь сервер разбирает ровно тот кабинет, который разложили, сразу же. Это
 * безопасно: разбор идемпотентен и считает уже созданное, поэтому повторный
 * прогон ничего не задваивает, а сужение до одного кабинета не трогает остальную
 * ведомость. Общий разбор в вебе никуда не делся — он про проверку решений
 * словаря по всей ведомости целиком.
 *
 * С ver. 7.46 флага materialize в запросе больше нет: разбор идёт всегда, в том
 * числе при раскладке из веба. Раньше веб его не слал, и раскладка за столом
 * оставалась намерением до общего прогона — со стороны это выглядело как
 * операция, которая когда-нибудь применится сама.
 *
 * ── Кабинет под описью (ver. 7.46) ───────────────────────────────────────────
 *
 * Пока по кабинету идёт пересчёт, раскладывать в него нельзя, и узнать об этом
 * надо до обхода, а не на кнопке «Положить сюда». Поэтому список кабинетов
 * спрашивает frozen-rooms и такие кабинеты не даёт выбрать вовсе, а если опись
 * открыли, пока экран был открыт, вместо ведомости показывается объяснение.
 * Сервер проверяет то же самое ещё раз — экран может отстать от жизни на минуту.
 *
 * ── Почему этикетки печатаются отсюда же (ver. 7.36) ─────────────────────────
 *
 * Раскладка заводит карточки оборудования, а карточка без наклейки на корпусе
 * не находится ни сканером, ни глазами. Чтобы напечатать этикетки на только что
 * разложенное, надо было выйти из размещения, открыть вкладку кабинетов, найти
 * тот же кабинет и отметить в нём те же вещи заново — на первичном разносе,
 * когда за день обходят десятки кабинетов, это удваивает работу.
 *
 * Поэтому сервер возвращает id заведённых карточек, а экран держит их, пока не
 * сменили кабинет: предложением сразу после «Готово» и полосой над списком, если
 * предложение отклонили. Печать остаётся отдельным шагом — принтер бывает не с
 * собой, а этикетки нужны не всегда.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View, Text, Image, FlatList, TextInput, Pressable, StyleSheet, Alert, Modal,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {
  DoorOpen, ScanLine, Search, X, Check, Package, Boxes, Building2,
  ChevronRight, Printer, ClipboardList,
} from 'lucide-react-native';

import CONFIG from '../../config';
import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import GlassBackdrop from '../../components/GlassBackdrop';
import FloorSwitch from './FloorSwitch';
import {radius, font, glassSurface, glassOverlay, glassLine, accentShadow} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {
  loadLocationTree, useWarehouseCan, useWarehouseMedCenter,
} from '../../store/warehouseStore';
import {
  qtyText, moneyText, flattenRooms, roomMatches, roomHeadText, roomSubText,
} from './warehouseMeta';
import {ROOT_KEY, buildNodes, leavesOf, resolveNode} from './locationTree';

export default function WarehousePlacementScreen() {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const canPrint = useWarehouseCan('canPrintLabels');
  // Место под нижнюю кнопку «Положить сюда»: она лежит поверх списка, и без
  // запаса последняя позиция оказывалась бы под ней.
  const listStyle = {paddingHorizontal: 12, paddingBottom: insets.bottom + 90};

  // Дерево локаций целиком: шаг выбора кабинета спускается по нему, а плоский
  // список нужен только для подписи уже выбранного кабинета
  const [tree, setTree] = useState(null);
  const [queue, setQueue] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [picked, setPicked] = useState(new Map());
  const [q, setQ] = useState('');
  // Фильтр вида: у оборудования и материалов разный вопрос — «сколько штук
  // стоит» против «сколько осталось», — и в кабинете их разбирают порознь.
  const [kind, setKind] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Карточки, заведённые в этом кабинете, — только чтобы предложить этикетки.
  // Сбрасываются сменой кабинета: в новом кабинете печатать нужно уже другое.
  const [fresh, setFresh] = useState(null);
  // Кабинеты под открытой описью: Map(roomId → номер описи).
  const [frozen, setFrozen] = useState(new Map());

  const room = useMemo(
    () => flattenRooms(tree).find(item => item.id === roomId),
    [tree, roomId],
  );

  /**
   * Очередь ведомости.
   *
   * Поиск и отбор по виду считает СЕРВЕР (ver. 7.51). Раньше телефон брал
   * первые двести строк и фильтровал их у себя: на ведомости в три тысячи
   * позиций «компью» находило три совпадения вместо семидесяти — ровно те, что
   * попали в загруженный кусок. В вебе тот же запрос всегда уходил на сервер, и
   * два экрана отвечали по-разному на один и тот же вопрос.
   */
  const load = useCallback(async () => {
    try {
      const [treeData, queueResult, frozenResult] = await Promise.all([
        loadLocationTree(),
        warehouseApi.placementQueue({
          limit: 200,
          mode: 'all',
          q: q.trim() || undefined,
          kind: kind === 'all' ? undefined : kind,
        }),
        // Список описей не роняет экран: без него размещение всё равно
        // работает, просто отказ придёт от сервера, а не от списка кабинетов.
        warehouseApi.frozenRooms().catch(() => ({data: {items: []}})),
      ]);
      setTree(treeData);
      setQueue(queueResult.data);
      setFrozen(new Map((frozenResult.data?.items || []).map(x => [x.roomId, x.number])));
    } catch {
      setQueue(null);
    } finally {
      setLoading(false);
    }
  }, [q, kind]);

  /**
   * Один эффект на оба повода перечитать очередь: возврат на экран и набор в
   * поиске. Двумя эффектами они дублировали бы запрос при открытии, а поиск,
   * висящий на возврате фокуса, стрелял бы на каждую букву — load зависит от
   * строки запроса.
   */
  useFocusEffect(useCallback(() => {
    const timer = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, q]));

  const toggle = (item) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.lineKey)) next.delete(item.lineKey);
      // Единица, а не пустота: см. «Почему в количестве стоит единица» в шапке.
      else next.set(item.lineKey, '1');
      return next;
    });
  };

  const printLabels = (ids, roomLabel) => navigation.navigate('WarehouseLabelPrint', {
    kind: 'asset',
    ids,
    title: roomLabel || 'Этикетки оборудования',
  });

  const send = async () => {
    if (!roomId || !picked.size) return;
    setSending(true);
    try {
      const {data} = await warehouseApi.placeItems({
        roomId,
        items: [...picked.entries()].map(([lineKey, quantity]) => ({
          lineKey, quantity: quantity === '' ? null : Number(quantity),
        })),
      });
      setPicked(new Map());
      await load();

      const made = data.materialized;
      const lines = [
        `Разложено позиций: ${data.saved}.`,
        made?.failed
          // Размещение сохранено, а разбор не прошёл — молчать об этом нельзя:
          // человек уйдёт из кабинета, считая, что имущество заведено.
          ? `Разбор не прошёл: ${made.failed}. Запустите разбор в веб-версии.`
          : made && (made.assetsCreated || made.stockReceipts)
            ? [
              made.assetsCreated && `заведено карточек: ${made.assetsCreated}`,
              made.stockReceipts && `позиций материалов: ${made.stockReceipts}`,
            ].filter(Boolean).join(', ')
            : null,
        data.rejected?.length
          ? `Пропущено ${data.rejected.length}: ${data.rejected[0].reason}`
          : null,
        made?.problems?.length ? made.problems[0].reason : null,
      ].filter(Boolean);

      // Этикетки — только на карточки, заведённые здесь и сейчас: их номеров ещё
      // нет на корпусах, и наклеить их проще всего не выходя из кабинета.
      //
      // Пачки за кабинет складываются, а не заменяют друг друга: оборудование и
      // материалы отбирают порознь через фильтр вида, то есть один кабинет почти
      // всегда раскладывается в два-три захода. Если бы вторая пачка вытесняла
      // первую, часть карточек снова пришлось бы искать во вкладке кабинетов —
      // ровно от этого экран и избавляет.
      const ids = canPrint ? (made?.assetIds || []) : [];
      if (ids.length) {
        setFresh(prev => ({
          ids: [...new Set([...(prev?.ids || []), ...ids])],
          roomLabel: room?.label,
        }));
      }

      const title = data.rejected?.length || made?.failed
        ? 'Размещено с оговорками' : 'Готово';
      if (ids.length) {
        Alert.alert(title, lines.join('\n'), [
          // «Потом» не теряет карточки: полоса над списком висит до смены
          // кабинета, и напечатать их можно, дойдя до принтера.
          {text: 'Потом', style: 'cancel'},
          {text: `Этикетки · ${ids.length}`, onPress: () => printLabels(ids, room?.label)},
        ]);
      } else {
        Alert.alert(title, lines.join('\n'));
      }
    } catch (e) {
      Alert.alert('Не размещено', e?.response?.data?.error || 'Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  };

  // Отбор уже сделан сервером — здесь только то, что он прислал.
  const items = queue?.items || [];

  // Счётчики на переключателях вида считает сервер по всей очереди, а не по
  // присланной странице: «Материалы (0)» отвечает на вопрос раньше, чем по
  // нему нажмут, и по одной странице такой ответ был бы неверным.
  const counts = {
    asset: queue?.kinds?.asset || 0,
    material: queue?.kinds?.material || 0,
  };

  if (loading) return <LogoLoader />;

  if (!queue?.import) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Нет принятого снимка ведомости</Text>
      </View>
    );
  }

  // Шаг первый: пока кабинет не выбран, ведомость не показывается. Она одна и
  // та же для всей сети, читать её до выбора кабинета нечего, а промахнуться
  // кабинетом легко — и разложенное не туда потом снимать вручную.
  if (!roomId) {
    return (
      <RoomStep
        tree={tree}
        frozen={frozen}
        styles={styles}
        c={c}
        insets={insets}
        onScan={() => setScanning(true)}
        onPick={setRoomId}
        scanning={scanning}
        onCloseScan={() => setScanning(false)}
        onFound={(id) => { setScanning(false); setRoomId(id); }}
      />
    );
  }

  // Кабинет под описью — стоп, а не предупреждение над списком. Ведомость здесь
  // показывать незачем: всё, что в ней отметят, сервер всё равно отвергнет, а
  // человек к этому моменту уже обойдёт кабинет.
  const countingHere = frozen.get(roomId);
  if (countingHere) {
    return (
      <View style={styles.empty}>
        <ClipboardList size={30} color={c.textTertiary} />
        <Text style={styles.blockedTitle}>
          {room ? room.label : 'Кабинет'} пересчитывают
        </Text>
        <Text style={styles.emptyText}>
          Идёт инвентаризация {countingHere}. Размещение и любые движения по
          кабинету закрыты, пока опись не закроют, — иначе разница уйдёт в описи
          в недостачу.
        </Text>
        <Pressable
          style={styles.blockedBtn}
          onPress={() => { setRoomId(null); setPicked(new Map()); setFresh(null); }}>
          <Text style={styles.blockedBtnText}>Выбрать другой кабинет</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Pressable
        style={styles.roomBar}
        onPress={() => { setRoomId(null); setPicked(new Map()); setFresh(null); }}>
        <DoorOpen size={18} color={c.primary} />
        <View style={styles.roomText}>
          <Text style={styles.roomName}>{room ? room.label : 'Кабинет'}</Text>
          <Text style={styles.roomWhere}>{room ? room.where : 'сменить'}</Text>
        </View>
        <Text style={styles.roomChange}>сменить</Text>
      </Pressable>

      {/* Полоса, а не только всплывающее предложение: принтер в отделении может
          раздавать свой вайфай, и до печати человек успевает уйти в настройки
          сети — задание должно ждать его на экране, а не в закрытом окне. */}
      {Boolean(fresh) && (
        <Pressable style={styles.freshBar} onPress={() => printLabels(fresh.ids, fresh.roomLabel)}>
          <Printer size={17} color={c.primary} />
          <Text style={styles.freshText}>
            Заведено карточек: {fresh.ids.length} — напечатать этикетки
          </Text>
          <ChevronRight size={16} color={c.textTertiary} />
        </Pressable>
      )}

      <View style={styles.tools}>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Поиск по ведомости"
            placeholderTextColor={c.textTertiary}
          />
        </View>

        {/* Оборудование учитывается карточкой с инвентарным номером, материал —
            количеством на остатке. В кабинете их разбирают порознь, поэтому
            фильтр стоит прямо у поиска. Повторное нажатие снимает фильтр —
            отдельная кнопка «Всё» съела бы место у самого поиска. */}
        {[['asset', Package], ['material', Boxes]].map(([key, Icon]) => (
          <Pressable
            key={key}
            style={[styles.kindToggle, kind === key && styles.kindToggleOn]}
            onPress={() => setKind(prev => (prev === key ? 'all' : key))}
            accessibilityRole="button"
            accessibilityState={{selected: kind === key}}
            accessibilityLabel={key === 'asset' ? 'Только оборудование' : 'Только материалы'}>
            <Icon size={17} color={kind === key ? '#FFFFFF' : c.textSecondary} />
            <Text style={[styles.kindCount, kind === key && styles.kindCountOn]}>
              {counts[key]}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.lineKey}
        contentContainerStyle={listStyle}
        keyboardShouldPersistTaps="handled"
        renderItem={({item}) => {
          const checked = picked.has(item.lineKey);
          return (
            <Pressable
              style={[styles.item, checked && styles.itemOn]}
              onPress={() => toggle(item)}>
              <View style={[styles.check, checked && styles.checkOn]}>
                {checked && <Check size={13} color="#FFFFFF" />}
              </View>
              {/* Значок вида, а не подпись словом: строка и так несёт название,
                  остаток и цену, и четвёртая надпись в ней уже не читается */}
              <View style={styles.kindIcon}>
                {item.kind === 'asset'
                  ? <Package size={15} color={c.primary} />
                  : <Boxes size={15} color={c.textSecondary} />}
              </View>
              <View style={styles.itemText}>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  осталось {qtyText(item.unplacedQty)} {item.unit}
                  {item.unitCost ? ` · ${moneyText(item.unitCost)} за ед.` : ''}
                </Text>
                {Boolean(item.branchRoomId) && (
                  <Text style={styles.itemBranch}>
                    сейчас числится по ветке — разложите как есть на самом деле
                  </Text>
                )}
              </View>
              {checked && (
                <TextInput
                  style={styles.qty}
                  value={picked.get(item.lineKey)}
                  onChangeText={value => setPicked((prev) => {
                    const next = new Map(prev);
                    next.set(item.lineKey, value);
                    return next;
                  })}
                  placeholder="1"
                  placeholderTextColor={c.textTertiary}
                  keyboardType="numeric"
                />
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.none}>
            {q ? 'Ничего не нашлось' : 'Всё имущество ведомости уже разложено по кабинетам.'}
          </Text>
        }
        ListFooterComponent={
          // Список упёрся в потолок — значит найдено больше, чем показано.
          // Молчать об этом нельзя: именно так и выглядит пропажа позиций.
          queue.total > items.length ? (
            <Text style={styles.none}>
              Показано {items.length} из {queue.total} — уточните поиск.
            </Text>
          ) : null
        }
      />

      {picked.size > 0 && (
        <View style={[styles.bottom, {paddingBottom: insets.bottom + 10}]}>
          <Pressable
            style={[styles.send, (!roomId || sending) && styles.sendOff]}
            disabled={!roomId || sending}
            onPress={send}>
            <Text style={styles.sendText}>
              {sending
                ? 'Размещаю…'
                : `Положить в ${room ? room.label.toLowerCase() : 'кабинет'} · ${picked.size}`}
            </Text>
          </Pressable>
        </View>
      )}

    </View>
  );
}

/**
 * Шаг выбора кабинета: медцентр → этаж → кабинет.
 *
 * Плоский список на сотню строк здесь не работал по той же причине, что и в
 * разделе «Кабинеты»: номер 305 есть в каждом здании, и найти нужный можно было
 * только прокруткой мимо всех остальных. Дерево то же самое (locationTree), и
 * ведёт себя так же — уровень без выбора пропускается, пустые ветки не
 * показываются, поиск идёт по тому поддереву, в котором стоишь.
 *
 * Спуск здесь внутренний, а не переходами по стеку: размещение — это один
 * экран, и уводить человека из него на три экрана вглубь, чтобы вернуть
 * обратно, значит потерять уже отмеченное.
 *
 * Кабинеты без мест хранения выключены: разбор кладёт остаток на полку, и без
 * неё раскладка сорвалась бы уже после того, как человек всё отметил.
 */
function RoomStep({tree, frozen, styles, c, insets, onScan, onPick, scanning, onCloseScan, onFound}) {
  /**
   * Спуск начинается не с корня, а с медцентра из шапки (ver. 7.78).
   *
   * Размещение — это обход одного здания, и медцентр в нём не меняется весь
   * день. Выбирать его заново на каждом входе значило требовать ответа на
   * вопрос, на который уже отвечено переключателем в шапке — тем же, что
   * определяет остальные экраны склада.
   *
   * `null` здесь означает «идём за переключателем», а не «корень»: пока человек
   * сам не спустился в медцентр (это возможно только в режиме «вся сеть»), шаг
   * следует за шапкой, и смена клиники там сразу уводит спуск туда.
   *
   * Строки «Все медцентры» здесь нет: подниматься некуда — вопрос «какая
   * клиника» задан переключателем в шапке, и второй орган управления с тем же
   * смыслом рядом с поиском только повторял бы его. Спуск живёт ровно до выбора
   * кабинета: как только он сделан, шаг снимается с экрана целиком, и следующий
   * заход снова начинается с ответа шапки.
   */
  const {medCenterId} = useWarehouseMedCenter();
  const [nodeKey, setNodeKey] = useState(null);
  // Выбранный этаж. Пусто до первого касания — тогда берётся первый по списку.
  const [floorKey, setFloorKey] = useState(null);
  const [q, setQ] = useState('');

  const nodes = useMemo(() => buildNodes(tree), [tree]);

  // Медцентр без единого кабинета в дерево не попадает (см. buildNodes), и
  // тогда начинаем с корня: спуск в узел, которого нет, показал бы пустоту.
  const homeKey = medCenterId && nodes.has(`mc:${medCenterId}`) ? `mc:${medCenterId}` : ROOT_KEY;
  const activeKey = nodeKey ?? homeKey;

  // Сменили медцентр в шапке — спуск идёт туда, а не остаётся в прежнем
  // здании: переключатель для того и нажимают.
  useEffect(() => { setNodeKey(null); setFloorKey(null); setQ(''); }, [medCenterId]);

  const node = useMemo(() => resolveNode(nodes, activeKey), [nodes, activeKey]);

  // Этажи — лентой над списком, а не уровнем спуска: ровно как в разделе
  // «Кабинеты» (ver. 7.50). Раскладка это обход здания, и человек, стоящий в
  // кабинете, ищет его номер, а не путь до него.
  const floors = node?.kind === 'mc' ? node.children : null;
  const floor = floors ? (floors.find(item => item.key === floorKey) || floors[0]) : null;
  // Поиск идёт по всему медцентру, а не по выбранному этажу: человек,
  // набирающий номер кабинета, ищет его в здании.
  const listNode = q.trim() ? node : (floor || node);

  const groups = useMemo(() => {
    if (!listNode) return [];
    const needle = q.trim().toLowerCase();
    return leavesOf(listNode)
      .map(leaf => ({leaf, rooms: leaf.rooms.filter(room => roomMatches(room, needle))}))
      .filter(group => group.rooms.length);
  }, [listNode, q]);

  const flat = node?.kind !== 'root' || Boolean(q.trim());

  // Заголовок этажа над списком нужен, только когда он говорит больше, чем
  // нажатая кнопка переключателя: у именованных этажей — да (после отказа от
  // корпусов «4» бывает два), у обычного «3 этаж» — нет.
  const single = groups.length === 1;
  const named = single && groups[0].leaf.title !== `${groups[0].leaf.short} этаж`;

  const items = flat
    ? groups.flatMap(({leaf, rooms}) => [
      ...(!single || named
        ? [{type: 'group', key: `g-${leaf.key}`, title: leaf.path || leaf.title}]
        : []),
      ...rooms.map(room => ({type: 'room', key: `r-${room.id}`, room})),
    ])
    : (listNode?.children || []).map(child => ({type: 'node', key: `n-${child.key}`, node: child}));

  return (
    <View style={styles.stepRoot}>
      {/* Поля по линии поиска и списка этого экрана, интервал — как у соседей:
          здесь всё стоит на восьми. */}
      <FloorSwitch
        floors={floors}
        value={floor?.key}
        onChange={setFloorKey}
        inset={12}
        spacing={8}
      />

      {/* Сканер — значком рядом с поиском (ver. 7.78). Полосой во всю ширину
          он занимал верх экрана и читался как главное действие, хотя это
          второй способ ответить на тот же вопрос «какой кабинет»: первый —
          набрать номер. Теперь оба стоят в одной строке, и выбор между ними
          стоит одного взгляда, а не половины экрана. */}
      <View style={styles.searchRow}>
        <View style={[styles.stepSearch, styles.searchField]}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder={listNode?.kind === 'root' ? 'Кабинет по всей сети' : 'Кабинет'}
            placeholderTextColor={c.textTertiary}
          />
        </View>
        <Pressable
          style={styles.scanBtn}
          onPress={onScan}
          accessibilityRole="button"
          accessibilityLabel="Сканировать QR кабинета">
          <ScanLine size={19} color="#FFFFFF" />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={{paddingHorizontal: 12, paddingBottom: insets.bottom + 24}}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.none}>Ничего не нашлось</Text>}
        renderItem={({item}) => {
          if (item.type === 'group') {
            return <Text style={styles.groupTitle}>{item.title}</Text>;
          }

          if (item.type === 'node') {
            const logo = item.node.logoUrl ? CONFIG.fileUrl(item.node.logoUrl) : null;
            return (
              <Pressable style={styles.pickRow} onPress={() => setNodeKey(item.node.key)}>
                {/* Знак медцентра вместо общей иконки — как в «Кабинетах»:
                    их пять, они похожи по названию и различаются знаком */}
                {logo ? (
                  <Image source={{uri: logo}} style={styles.logo} resizeMode="contain" />
                ) : (
                  <View style={styles.levelIcon}>
                    <Building2 size={18} color={c.primary} />
                  </View>
                )}
                <View style={styles.itemText}>
                  <Text style={styles.itemName}>{item.node.title}</Text>
                  {Boolean(item.node.subtitle) && (
                    <Text style={styles.itemMeta} numberOfLines={1}>{item.node.subtitle}</Text>
                  )}
                </View>
                <Counts styles={styles} c={c} counts={item.node.counts} />
                <ChevronRight size={16} color={c.textTertiary} />
              </Pressable>
            );
          }

          const {room} = item;
          const hasStorage = Boolean(room.storages?.length);
          // Кабинет под описью гасится так же, как кабинет без мест хранения:
          // выбрать его нельзя, а причина написана там же, где название, —
          // человек читает её до того, как войдёт в кабинет.
          const counting = frozen?.get(room.id);
          const blocked = !hasStorage || Boolean(counting);
          const meta = [
            roomSubText(room),
            counting && `идёт инвентаризация ${counting}`,
            !hasStorage && 'нет мест хранения',
          ].filter(Boolean).join(' · ');
          return (
            <Pressable
              style={[styles.pickRow, blocked && styles.pickRowOff]}
              disabled={blocked}
              onPress={() => onPick(room.id)}>
              {counting
                ? <ClipboardList size={17} color={c.textTertiary} />
                : <DoorOpen size={17} color={c.primary} />}
              <View style={styles.itemText}>
                {/* В заголовке только номер: название стоит подписью снизу, и
                    через тире оно шло бы вторым разом подряд. */}
                <Text style={styles.itemName}>{roomHeadText(room)}</Text>
                {/* Пустая подпись — это пустая строка высотой в строку: у
                    кабинета без имени, без описи и с полками говорить нечего. */}
                {Boolean(meta) && (
                  <Text style={styles.itemMeta} numberOfLines={1}>{meta}</Text>
                )}
              </View>
              <Counts
                styles={styles}
                c={c}
                counts={{
                  assets: room.counters?.assets || 0,
                  materials: room.counters?.positions || 0,
                }}
              />
            </Pressable>
          );
        }}
      />

      {scanning && <RoomScanner styles={styles} onClose={onCloseScan} onFound={onFound} />}
    </View>
  );
}

/**
 * Пара счётчиков со значками: оборудование и материалы. Тот же вид, что в
 * разделе «Кабинеты», — человек ходит и туда, и сюда, и разные обозначения
 * читались бы как разные величины.
 */
function Counts({styles, c, counts}) {
  if (!counts?.assets && !counts?.materials) return null;

  return (
    <View style={styles.counts}>
      {counts.assets > 0 && (
        <View style={styles.count}>
          <Package size={12} color={c.textTertiary} />
          <Text style={styles.countText}>{counts.assets}</Text>
        </View>
      )}
      {counts.materials > 0 && (
        <View style={styles.count}>
          <Boxes size={12} color={c.textTertiary} />
          <Text style={styles.countText}>{counts.materials}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Выбор кабинета сканированием QR с двери.
 *
 * Публичная ссылка кабинета разбирается тем же /assets/lookup, что и этикетка
 * актива: сервер сам различает, что отсканировали.
 */
function RoomScanner({styles, onClose, onFound}) {
  const device = useCameraDevice('back');
  const busy = React.useRef(false);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: async (codes) => {
      const value = codes?.[0]?.value;
      if (!value || busy.current) return;
      busy.current = true;
      try {
        const {data} = await warehouseApi.lookup(value);
        if (data.kind === 'room') onFound(data.room.id);
        else if (data.kind === 'asset' && data.asset.room) onFound(data.asset.room.id);
        else {
          Alert.alert('Это не кабинет', 'Отсканируйте QR с двери кабинета.');
          busy.current = false;
        }
      } catch {
        Alert.alert('Не распознано', 'По этому коду кабинет не нашёлся.');
        busy.current = false;
      }
    },
  });

  return (
    <Modal animationType="slide" transparent={false} onRequestClose={onClose}>
      <GlassBackdrop>
        <View style={styles.scanModal}>
          {device && (
            <Camera style={StyleSheet.absoluteFill} device={device} isActive codeScanner={codeScanner} />
          )}
          <Pressable style={styles.scanClose} onPress={onClose} hitSlop={10}>
            <X size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </GlassBackdrop>
    </Modal>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1},
  /**
   * Отступ шага выбора кабинета от шапки — на самом шаге, а не на первом его
   * элементе. Первым бывает то возврат «Все медцентры», то переключатель
   * этажей, то сразу поиск (на «всей сети» первых двух нет вовсе), и отступ,
   * привязанный к любому из них, пропадал ровно в том случае, когда этого
   * элемента на экране не оказывалось. Раньше его держала широкая кнопка QR —
   * вместе с ней он и исчез.
   */
  stepRoot: {flex: 1, paddingTop: 12},
  roomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...glassSurface(c),
    margin: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
  },
  roomText: {flex: 1},
  roomName: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  roomWhere: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  roomChange: {fontFamily: font.medium, fontSize: 12, color: c.primary},
  freshBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.primaryLight,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radius.md,
  },
  freshText: {flex: 1, fontFamily: font.medium, fontSize: 13, color: c.primary, lineHeight: 18},
  // Поиск и сканер стоят в одной строке: поле тянется, кнопка держит квадрат
  // по высоте поля — иначе она выпирала бы из строки и снова притягивала взгляд.
  searchRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 12},
  searchField: {flex: 1, marginHorizontal: 0},
  scanBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.primary,
    ...accentShadow(c.primary),
  },
  tools: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12},
  // Поиск в строке инструментов списка ведомости: делит её с переключателями
  // вида, поэтому flex
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    ...glassSurface(c),
  },
  // Переключатель вида: значок плюс сколько таких позиций в очереди. Число
  // здесь отвечает «а есть ли там вообще материалы» до нажатия.
  // Поиск на шаге выбора кабинета. Отдельно от предыдущего: там строка делится
  // с переключателями и растягивается по ширине, а здесь она стоит в колонке —
  // и flex растянул бы её на всю высоту, оставив от поля одну лупу.
  stepSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    ...glassSurface(c),
  },
  logo: {width: 34, height: 34, borderRadius: radius.md, backgroundColor: '#FFFFFF'},
  levelIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counts: {alignItems: 'flex-end', gap: 2},
  count: {flexDirection: 'row', alignItems: 'center', gap: 4},
  countText: {
    fontFamily: font.medium,
    fontSize: 12,
    color: c.textTertiary,
    minWidth: 18,
    textAlign: 'right',
  },
  groupTitle: {
    fontFamily: font.medium,
    fontSize: 12,
    color: c.textSecondary,
    marginTop: 10,
    marginBottom: 4,
  },
  kindToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 40,
    marginBottom: 8,
    borderRadius: radius.md,
    ...glassSurface(c),
  },
  kindToggleOn: {backgroundColor: c.primary},
  kindCount: {fontFamily: font.semiBold, fontSize: 12, color: c.textSecondary},
  kindCountOn: {color: '#FFFFFF'},
  kindIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: c.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14, padding: 0},
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...glassSurface(c),
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  itemOn: {backgroundColor: c.primaryLight},
  check: {
    width: 22, height: 22, borderRadius: 7,
    borderWidth: 1, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: {backgroundColor: c.primary, borderColor: c.primary},
  itemText: {flex: 1},
  itemName: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary, lineHeight: 18},
  itemMeta: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  itemBranch: {fontFamily: font.regular, fontSize: 11, color: c.warning, marginTop: 2},
  qty: {
    width: 56, height: 36, borderRadius: radius.sm,
    backgroundColor: c.bgPrimary, textAlign: 'center',
    color: c.textPrimary, fontFamily: font.semiBold, fontSize: 14, padding: 0,
  },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 12, paddingTop: 10,
    ...glassOverlay(c),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glassLine(c),
  },
  send: {
    height: 48, borderRadius: radius.md, backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendOff: {opacity: 0.5},
  sendText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', padding: 24, lineHeight: 19},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20},
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    ...glassSurface(c), borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8,
  },
  pickRowOff: {opacity: 0.45},
  blockedTitle: {
    fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary,
    textAlign: 'center', marginTop: 14, marginBottom: 6,
  },
  blockedBtn: {
    marginTop: 20, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: radius.md, ...glassSurface(c),
  },
  blockedBtnText: {fontFamily: font.medium, fontSize: 14, color: c.primary},
  scanModal: {flex: 1, backgroundColor: '#000000'},
  scanClose: {
    position: 'absolute', top: 52, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
});
