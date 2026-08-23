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
 * ── Почему количество можно не вводить ───────────────────────────────────────
 *
 * В девяти случаях из десяти позиция целиком лежит там, где на неё смотрят.
 * Пустое поле означает «весь нераспределённый остаток», и это снимает ввод
 * цифры с большинства строк.
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
 * Теперь запрос несёт флаг materialize, и сервер сразу разбирает ровно тот
 * кабинет, который разложили. Это безопасно: разбор идемпотентен и считает уже
 * созданное, поэтому повторный прогон ничего не задваивает, а сужение до одного
 * кабинета не трогает остальную ведомость. Общий разбор в вебе никуда не делся —
 * он про проверку решений словаря по всей ведомости целиком.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, Modal,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {
  DoorOpen, ScanLine, Search, X, Check, Package, Boxes, Building2, ChevronRight, ChevronLeft,
} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {loadLocationTree} from '../../store/warehouseStore';
import {qtyText, moneyText, flattenRooms, roomMatches} from './warehouseMeta';
import {ROOT_KEY, buildNodes, leavesOf, resolveNode} from './locationTree';

export default function WarehousePlacementScreen() {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
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

  const room = useMemo(
    () => flattenRooms(tree).find(item => item.id === roomId),
    [tree, roomId],
  );

  const load = useCallback(async () => {
    try {
      const [treeData, queueResult] = await Promise.all([
        loadLocationTree(),
        warehouseApi.placementQueue({limit: 200, mode: 'all'}),
      ]);
      setTree(treeData);
      setQueue(queueResult.data);
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
      else next.set(item.lineKey, '');
      return next;
    });
  };

  const send = async () => {
    if (!roomId || !picked.size) return;
    setSending(true);
    try {
      const {data} = await warehouseApi.placeItems({
        roomId,
        // Разбираем кабинет тут же: без этого раскладка остаётся намерением, а
        // баланс кабинета — нулевым до общего прогона из веба.
        materialize: true,
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

      Alert.alert(
        data.rejected?.length || made?.failed ? 'Размещено с оговорками' : 'Готово',
        lines.join('\n'),
      );
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

  return (
    <View style={styles.root}>
      <Pressable style={styles.roomBar} onPress={() => { setRoomId(null); setPicked(new Map()); }}>
        <DoorOpen size={18} color={c.primary} />
        <View style={styles.roomText}>
          <Text style={styles.roomName}>{room ? room.label : 'Кабинет'}</Text>
          <Text style={styles.roomWhere}>{room ? room.where : 'сменить'}</Text>
        </View>
        <Text style={styles.roomChange}>сменить</Text>
      </Pressable>

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
                  placeholder={qtyText(item.unplacedQty)}
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
 * Шаг выбора кабинета: медцентр → корпус → этаж → кабинет.
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
function RoomStep({tree, styles, c, insets, onScan, onPick, scanning, onCloseScan, onFound}) {
  const [nodeKey, setNodeKey] = useState(ROOT_KEY);
  const [q, setQ] = useState('');

  const nodes = useMemo(() => buildNodes(tree), [tree]);
  const node = useMemo(() => resolveNode(nodes, nodeKey), [nodes, nodeKey]);

  // На экране медцентра корпус выбирается не отдельным шагом, а сразу списком
  // этажей всех его корпусов: под корпусом обычно два-три этажа, и разбивать
  // это на два экрана дороже, чем показать разом.
  const groups = useMemo(() => {
    if (!node) return [];
    const needle = q.trim().toLowerCase();
    return leavesOf(node)
      .map(leaf => ({leaf, rooms: leaf.rooms.filter(room => roomMatches(room, needle))}))
      .filter(group => group.rooms.length);
  }, [node, q]);

  // Плоский список кабинетов — когда ищут или когда дошли до этажа
  const flat = Boolean(q.trim()) || !node?.children;

  const items = flat
    ? groups.flatMap(({leaf, rooms}) => [
      ...(groups.length > 1 ? [{type: 'group', key: `g-${leaf.key}`, title: leaf.path || leaf.title}] : []),
      ...rooms.map(room => ({type: 'room', key: `r-${room.id}`, room})),
    ])
    : (node?.children || []).map(child => ({type: 'node', key: `n-${child.key}`, node: child}));

  return (
    <View style={styles.root}>
      <Pressable style={styles.scanWide} onPress={onScan}>
        <ScanLine size={20} color="#FFFFFF" />
        <Text style={styles.scanWideText}>QR-код</Text>
      </Pressable>

      {/* Возврат на уровень выше. Своей шапки у шага нет — он живёт внутри
          экрана размещения, и системная стрелка «назад» увела бы из него совсем. */}
      {nodeKey !== ROOT_KEY && (
        <Pressable style={styles.up} onPress={() => { setNodeKey(ROOT_KEY); setQ(''); }}>
          <ChevronLeft size={16} color={c.primary} />
          <Text style={styles.upText}>Все медцентры</Text>
        </Pressable>
      )}

      <View style={styles.stepSearch}>
        <Search size={15} color={c.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder={node?.kind === 'root' ? 'Кабинет по всей сети' : 'Кабинет'}
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
            return (
              <Pressable style={styles.pickRow} onPress={() => setNodeKey(item.node.key)}>
                <Building2 size={17} color={c.primary} />
                <View style={styles.itemText}>
                  <Text style={styles.itemName}>{item.node.title}</Text>
                  {Boolean(item.node.subtitle) && (
                    <Text style={styles.itemMeta} numberOfLines={1}>{item.node.subtitle}</Text>
                  )}
                </View>
                <Text style={styles.itemMeta}>{item.node.counts.rooms}</Text>
                <ChevronRight size={16} color={c.textTertiary} />
              </Pressable>
            );
          }

          const {room} = item;
          const hasStorage = Boolean(room.storages?.length);
          return (
            <Pressable
              style={[styles.pickRow, !hasStorage && styles.pickRowOff]}
              disabled={!hasStorage}
              onPress={() => onPick(room.id)}>
              <DoorOpen size={17} color={c.primary} />
              <View style={styles.itemText}>
                <Text style={styles.itemName}>Кабинет {room.number}</Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {[room.name, !hasStorage && 'нет мест хранения'].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      {scanning && <RoomScanner styles={styles} onClose={onCloseScan} onFound={onFound} />}
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
  scanModal: {flex: 1, backgroundColor: '#000000'},
  scanClose: {
    position: 'absolute', top: 52, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
});
