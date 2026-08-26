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
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, Image, FlatList, ScrollView, TextInput, Pressable, StyleSheet,
  Alert, Modal,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {
  DoorOpen, ScanLine, Search, X, Check, Package, Boxes, Building2,
  ChevronRight, ChevronLeft, Printer, ClipboardList,
} from 'lucide-react-native';

import CONFIG from '../../config';
import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {loadLocationTree, useWarehouseCan} from '../../store/warehouseStore';
import {qtyText, moneyText, flattenRooms, roomMatches, roomText} from './warehouseMeta';
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

  const load = useCallback(async () => {
    try {
      const [treeData, queueResult, frozenResult] = await Promise.all([
        loadLocationTree(),
        warehouseApi.placementQueue({limit: 200, mode: 'all'}),
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
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (queue?.items || [])
      .filter(i => kind === 'all' || i.kind === kind)
      .filter(i => !needle || i.name.toLowerCase().includes(needle)
        || String(i.pathText || '').toLowerCase().includes(needle));
  }, [queue, q, kind]);

  // Счётчики на чипах считаются по всей очереди, а не по видимому списку: чип
  // «Материалы (0)» отвечает на вопрос раньше, чем по нему нажмут.
  const counts = useMemo(() => {
    const list = queue?.items || [];
    return {
      all: list.length,
      asset: list.filter(i => i.kind === 'asset').length,
      material: list.filter(i => i.kind === 'material').length,
    };
  }, [queue]);

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
  const [nodeKey, setNodeKey] = useState(ROOT_KEY);
  // Выбранный этаж; null означает «все этажи» и стоит по умолчанию.
  const [floorKey, setFloorKey] = useState(null);
  const [q, setQ] = useState('');

  const nodes = useMemo(() => buildNodes(tree), [tree]);
  const node = useMemo(() => resolveNode(nodes, nodeKey), [nodes, nodeKey]);

  // Этажи — лентой над списком, а не уровнем спуска: ровно как в разделе
  // «Кабинеты» (ver. 7.50). Раскладка это обход здания, и человек, стоящий в
  // кабинете, ищет его номер, а не путь до него.
  const floors = node?.kind === 'mc' ? node.children : null;
  const floor = floors && floorKey ? floors.find(item => item.key === floorKey) : null;
  const listNode = floor || node;

  const groups = useMemo(() => {
    if (!listNode) return [];
    const needle = q.trim().toLowerCase();
    return leavesOf(listNode)
      .map(leaf => ({leaf, rooms: leaf.rooms.filter(room => roomMatches(room, needle))}))
      .filter(group => group.rooms.length);
  }, [listNode, q]);

  const flat = node?.kind !== 'root' || Boolean(q.trim());

  const items = flat
    ? groups.flatMap(({leaf, rooms}) => [
      ...(groups.length > 1 ? [{type: 'group', key: `g-${leaf.key}`, title: leaf.path || leaf.title}] : []),
      ...rooms.map(room => ({type: 'room', key: `r-${room.id}`, room})),
    ])
    : (listNode?.children || []).map(child => ({type: 'node', key: `n-${child.key}`, node: child}));

  return (
    <View style={styles.root}>
      <Pressable style={styles.scanWide} onPress={onScan}>
        <ScanLine size={20} color="#FFFFFF" />
        <Text style={styles.scanWideText}>QR-код</Text>
      </Pressable>

      {/* Возврат на уровень выше. Своей шапки у шага нет — он живёт внутри
          экрана размещения, и системная стрелка «назад» увела бы из него совсем. */}
      {nodeKey !== ROOT_KEY && (
        <Pressable
          style={styles.up}
          onPress={() => { setNodeKey(ROOT_KEY); setFloorKey(null); setQ(''); }}>
          <ChevronLeft size={16} color={c.primary} />
          <Text style={styles.upText}>Все медцентры</Text>
        </Pressable>
      )}

      {/* Лента этажей: одно касание сужает список, второе по «Все» возвращает
          его целиком. Прежде здесь стоял выпадающий список — два касания и
          спрятанные этажи, кроме первого. */}
      {floors?.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.floorBar}
          keyboardShouldPersistTaps="handled">
          <Pressable
            style={[styles.floorChip, !floorKey && styles.floorChipOn]}
            onPress={() => setFloorKey(null)}>
            <Text style={[styles.floorChipText, !floorKey && styles.floorChipTextOn]}>Все</Text>
          </Pressable>
          {floors.map(item => (
            <Pressable
              key={item.key}
              style={[styles.floorChip, floorKey === item.key && styles.floorChipOn]}
              onPress={() => setFloorKey(prev => (prev === item.key ? null : item.key))}>
              <Text
                style={[styles.floorChipText, floorKey === item.key && styles.floorChipTextOn]}
                numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.floorChipCount, floorKey === item.key && styles.floorChipTextOn]}>
                {item.counts.rooms}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={styles.stepSearch}>
        <Search size={15} color={c.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder={listNode?.kind === 'root' ? 'Кабинет по всей сети' : 'Кабинет'}
          placeholderTextColor={c.textTertiary}
        />
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
          return (
            <Pressable
              style={[styles.pickRow, blocked && styles.pickRowOff]}
              disabled={blocked}
              onPress={() => onPick(room.id)}>
              {counting
                ? <ClipboardList size={17} color={c.textTertiary} />
                : <DoorOpen size={17} color={c.primary} />}
              <View style={styles.itemText}>
                <Text style={styles.itemName}>{roomText(room)}</Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {[
                    room.name,
                    counting && `идёт инвентаризация ${counting}`,
                    !hasStorage && 'нет мест хранения',
                  ].filter(Boolean).join(' · ')}
                </Text>
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
      <View style={styles.scanModal}>
        {device && (
          <Camera style={StyleSheet.absoluteFill} device={device} isActive codeScanner={codeScanner} />
        )}
        <Pressable style={styles.scanClose} onPress={onClose} hitSlop={10}>
          <X size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  roomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
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
  scanWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    margin: 12,
    marginBottom: 10,
    borderRadius: radius.lg,
    backgroundColor: c.primary,
  },
  scanWideText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
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
    backgroundColor: c.bgPrimary,
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
    backgroundColor: c.bgPrimary,
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
  floorBar: {paddingHorizontal: 12, paddingBottom: 8, gap: 8},
  floorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.bgPrimary, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  floorChipOn: {backgroundColor: c.primary},
  floorChipText: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
  floorChipCount: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary},
  floorChipTextOn: {color: '#FFFFFF'},
  up: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  upText: {fontFamily: font.medium, fontSize: 13, color: c.primary},
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
    backgroundColor: c.bgPrimary,
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
    backgroundColor: c.bgPrimary,
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
    backgroundColor: c.bgPrimary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  send: {
    height: 48, borderRadius: radius.md, backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendOff: {opacity: 0.5},
  sendText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', padding: 24, lineHeight: 19},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20},
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: c.bgPrimary, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8,
  },
  pickRowOff: {opacity: 0.45},
  blockedTitle: {
    fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary,
    textAlign: 'center', marginTop: 14, marginBottom: 6,
  },
  blockedBtn: {
    marginTop: 20, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: radius.md, backgroundColor: c.bgPrimary,
  },
  blockedBtnText: {fontFamily: font.medium, fontSize: 14, color: c.primary},
  scanModal: {flex: 1, backgroundColor: '#000000'},
  scanClose: {
    position: 'absolute', top: 52, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
});
