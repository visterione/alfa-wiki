/**
 * Открытие описи с телефона.
 *
 * Раньше это было можно только в вебе, и получалось так: человек приходит в
 * кабинет считать имущество, открывает список описей — а он пуст, потому что
 * завести опись должен был кто-то за компьютером. Ходить за этим к столу и
 * возвращаться — ровно та работа, ради отказа от которой модуль и живёт в
 * телефоне.
 *
 * ── Почему область та же, что в вебе (ver. 7.36) ──────────────────────────────
 *
 * До ver. 7.36 здесь можно было выбрать ровно один кабинет и ничего больше: ни
 * несколько кабинетов, ни отделение, ни председателя с МОЛ. То есть опись,
 * заведённая с телефона, отличалась от такой же из веба — и человек, которому
 * нужен был приказ на три кабинета, всё равно шёл к компьютеру. Разница в
 * функциях между экраном в кабинете и экраном за столом — это и есть причина
 * возвращаться за стол, поэтому её здесь не осталось: кабинеты отмечаются
 * пачкой, отделение выбирается целиком, комиссия и основание — в шторке
 * параметров.
 *
 * Порядок при этом обратный вебовскому: там сначала форма, потом область, здесь
 * сначала область, потом — если надо — параметры. В кабинете человек уже знает,
 * что считает, а председателя и основание заполняет один раз на приказ.
 *
 * Кабинеты, где опись уже идёт, из работы не выбывают: по такому предлагается
 * открыть существующий пересчёт. Это тот же самый случай — человек пришёл
 * считать, — и упереться здесь в «тут уже идёт инвентаризация» было бы
 * издевательством.
 *
 * ── Почему отделения больше нет ──────────────────────────────────────────────
 *
 * Опись по отделению осталась в вебе, а с телефона убрана. Она была вкладкой
 * рядом с кабинетами и делила экран надвое: половина инструментов — поиск,
 * сканер, отметки — работала только в одной из них. При этом в кабинет с
 * телефоном приходят считать полки, а не оформлять приказ на отделение
 * целиком: это как раз то распорядительное действие, которое делают за столом.
 *
 * Описи по отделению, заведённые в вебе, экран по-прежнему учитывает: их
 * кабинеты помечаются занятыми, иначе человек отметил бы кабинет, а сервер
 * ответил бы отказом уже после нажатия «Считать».
 *
 * ── Этажи лентой ─────────────────────────────────────────────────────────────
 *
 * Тот же переключатель, что и в списке кабинетов (FloorSwitch): медцентр
 * выбран один на весь раздел, и внутри него нужен не спуск, а сужение — «мне
 * нужен третий этаж». Склады и кабинеты без этажа стоят в ленте наравне с
 * этажами: это такие же места, и попадают в них тем же движением.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, Modal,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {
  ScanLine, Search, X, ClipboardCheck, Check, ChevronRight, Users,
} from 'lucide-react-native';

import {warehouse as warehouseApi, users as usersApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import BottomSheet from '../../components/BottomSheet';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {loadLocationTree, useWarehouseMedCenter, setWarehouseMedCenter} from '../../store/warehouseStore';
import FloorSwitch from './FloorSwitch';
import {flattenRooms, roomMatches} from './warehouseMeta';

const personName = person => person?.displayName || person?.username || 'Сотрудник';

export default function WarehouseInventoryNewScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const device = useCameraDevice('back');

  const [rooms, setRooms] = useState([]);
  const [busyRooms, setBusyRooms] = useState(new Map());
  const {medCenterId} = useWarehouseMedCenter();
  const [picked, setPicked] = useState(() => new Set());
  // Выбранный этаж. Ключ, а не индекс: дерево перечитывается, и порядок групп
  // от этого не гарантирован.
  const [floorKey, setFloorKey] = useState(null);
  const [basis, setBasis] = useState('');
  const [chairmanUserId, setChairmanUserId] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [people, setPeople] = useState([]);
  // Шторка параметров и списки людей живут в одной шторке, сменяя её содержимое:
  // вложенные модалки на обеих платформах ведут себя по-разному, а «назад» из
  // списка людей должен возвращать к параметрам, а не закрывать всё.
  const [sheet, setSheet] = useState(null);
  const [personQ, setPersonQ] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanBusy = useRef(false);

  const load = useCallback(async () => {
    try {
      const [treeData, sessionsResult] = await Promise.all([
        loadLocationTree(),
        warehouseApi.inventorySessions(),
      ]);
      const flat = flattenRooms(treeData);
      setRooms(flat);

      // Занятые кабинеты: и перечисленные в описи, и накрытые описью по
      // отделению. Второе раньше не учитывалось — кабинет выглядел свободным, а
      // сервер отвечал 409 уже после нажатия «Считать».
      const busy = new Map();
      for (const session of sessionsResult.data || []) {
        if (session.status === 'closed' || session.status === 'cancelled') continue;
        const own = session.rooms?.length
          ? session.rooms.map(room => room.id)
          : (session.roomId ? [session.roomId] : []);
        for (const id of own) busy.set(id, session);
        if (session.departmentId) {
          for (const room of flat) {
            if (room.departmentId === session.departmentId && !busy.has(room.id)) {
              busy.set(room.id, session);
            }
          }
        }
      }
      setBusyRooms(busy);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Сотрудники нужны только когда открыли список председателя или МОЛ: под сотню
  // строк, и тянуть их ради экрана, на котором чаще всего просто отмечают
  // кабинеты, незачем.
  useEffect(() => {
    if (sheet !== 'chairman' && sheet !== 'responsible') return;
    if (people.length) return;
    usersApi.listBasic().then(({data}) => setPeople(data || [])).catch(() => setPeople([]));
  }, [sheet, people.length]);

  // Кабинеты выбранного медцентра. В режиме «вся сеть» остаются все — тогда
  // список и вправду про сеть, и заголовок медцентра в нём обязателен.
  const scopeRooms = useMemo(
    () => (medCenterId ? rooms.filter(room => room.medCenterId === medCenterId) : rooms),
    [rooms, medCenterId],
  );

  // Ленту собираем по тем группам, в которых кабинеты действительно есть:
  // пустой этаж в переключателе — кнопка, за которой ничего нет.
  const floors = useMemo(() => {
    const seen = new Map();
    for (const room of scopeRooms) {
      if (seen.has(room.groupKey)) continue;
      seen.set(room.groupKey, {
        key: room.groupKey,
        short: room.groupShort,
        title: room.groupTitle,
        service: room.groupService,
      });
    }
    return [...seen.values()];
  }, [scopeRooms]);

  const floor = floors.find(item => item.key === floorKey) || floors[0] || null;

  /**
   * Список с заголовками медцентра и этажа: выбирают в нём кабинет, но узнают
   * его по месту — номер 305 есть в каждом здании сети.
   *
   * Этаж сужает список, но только пока не ищут: человек, набирающий номер
   * кабинета, ищет его в здании, а не на текущем этаже, и «не нашлось» из-за
   * невыбранного этажа он прочитает как «такого кабинета нет». То же правило,
   * что в списке кабинетов.
   */
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const narrow = !needle && floor;
    const out = [];
    let mc = null;
    let group = null;
    for (const room of scopeRooms) {
      if (!roomMatches(room, needle)) continue;
      if (narrow && room.groupKey !== floor.key) continue;
      if (!medCenterId && room.medCenterId !== mc) {
        mc = room.medCenterId;
        group = null;
        out.push({type: 'mc', key: `mc-${room.medCenterId}`, title: room.medCenterName});
      }
      if (room.groupKey !== group) {
        group = room.groupKey;
        // Заголовок группы не нужен, когда группа в списке одна и её название
        // уже написано на нажатой кнопке ленты.
        if (!narrow) out.push({type: 'group', key: `g-${group}`, title: room.groupTitle});
      }
      out.push({type: 'room', key: `r-${room.id}`, room});
    }
    return out;
  }, [scopeRooms, q, floor, medCenterId]);

  const openExisting = session => navigation.replace('WarehouseInventoryCount', {
    sessionId: session.id,
  });

  const toggleRoom = (room) => {
    const busy = busyRooms.get(room.id);
    if (busy) {
      // Не уводим молча: если человек в этот момент набирает список из восьми
      // кабинетов, прыжок в чужую опись стёр бы всё отмеченное.
      return Alert.alert(
        `Каб. ${room.number} уже пересчитывают`,
        `Опись ${busy.number}. Открыть её?`,
        [
          {text: 'Оставить', style: 'cancel'},
          {text: 'Открыть', onPress: () => openExisting(busy)},
        ],
      );
    }
    return setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(room.id)) next.delete(room.id);
      else next.add(room.id);
      return next;
    });
  };

  const onScan = useCallback(async (code) => {
    setScanning(false);
    try {
      const {data} = await warehouseApi.lookup(String(code || '').trim());
      if (data.kind !== 'room') {
        return Alert.alert('Это не кабинет', 'Отсканируйте QR с двери.');
      }
      const busy = busyRooms.get(data.room.id);
      if (busy) return openExisting(busy);

      /**
       * Кабинет чужого медцентра.
       *
       * Сканеру отбор не указ — код называет конкретную дверь, и человек стоит
       * перед ней. Но отметить кабинет, которого нет в списке, значило бы
       * набирать опись вслепую, поэтому спрашиваем и переключаем весь раздел:
       * молча менять выбранный медцентр — то же самое, что молча его прятать.
       */
      const room = scopeRooms.find(item => item.id === data.room.id);
      if (medCenterId && !room) {
        const found = rooms.find(item => item.id === data.room.id);
        return Alert.alert(
          'Кабинет в другом медцентре',
          `Каб. ${data.room.number} относится к «${found?.medCenterName || 'другому медцентру'}». `
            + 'Переключиться на него?',
          [
            {text: 'Отмена', style: 'cancel'},
            {
              text: 'Переключиться',
              onPress: () => {
                if (found) setWarehouseMedCenter(found.medCenterId);
                setPicked(prev => new Set(prev).add(data.room.id));
              },
            },
          ],
        );
      }

      // Сканирование добавляет к отмеченному, а не заменяет его: обход кабинетов
      // с камерой — самый быстрый способ набрать область из приказа.
      return setPicked(prev => new Set(prev).add(data.room.id));
    } catch {
      return Alert.alert('Не найдено', 'По этому коду кабинета нет.');
    }
  }, [busyRooms, navigation, scopeRooms, rooms, medCenterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      // Один код держится в кадре секундами, а обработчик у vision-camera
      // живёт дольше кадра: без отметки запрос улетал бы на каждый
      // распознанный кадр, пока камера не успела закрыться.
      const value = codes?.[0]?.value;
      if (!value || scanBusy.current) return;
      scanBusy.current = true;
      onScan(value).finally(() => { scanBusy.current = false; });
    },
  });

  const start = async () => {
    const roomIds = [...picked];
    if (!roomIds.length) return;
    setStarting(true);
    try {
      const {data} = await warehouseApi.createInventory({
        roomIds,
        basis: basis.trim() || null,
        chairmanUserId: chairmanUserId || null,
        responsibleUserId: responsibleUserId || null,
      });
      // Сразу в пересчёт, без возврата в список: опись открывают ровно затем,
      // чтобы начать считать, и лишний экран между этими двумя действиями
      // означал бы только лишнее нажатие.
      navigation.replace('WarehouseInventoryCount', {sessionId: data.session.id});
    } catch (e) {
      Alert.alert('Опись не открылась', e?.response?.data?.error || 'Попробуйте ещё раз.');
      setStarting(false);
    }
  };

  if (loading) return <LogoLoader />;

  const chairman = people.find(p => p.id === chairmanUserId);
  const responsible = people.find(p => p.id === responsibleUserId);
  const ready = picked.size > 0;
  // Параметры одной строкой: заполненное показываем, незаполненное не называем —
  // это подпись под кнопкой, а не список полей.
  const paramsText = [
    basis.trim(),
    chairmanUserId ? `председатель ${personName(chairman)}` : null,
    responsibleUserId ? `МОЛ ${personName(responsible)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.root}>
      {/* Этажи и склады — над поиском, как в списке кабинетов: сначала «где»,
          потом «что искать». Панель прячется сама, когда группа одна. */}
      <FloorSwitch floors={floors} value={floor?.key} onChange={setFloorKey} spacing={2} />

      <View style={styles.tools}>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Кабинет"
            placeholderTextColor={c.textTertiary}
            autoCorrect={false}
          />
        </View>
        <Pressable style={styles.scanChip} onPress={() => setScanning(true)} hitSlop={6}>
          <ScanLine size={18} color={c.primary} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + (ready ? 200 : 24),
        }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.none}>Ничего не нашлось</Text>}
        renderItem={({item}) => {
          if (item.type === 'mc') return <Text style={styles.mc}>{item.title}</Text>;
          if (item.type === 'group') return <Text style={styles.group}>{item.title}</Text>;

          const busy = busyRooms.get(item.room.id);
          const on = picked.has(item.room.id);
          return (
            <Pressable
              style={[styles.row, on && styles.rowOn]}
              onPress={() => toggleRoom(item.room)}>
              {/* Квадрат отметки, а не подсветка строки: кабинетов в области
                  бывает восемь, и «сколько я уже отметил» должно читаться
                  списком, а не перечитыванием цветов. */}
              <View style={[styles.check, on && styles.checkOn]}>
                {on && <Check size={13} color="#FFFFFF" />}
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, on && styles.rowTitleOn]}>
                  Кабинет {item.room.number}
                </Text>
                {Boolean(item.room.name) && (
                  <Text style={[styles.rowSub, on && styles.rowSubOn]} numberOfLines={1}>
                    {item.room.name}
                  </Text>
                )}
              </View>
              {Boolean(busy) && (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{busy.number}</Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />

      {ready && (
        <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
          <Pressable style={styles.params} onPress={() => setSheet('params')}>
            <Users size={17} color={c.primary} />
            <View style={styles.rowText}>
              <Text style={styles.paramsTitle}>Основание и комиссия</Text>
              <Text style={styles.paramsSub} numberOfLines={1}>
                {paramsText || 'не заданы — председателем станете вы'}
              </Text>
            </View>
            <ChevronRight size={16} color={c.textTertiary} />
          </Pressable>
          <Pressable
            style={[styles.button, starting && styles.buttonOff]}
            disabled={starting}
            onPress={start}>
            <ClipboardCheck size={17} color="#FFFFFF" />
            <Text style={styles.buttonText}>
              {starting ? 'Открываю…' : `Считать · кабинетов ${picked.size}`}
            </Text>
          </Pressable>
        </View>
      )}

      <BottomSheet
        visible={sheet !== null}
        title={sheet === 'chairman' ? 'Председатель комиссии'
          : sheet === 'responsible' ? 'Материально ответственный'
            : 'Основание и комиссия'}
        onClose={() => { setSheet(null); setPersonQ(''); }}>
        {sheet === 'params' ? (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetCap}>Основание</Text>
            <TextInput
              style={styles.sheetInput}
              value={basis}
              onChangeText={setBasis}
              placeholder="Приказ №…, плановая проверка"
              placeholderTextColor={c.textTertiary}
            />
            <SheetRow
              styles={styles}
              c={c}
              label="Председатель комиссии"
              value={chairmanUserId ? personName(chairman) : 'вы'}
              onPress={() => setSheet('chairman')}
            />
            <SheetRow
              styles={styles}
              c={c}
              label="МОЛ"
              value={responsibleUserId ? personName(responsible) : 'не назначен'}
              onPress={() => setSheet('responsible')}
            />
            <Pressable style={styles.sheetDone} onPress={() => setSheet(null)}>
              <Text style={styles.sheetDoneText}>Готово</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sheetBody}>
            <View style={styles.search}>
              <Search size={15} color={c.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={personQ}
                onChangeText={setPersonQ}
                placeholder="Фамилия или логин"
                placeholderTextColor={c.textTertiary}
                autoCorrect={false}
              />
            </View>
            <FlatList
              style={styles.sheetList}
              data={[
                // Пустой выбор — тоже выбор: председателем по умолчанию
                // становится тот, кто открывает опись, а МОЛ может быть не
                // назначен вовсе.
                {id: '', displayName: sheet === 'chairman' ? 'Вы' : 'Не назначен'},
                ...people.filter(person => {
                  const needle = personQ.trim().toLowerCase();
                  return !needle
                    || `${person.displayName || ''} ${person.username || ''}`
                      .toLowerCase().includes(needle);
                }),
              ]}
              keyExtractor={item => item.id || 'none'}
              keyboardShouldPersistTaps="handled"
              renderItem={({item}) => {
                const current = sheet === 'chairman' ? chairmanUserId : responsibleUserId;
                const on = item.id === current;
                return (
                  <Pressable
                    style={styles.personRow}
                    onPress={() => {
                      if (sheet === 'chairman') setChairmanUserId(item.id);
                      else setResponsibleUserId(item.id);
                      setPersonQ('');
                      setSheet('params');
                    }}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {personName(item)}
                    </Text>
                    {on && <Check size={16} color={c.primary} />}
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={styles.none}>Никого не нашлось</Text>}
            />
          </View>
        )}
      </BottomSheet>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.camera}>
          {Boolean(device) && (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={scanning}
              codeScanner={codeScanner}
            />
          )}
          <Pressable
            style={[styles.cameraClose, {top: insets.top + 8}]}
            onPress={() => setScanning(false)}
            hitSlop={10}>
            <X size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.frame} pointerEvents="none" />
        </View>
      </Modal>
    </View>
  );
}

/** Строка шторки параметров: подпись слева, выбранное справа. */
function SheetRow({styles, c, label, value, onPress}) {
  return (
    <Pressable style={styles.sheetRow} onPress={onPress}>
      <Text style={styles.sheetRowLabel}>{label}</Text>
      <Text style={styles.sheetRowValue} numberOfLines={1}>{value}</Text>
      <ChevronRight size={15} color={c.textTertiary} />
    </Pressable>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary, paddingTop: 12},
  // Верхний отступ теперь на самом экране: первой идёт лента этажей, а она,
  // как и в списке кабинетов, своего отступа сверху не держит.
  tools: {flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, marginTop: 10, marginBottom: 10},
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14},
  scanChip: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mc: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary, marginTop: 18, marginBottom: 4},
  group: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary, marginTop: 8, marginBottom: 4},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
  },
  rowOn: {backgroundColor: c.primary},
  check: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {backgroundColor: 'rgba(255,255,255,0.25)', borderColor: '#FFFFFF'},
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  rowTitleOn: {color: '#FFFFFF'},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  rowSubOn: {color: 'rgba(255,255,255,0.8)'},
  // Номер идущей описи вместо слов: он же напечатан в шапке пересчёта, и по
  // нему видно, что нажатие откроет уже существующую опись, а не заведёт новую.
  chip: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {fontFamily: font.medium, fontSize: 11, color: c.textSecondary},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 40},
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  params: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  paramsTitle: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
  paramsSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
  },
  buttonOff: {opacity: 0.5},
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  sheetBody: {paddingHorizontal: 20, paddingBottom: 12, gap: 10},
  sheetCap: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  sheetInput: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.bgSecondary,
    paddingHorizontal: 12,
    color: c.textPrimary,
    fontFamily: font.regular,
    fontSize: 14,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 46,
  },
  sheetRowLabel: {flex: 1, fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
  sheetRowValue: {
    maxWidth: '45%',
    fontFamily: font.medium,
    fontSize: 13,
    color: c.textSecondary,
  },
  sheetDone: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  sheetDoneText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  // Высота списка людей фиксирована: шторка иначе прыгает от каждой буквы в
  // поиске — то в половину экрана, то в три строки.
  sheetList: {height: 320},
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  personName: {flex: 1, fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
  camera: {flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center'},
  cameraClose: {
    position: 'absolute',
    left: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
});
