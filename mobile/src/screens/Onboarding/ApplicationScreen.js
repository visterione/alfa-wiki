/**
 * Карточка заявки на телефоне.
 *
 * Разложена по вкладкам так же, как в вебе, но их пять, а не шесть: чек-лист
 * переехал в «Задачи». В вебе он стоит отдельно, потому что там есть место; на
 * телефоне шестой ярлык не влезал в строку, а по смыслу чек-лист и есть те же
 * задачи, только взглядом сверху — «что уже позади».
 *
 * Что человек здесь увидит, решает сервер: анкета приходит уже урезанной под
 * его шаг, и маркетологу СНИЛС не отдаётся вовсе, а не прячется стилями.
 * Поэтому экран рисует то, что приехало, и ничего не фильтрует сам.
 */
import React, {useCallback, useEffect, useLayoutEffect, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Alert,
  Linking,
  Image,
} from 'react-native';
import {Check, Circle, FileText, Search, X} from 'lucide-react-native';

import {onboarding as onboardingApi} from '../../services/api';
import SwipeTabs from '../../components/SwipeTabs';
import LogoLoader from '../../components/LogoLoader';
import MediaViewer from '../../components/MediaViewer';
import Avatar from '../../components/Avatar';
import CONFIG from '../../config';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {refreshOnboardingBadge} from '../../store/onboardingStore';
import {
  professionsText, statusColor, dateTime, dateRu, timeOf, groupByDay,
  eventLabel, eventTone, eventDetails, fieldText, repeatRow, withProtocol,
  formatPhone, fileSizeText, FILE_KINDS,
} from './onboardingMeta';

/**
 * Геометрия ленты процесса. Числа связаны между собой, поэтому заданы здесь, а
 * не россыпью по стилям: шаг задаёт ширину гнезда, а линия между точками
 * считается из шага и диаметра кружка.
 */
const TL_STEP = 78;
const TL_DOT = 16;

const TABS = [
  {key: 'cv', label: 'Анкета'},
  {key: 'files', label: 'Файлы'},
  {key: 'tasks', label: 'Задачи'},
  {key: 'services', label: 'Услуги'},
  {key: 'log', label: 'Журнал'},
];

export default function ApplicationScreen({route, navigation}) {
  const {applicationId} = route.params;
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [data, setData] = useState(null);
  const [tab, setTab] = useState('cv');
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState(null);
  const [media, setMedia] = useState(null);

  const load = useCallback(() => onboardingApi.application(applicationId)
    .then(({data: res}) => setData(res))
    .catch(error => {
      Alert.alert('Ошибка', error.response?.data?.error || 'Не удалось открыть заявку');
      navigation.goBack();
    }), [applicationId, navigation]);

  useEffect(() => { load(); }, [load]);

  // Услуги грузим при переходе на вкладку, а не сразу: список бывает на
  // несколько сотен позиций, и большинству открывших карточку он не нужен
  useEffect(() => {
    if (tab !== 'services' || services) return;
    onboardingApi.services(applicationId)
      .then(({data: res}) => setServices(res))
      .catch(() => setServices({error: true}));
  }, [tab, services, applicationId]);

  const app = data?.application;

  useLayoutEffect(() => {
    navigation.setOptions({title: app?.fullName || route.params?.title || 'Заявка'});
  }, [navigation, app?.fullName, route.params?.title]);

  /**
   * Общая обёртка над действием: заявку после него надо перечитать целиком.
   * Точечно поправить состояние нельзя — одно нажатие «Готово» двигает процесс:
   * закрывает шаг, открывает следующий, меняет стадию и чек-лист.
   */
  const after = useCallback(async okText => {
    await load();
    // Задача могла быть последней — бейдж в колесе обязан погаснуть сразу
    refreshOnboardingBadge();
    if (okText) Alert.alert('Готово', okText);
  }, [load]);

  const act = useCallback(async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      await after(okText);
    } catch (error) {
      Alert.alert('Не получилось', error.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  }, [after]);

  if (!data) return <LogoLoader />;

  const tone = statusColor(app.status, c);
  // Токен доступа к файлам: заголовок Authorization в <Image> не выставить,
  // поэтому право предъявляется параметром ?t= (backend/services/fileAccess.js)
  const fileHref = file =>
    `${CONFIG.BASE_URL}${file.url}${data.fileToken ? `?t=${encodeURIComponent(data.fileToken)}` : ''}`;

  return (
    <>
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Text style={styles.headName}>{app.fullName || 'Без имени'}</Text>
          <Text style={styles.headSub}>
            {professionsText(app.professions)}
            {data.medCenter?.name ? ` · ${data.medCenter.name}` : ''}
          </Text>
          <View style={[styles.stageChip, {backgroundColor: `${tone}22`}]}>
            <Text style={[styles.stageChipText, {color: tone}]}>
              {data.stage.label}
            </Text>
          </View>
        </View>

        <Timeline points={data.timeline} status={app.status} label={data.statusLabel} />

        <SwipeTabs tabs={TABS} value={tab} onChange={setTab} style={styles.tabs}>
          <CvTab
            data={data}
            busy={busy}
            act={act}
            fileHref={fileHref}
            onPhoto={item => setMedia(item)}
          />
          <FilesTab files={app.files} fileHref={fileHref} onOpen={setMedia} />
          <TasksTab
            data={data}
            busy={busy}
            act={act}
            after={after}
            setBusy={setBusy}
            applicationId={applicationId}
          />
          <ServicesTab services={services} />
          <JournalTab events={data.events} tasks={data.tasks} />
        </SwipeTabs>
      </ScrollView>

      <MediaViewer
        visible={!!media}
        items={media ? [media] : []}
        initialIndex={0}
        onClose={() => setMedia(null)}
      />
    </>
  );
}

/**
 * Лента процесса. Горизонтальная и прокручиваемая: шагов до десяти, в ширину
 * телефона они не помещаются, а свернуть их в «3 из 8» значит потерять главное
 * — какие именно шаги позади.
 */
function Timeline({points = [], status, label}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const off = ['rejected', 'cancelled', 'revision'].includes(status);

  if (off) {
    const tone = status === 'revision' ? c.warning : c.error;
    return (
      <View style={[styles.timelineOff, {backgroundColor: `${tone}18`, borderColor: `${tone}55`}]}>
        <Text style={[styles.timelineOffText, {color: tone}]}>{label}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.timeline}>
      {points.map((point, i) => {
        const colour = point.state === 'done' ? c.success
          : point.state === 'current' ? c.primary
          : c.bgTertiary;
        return (
          <View key={point.key} style={styles.tlPoint}>
            {/* Линия к предыдущей точке рисуется у самой точки, а не между:
                у прокручиваемой ленты «между» некуда положить */}
            {i > 0 && <View style={styles.tlLine} />}
            <View style={[styles.tlDot, {backgroundColor: colour}]}>
              {point.state === 'done' && <Check size={9} color="#FFFFFF" strokeWidth={3} />}
            </View>
            <Text
              style={[styles.tlLabel, point.state === 'current' && {color: c.primary, fontFamily: font.semiBold}]}
              numberOfLines={2}>
              {point.label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── Анкета ──────────────────────────────────────────────────────────────────

/**
 * Анкета документом, а не парами «ключ — значение».
 *
 * Раньше в вебе это был список настроек, и человек, решающий допуск, читал его
 * как таблицу. Здесь то же самое собрано документом: шапка с фото и именем,
 * дальше разделы. Разделы приходят с сервера из той же схемы, по которой
 * рисуется сама анкета, — раздел, добавленный в форму, появится тут сам.
 */
function CvTab({data, busy, act, fileHref, onPhoto}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const app = data.application;
  const form = app.form || {};
  const labels = data.labels || {};
  const photo = (app.files || []).find(f => f.kind === 'photo');

  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');

  const sections = (data.sections || [])
    .map(section => ({
      ...section,
      rows: section.repeat
        ? (form[section.key] || []).filter(row => Object.values(row).some(Boolean))
        : section.fields
          .map(field => ({
            key: field.key,
            label: labels[field.key] || field.key,
            value: fieldText(field.type, form[field.key]),
          }))
          .filter(row => row.value !== ''),
    }))
    .filter(section => section.rows.length);

  const meta = [
    data.medCenter && ['Филиал', data.medCenter.name],
    app.startDate && ['Выход на работу', dateRu(app.startDate)],
    form.birthDate && ['Дата рождения', dateRu(form.birthDate)],
    app.phone && ['Телефон', formatPhone(app.phone)],
    app.email && ['Почта', app.email],
  ].filter(Boolean);

  const submit = (fn, okText) => {
    act(fn, okText).then(() => { setMode(null); setNote(''); });
  };

  return (
    <View style={styles.pane}>
      <View style={styles.cvHead}>
        {photo ? (
          <Pressable
            onPress={() => onPhoto({
              url: fileHref(photo),
              name: photo.originalName || 'Фото',
              mimeType: photo.mimeType || 'image/jpeg',
              galleryKey: `photo:${photo.id}`,
            })}>
            <Image source={{uri: fileHref(photo)}} style={styles.cvPhoto} />
          </Pressable>
        ) : (
          <Avatar uri={null} size={72} />
        )}
        <View style={styles.cvIdent}>
          <Text style={styles.cvName}>{app.fullName || 'Имя не указано'}</Text>
          {Boolean((app.professions || []).length) && (
            <Text style={styles.cvProf}>{app.professions.map(p => p.name).join(' · ')}</Text>
          )}
          <Text style={styles.cvStamp}>от {dateRu(app.submittedAt || app.createdAt)}</Text>
        </View>
      </View>

      {Boolean(meta.length) && (
        <View style={styles.card}>
          {meta.map(([label, value], i) => (
            <View key={label} style={[styles.pair, i > 0 && styles.pairNext]}>
              <Text style={styles.pairLabel}>{label}</Text>
              <Text style={styles.pairValue} selectable>{value}</Text>
            </View>
          ))}
        </View>
      )}

      {sections.map(section => (
        <View key={section.key} style={styles.sect}>
          <Text style={styles.sectTitle}>{section.title}</Text>
          <View style={styles.card}>
            {section.repeat
              ? section.rows.map((row, i) => {
                const parts = repeatRow(section.key, row);
                return (
                  <View key={i} style={[styles.repeatRow, i > 0 && styles.pairNext]}>
                    <Text style={styles.repeatLead}>{parts.lead}</Text>
                    <View style={styles.repeatBody}>
                      {parts.url ? (
                        <Text
                          style={styles.repeatLink}
                          onPress={() => Linking.openURL(withProtocol(parts.url))}>
                          {parts.title}
                        </Text>
                      ) : (
                        <Text style={styles.repeatTitle}>{parts.title}</Text>
                      )}
                      {Boolean(parts.tail) && <Text style={styles.repeatTail}>{parts.tail}</Text>}
                    </View>
                  </View>
                );
              })
              : section.rows.map((row, i) => (
                <View key={row.key} style={[styles.pair, i > 0 && styles.pairNext]}>
                  <Text style={styles.pairLabel}>{row.label}</Text>
                  <Text style={styles.pairValue} selectable>{row.value}</Text>
                </View>
              ))}
          </View>
        </View>
      ))}

      {!sections.length && (
        <Text style={styles.empty}>Для вашего шага сведений из анкеты не требуется.</Text>
      )}

      {/* Решение главврача. Приходит правом с сервера и только пока заявка
          ждёт согласования — кнопок «согласовать» на уже согласованной нет */}
      {data.permissions.canDecide && (
        <View style={styles.sect}>
          <Text style={styles.sectTitle}>Решение</Text>

          {mode && (
            <TextInput
              style={styles.textarea}
              autoFocus
              multiline
              placeholder={mode === 'revision' ? 'Что поправить' : 'Причина отклонения'}
              placeholderTextColor={c.textTertiary}
              value={note}
              onChangeText={setNote}
            />
          )}

          <View style={styles.acts}>
            {!mode && (
              <>
                <Btn
                  label="Согласовать"
                  kind="primary"
                  disabled={busy}
                  onPress={() => submit(() => onboardingApi.approve(app.id), 'Согласовано')}
                />
                <Btn label="На доработку" onPress={() => setMode('revision')} />
                <Btn label="Отклонить" kind="danger" onPress={() => setMode('reject')} />
              </>
            )}
            {mode === 'revision' && (
              <Btn
                label="Отправить врачу"
                kind="primary"
                disabled={busy || !note.trim()}
                onPress={() => submit(() => onboardingApi.revision(app.id, {note}), 'Отправлено врачу')}
              />
            )}
            {mode === 'reject' && (
              <Btn
                label="Отклонить"
                kind="danger"
                disabled={busy || !note.trim()}
                onPress={() => submit(() => onboardingApi.reject(app.id, {reason: note}), 'Отклонено')}
              />
            )}
            {mode && <Btn label="Отмена" onPress={() => { setMode(null); setNote(''); }} />}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Файлы ───────────────────────────────────────────────────────────────────

/**
 * Файлы, сгруппированные по типу.
 *
 * Врач присылает их по отдельности и каждый под своим вопросом, так что тип у
 * нас есть — надо было просто его показать. Иначе это три строки вида
 * «IMG_2481.jpg», и где портрет, а где диплом, видно только после открытия.
 */
function FilesTab({files = [], fileHref, onOpen}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (!files.length) {
    return <Text style={styles.empty}>К заявке не приложено файлов</Text>;
  }

  const known = new Set(FILE_KINDS.map(k => k.key));
  const groups = FILE_KINDS
    .map(kind => ({...kind, items: files.filter(f => f.kind === kind.key)}))
    .filter(group => group.items.length);
  // Тип, которого нет в списке, всё равно показываем — иначе файл просто
  // исчезнет из карточки, и никто этого не заметит
  const rest = files.filter(f => !known.has(f.kind));
  if (rest.length) groups.push({key: 'other', title: 'Прочее', items: rest});

  return (
    <View style={styles.pane}>
      {groups.map(group => (
        <View key={group.key} style={styles.sect}>
          <Text style={styles.sectTitle}>{group.title}</Text>
          <View style={styles.fileGrid}>
            {group.items.map(file => {
              const href = fileHref(file);
              const isImage = (file.mimeType || '').startsWith('image/');
              return (
                <Pressable
                  key={file.id}
                  style={styles.fileCard}
                  onPress={() => (isImage
                    ? onOpen({
                      url: href,
                      name: file.originalName || file.filename,
                      mimeType: file.mimeType,
                      galleryKey: `file:${file.id}`,
                    })
                    // PDF и всё прочее отдаём системе: своей читалки в мобилке
                    // нет, а системная умеет и листать, и сохранять
                    : Linking.openURL(href).catch(() => {
                      Alert.alert('Не открылось', 'Нет приложения, которое покажет этот файл');
                    }))}>
                  {isImage ? (
                    <Image source={{uri: href}} style={styles.fileThumb} />
                  ) : (
                    <View style={[styles.fileThumb, styles.fileThumbStub]}>
                      <FileText size={26} color={c.textTertiary} />
                    </View>
                  )}
                  <Text style={styles.fileName} numberOfLines={1}>
                    {file.originalName || file.filename}
                  </Text>
                  <Text style={styles.fileSize}>{fileSizeText(file.size)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Задачи и чек-лист ───────────────────────────────────────────────────────

function TasksTab({data, busy, act, after, setBusy, applicationId}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [picker, setPicker] = useState(null);
  const [cancelNote, setCancelNote] = useState(null);

  /**
   * Закрыть задачу.
   *
   * Здесь не общий act, а свой разбор ошибки: сверка с МИС не сходится сплошь и
   * рядом по бытовым причинам — фамилия записана через «ё», специальность
   * поставили не ту, завели в соседнюю клинику. Для шага с учётной записью это
   * не тупик, а повод предложить выбрать сотрудника руками, и показывать вместо
   * этого «не получилось» значило бы упереться там, где выход есть.
   */
  const complete = async (task, misUserId) => {
    setBusy(true);
    try {
      const {data: res} = await onboardingApi.completeTask(task.id, {misUserId});
      // Сервер отвечает 200 с ok: false, когда шаг не прошёл проверку, —
      // это не сбой связи, а результат
      if (res.ok === false) throw Object.assign(new Error(res.reason), {body: res});
      setPicker(null);
      await after('Задача закрыта');
    } catch (error) {
      const body = error.body || error.response?.data;
      const reason = body?.reason || body?.error || error.message || 'Не удалось закрыть задачу';
      if (task.stepKey === 'mis_account') {
        setPicker({taskId: task.id, reason, list: body?.candidates || null});
      } else {
        Alert.alert('Не получилось', reason);
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async task => {
    try {
      const {data: res} = await onboardingApi.verifyTask(task.id, {});
      Alert.alert(res.ok ? 'Найдено в МИС' : 'Не сошлось', res.ok ? '' : res.reason || '');
    } catch (error) {
      Alert.alert('Ошибка', error.response?.data?.error || 'МИС не ответила');
    }
  };

  const done = data.checklist.filter(i => i.done).length;

  return (
    <View style={styles.pane}>
      {data.tasks.map(task => (
        <View
          key={task.id}
          style={[styles.task, task.overdue && styles.taskLate, task.completedAt && styles.taskDone]}>
          <View style={styles.taskHead}>
            {task.completedAt
              ? <Check size={15} color={c.success} strokeWidth={2.4} />
              : <Circle size={15} color={c.border} strokeWidth={1.6} />}
            <Text style={styles.taskTitle}>{task.title}</Text>
          </View>

          {!task.completedAt && task.dueAt && (
            <Text style={[styles.taskMeta, task.overdue && {color: c.error}]}>
              срок {dateTime(task.dueAt)}
            </Text>
          )}
          {task.completedAt && task.completer && (
            <Text style={styles.taskMeta}>
              {task.completer.displayName}{task.verifiedByMis ? ' · сверено с МИС' : ''}
            </Text>
          )}
          {!task.completedAt && task.claimer && (
            <Text style={styles.taskMeta}>взял: {task.claimer.displayName}</Text>
          )}

          {!task.completedAt && task.mine && (
            <View style={styles.acts}>
              {task.requiresClaim && !task.claimedBy ? (
                <Btn
                  label="Взять"
                  kind="primary"
                  disabled={busy}
                  onPress={() => act(() => onboardingApi.claimTask(task.id), 'Задача за вами')}
                />
              ) : (
                <>
                  {task.verify === 'mis' && (
                    <Btn label="Сверить с МИС" disabled={busy} onPress={() => verify(task)} />
                  )}
                  <Btn label="Готово" kind="primary" disabled={busy} onPress={() => complete(task)} />
                </>
              )}
            </View>
          )}

          {picker?.taskId === task.id && (
            <MisPicker
              applicationId={applicationId}
              reason={picker.reason}
              candidates={picker.list}
              busy={busy}
              onPick={misUserId => complete(task, misUserId)}
              onClose={() => setPicker(null)}
            />
          )}
        </View>
      ))}

      {!data.tasks.length && <Text style={styles.empty}>Задач ещё нет</Text>}

      <View style={styles.sect}>
        <Text style={styles.sectTitle}>Чек-лист · {done} из {data.checklist.length}</Text>
        <View style={styles.card}>
          {data.checklist.map((item, i) => (
            <View key={item.key} style={[styles.checkRow, i > 0 && styles.pairNext]}>
              {item.done
                ? <Check size={15} color={c.success} strokeWidth={2.4} />
                : <Circle size={15} color={c.border} strokeWidth={1.6} />}
              <Text style={[styles.checkText, item.done && styles.checkTextDone]}>{item.title}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Отмена процесса. Причина вписывается полем прямо здесь, а не в
          системном диалоге: Alert.prompt существует только на iOS, и на
          Android кнопка вела бы в никуда. Причина обязательна — она уходит в
          журнал и остаётся единственным объяснением, почему заявку свернули. */}
      {data.permissions.canManage && !['cancelled', 'rejected'].includes(data.application.status) && (
        <View style={styles.sect}>
          {cancelNote !== null && (
            <TextInput
              style={styles.textarea}
              autoFocus
              multiline
              placeholder="Причина отмены"
              placeholderTextColor={c.textTertiary}
              value={cancelNote}
              onChangeText={setCancelNote}
            />
          )}
          <View style={styles.acts}>
            {cancelNote === null ? (
              <Btn label="Отменить процесс" kind="danger" onPress={() => setCancelNote('')} />
            ) : (
              <>
                <Btn
                  label="Отменить процесс"
                  kind="danger"
                  disabled={busy || !cancelNote.trim()}
                  onPress={() => act(
                    () => onboardingApi.cancel(applicationId, {reason: cancelNote}),
                    'Процесс отменён',
                  ).then(() => setCancelNote(null))}
                />
                <Btn label="Не отменять" onPress={() => setCancelNote(null)} />
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Выбор сотрудника МИС руками. Появляется только когда сверка не сошлась —
 * иначе это лишняя кнопка на каждом шаге.
 */
function MisPicker({applicationId, reason, candidates, busy, onPick, onClose}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');
  const [list, setList] = useState(candidates || null);
  const [loading, setLoading] = useState(false);

  // Поле ищет на сервере, а не только внутри загруженных строк: сотрудника за
  // пределами начальной выборки иначе нельзя было бы выбрать вовсе
  useEffect(() => {
    if (!query.trim() && candidates) {
      setList(candidates);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const {data} = await onboardingApi.misUsers(applicationId, query.trim());
        if (!cancelled) setList(data);
      } catch (error) {
        if (!cancelled) Alert.alert('МИС не ответила', error.response?.data?.error || '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query.trim() ? 250 : 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [applicationId, candidates, query]);

  const shown = (list || []).filter(u =>
    !query || u.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <View style={styles.picker}>
      <View style={styles.pickerHead}>
        <Text style={styles.pickerWhy}>{reason}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10}>
          <X size={16} color={c.textTertiary} />
        </TouchableOpacity>
      </View>

      <View style={styles.pickerSearch}>
        <Search size={14} color={c.textTertiary} />
        <TextInput
          style={styles.pickerInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Найти сотрудника в МИС"
          placeholderTextColor={c.textTertiary}
        />
      </View>

      {loading && <Text style={styles.taskMeta}>Спрашиваем МИС…</Text>}

      {shown.map(user => (
        <TouchableOpacity
          key={user.id}
          style={styles.pickerRow}
          disabled={busy}
          onPress={() => onPick(user.id)}>
          <Text style={styles.pickerName}>{user.name}</Text>
          {Boolean(user.professions?.length) && (
            <Text style={styles.pickerProf}>{user.professions.join(', ')}</Text>
          )}
        </TouchableOpacity>
      ))}

      {!loading && !shown.length && <Text style={styles.taskMeta}>Никого не нашлось</Text>}
    </View>
  );
}

// ── Услуги ──────────────────────────────────────────────────────────────────

/**
 * Услуги, отмеченные врачом.
 *
 * Показываем весь список, а не только расхождения: бухгалтеру эти позиции
 * вносить в «Реновацию» руками, ему нужен сам перечень, а правки врача — лишь
 * пометки внутри него. Кнопка «только правки» оставлена для тех случаев, когда
 * список длинный, а проверить надо именно изменённое.
 */
function ServicesTab({services}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [onlyDiff, setOnlyDiff] = useState(false);

  if (!services) return <Text style={styles.empty}>Загружаем…</Text>;
  if (services.error) return <Text style={styles.empty}>Не удалось загрузить услуги</Text>;
  if (!services.total && !services.custom.length) {
    return <Text style={styles.empty}>Врач ещё не отмечал услуги</Text>;
  }

  const changed = item =>
    Boolean((item.doctorDuration && item.doctorDuration !== item.misDuration) || item.comment);
  const rows = onlyDiff ? services.services.filter(changed) : services.services;
  const diffCount = services.differences.length;

  return (
    <View style={styles.pane}>
      <View style={styles.srvTop}>
        <Text style={styles.srvCount}>
          <Text style={styles.srvCountNum}>{services.total}</Text> услуг отмечено
          {diffCount ? ` · ${diffCount} с правками` : ''}
        </Text>
        {Boolean(diffCount) && (
          <Btn
            label={onlyDiff ? 'Показать все' : 'Только правки'}
            kind={onlyDiff ? 'primary' : undefined}
            onPress={() => setOnlyDiff(v => !v)}
          />
        )}
      </View>

      <View style={styles.card}>
        {rows.map((item, i) => (
          <View key={item.id} style={[styles.srvRow, i > 0 && styles.pairNext]}>
            <View style={styles.srvBody}>
              <Text style={styles.srvTitle}>{item.title}</Text>
              <Text style={styles.srvMeta}>
                {item.code ? `${item.code} · ` : ''}
                {item.price != null ? `${item.price.toLocaleString('ru-RU')} ₽` : '—'}
              </Text>
              {Boolean(item.comment) && <Text style={styles.srvComment}>{item.comment}</Text>}
            </View>
            {/* Было и стало рядом: бухгалтер вносит второе, но обязан видеть
                первое, чтобы понять, что это правка врача */}
            <Text style={styles.srvDur}>
              {item.doctorDuration && item.doctorDuration !== item.misDuration ? (
                <>
                  <Text style={styles.srvDurOld}>{item.misDuration ?? '—'}</Text>
                  <Text style={{color: c.warning}}> {item.doctorDuration} мин</Text>
                </>
              ) : (
                item.misDuration ? `${item.misDuration} мин` : '—'
              )}
            </Text>
          </View>
        ))}
        {!rows.length && <Text style={styles.empty}>В этом фильтре пусто</Text>}
      </View>

      {Boolean(services.custom.length) && (
        <View style={styles.sect}>
          <Text style={styles.sectTitle}>Нет в справочнике</Text>
          <Text style={styles.srvNote}>
            Врач вписал их текстом. Заведение позиции в прайс идёт своим порядком
            и запуск не держит.
          </Text>
          <View style={styles.card}>
            {services.custom.map((item, i) => (
              <View key={item.id} style={[styles.srvRow, i > 0 && styles.pairNext]}>
                <View style={styles.srvBody}>
                  <Text style={styles.srvTitle}>{item.title}</Text>
                  {Boolean(item.comment) && <Text style={styles.srvComment}>{item.comment}</Text>}
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Журнал ──────────────────────────────────────────────────────────────────

/**
 * Журнал лентой, а не списком строк: у процесса есть ход, и читают его как
 * хронологию. События идут от свежих к старым и разбиты по дням — внутри дня
 * важно время, между днями сам факт перерыва.
 */
function JournalTab({events = [], tasks = []}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (!events.length) return <Text style={styles.empty}>Пока ничего не происходило</Text>;

  const stepTitle = key => tasks.find(t => t.stepKey === key)?.title || key;

  return (
    <View style={styles.pane}>
      {groupByDay(events).map(day => (
        <View key={day.key} style={styles.sect}>
          <Text style={styles.sectTitle}>{day.label}</Text>
          <View style={styles.card}>
            {day.items.map((event, i) => {
              const details = eventDetails(event);
              return (
                <View key={event.id} style={[styles.logRow, i > 0 && styles.pairNext]}>
                  <Text style={styles.logTime}>{timeOf(event.createdAt)}</Text>
                  <View style={[styles.logDot, {backgroundColor: eventTone(event.action, c)}]} />
                  <View style={styles.logBody}>
                    <Text style={styles.logWhat}>{eventLabel(event.action)}</Text>
                    {Boolean(event.payload?.stepKey) && (
                      <Text style={styles.logStep}>{stepTitle(event.payload.stepKey)}</Text>
                    )}
                    {Boolean(details) && <Text style={styles.logNote}>{details}</Text>}
                    {Boolean(event.author) && (
                      <Text style={styles.logWho}>
                        {event.author.displayName || event.author.username}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Кнопка ──────────────────────────────────────────────────────────────────

function Btn({label, kind, disabled, onPress}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        kind === 'primary' && styles.btnPrimary,
        kind === 'danger' && styles.btnDanger,
        disabled && styles.btnOff,
      ]}
      disabled={disabled}
      activeOpacity={0.8}
      onPress={onPress}>
      <Text
        style={[
          styles.btnText,
          kind === 'primary' && styles.btnTextPrimary,
          kind === 'danger' && styles.btnTextDanger,
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16, paddingBottom: 40},

  head: {marginBottom: 14},
  headName: {fontFamily: font.semiBold, fontSize: 20, color: c.textPrimary},
  headSub: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, marginTop: 4},
  stageChip: {alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 11, marginTop: 8},
  stageChipText: {fontFamily: font.semiBold, fontSize: 12},

  // ── Лента процесса ─────────────────────────────────────────────────────────
  timeline: {paddingBottom: 16, paddingRight: 8},
  tlPoint: {width: TL_STEP, alignItems: 'center'},
  /**
   * Линия к предыдущей точке занимает только промежуток МЕЖДУ кружками, а не
   * расстояние между их центрами.
   *
   * Раньше она тянулась на весь шаг (width: TL_STEP от центра до центра) и
   * проходила прямо сквозь предыдущий кружок на высоте его середины. Само по
   * себе это ещё не беда, но линия лежит в своём гнезде, а гнездо стоит в
   * списке позже соседнего — и абсолютно спозиционированная линия рисовалась
   * ПОВЕРХ предыдущей точки, перечёркивая её галочку.
   *
   * Теперь правый край линии упирается в левый край своего кружка, а левый — в
   * правый край предыдущего: рисовать поверх чего-либо ей больше нечем.
   */
  tlLine: {
    position: 'absolute',
    top: TL_DOT / 2 - 1,
    right: (TL_STEP + TL_DOT) / 2,
    width: TL_STEP - TL_DOT,
    height: 2,
    backgroundColor: c.bgTertiary,
  },
  tlDot: {
    width: TL_DOT, height: TL_DOT, borderRadius: TL_DOT / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  tlLabel: {
    fontFamily: font.regular, fontSize: 10.5, color: c.textTertiary,
    textAlign: 'center', marginTop: 6,
  },
  timelineOff: {
    borderRadius: radius.md, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  timelineOffText: {fontFamily: font.semiBold, fontSize: 13},

  tabs: {marginTop: 2},
  pane: {width: '100%'},

  // ── Общие блоки ────────────────────────────────────────────────────────────
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, paddingHorizontal: 14},
  sect: {marginTop: 18},
  sectTitle: {
    fontFamily: font.medium, fontSize: 12.5, color: c.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.4,
    marginBottom: 8, marginLeft: 4,
  },
  empty: {
    fontFamily: font.regular, fontSize: 13, color: c.textTertiary,
    textAlign: 'center', paddingVertical: 24,
  },

  pair: {paddingVertical: 11},
  pairNext: {borderTopWidth: 1, borderTopColor: c.borderLight},
  pairLabel: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary},
  pairValue: {fontFamily: font.regular, fontSize: 14.5, color: c.textPrimary, marginTop: 3, lineHeight: 20},

  repeatRow: {flexDirection: 'row', gap: 10, paddingVertical: 11},
  // Ширина колонки года фиксирована: годы выстраиваются в столбик, и список
  // читается сверху вниз, а не по каждой строке заново
  repeatLead: {width: 62, fontFamily: font.medium, fontSize: 12.5, color: c.textTertiary, paddingTop: 1},
  repeatBody: {flex: 1, minWidth: 0},
  repeatTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  repeatLink: {fontFamily: font.medium, fontSize: 14, color: c.primary, lineHeight: 19},
  repeatTail: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, marginTop: 2},

  // ── Анкета ─────────────────────────────────────────────────────────────────
  cvHead: {flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 6},
  cvPhoto: {width: 72, height: 72, borderRadius: radius.md, backgroundColor: c.bgTertiary},
  cvIdent: {flex: 1, minWidth: 0},
  cvName: {fontFamily: font.semiBold, fontSize: 17, color: c.textPrimary},
  cvProf: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, marginTop: 3},
  cvStamp: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, marginTop: 4},

  textarea: {
    backgroundColor: c.bgPrimary, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 84, textAlignVertical: 'top',
    fontFamily: font.regular, fontSize: 14, color: c.textPrimary,
    marginBottom: 10,
  },

  // ── Файлы ──────────────────────────────────────────────────────────────────
  fileGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  fileCard: {width: '47%'},
  fileThumb: {
    width: '100%', aspectRatio: 1,
    borderRadius: radius.md, backgroundColor: c.bgTertiary,
  },
  fileThumbStub: {alignItems: 'center', justifyContent: 'center'},
  fileName: {fontFamily: font.medium, fontSize: 12.5, color: c.textPrimary, marginTop: 6},
  fileSize: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary, marginTop: 1},

  // ── Задачи ─────────────────────────────────────────────────────────────────
  task: {
    backgroundColor: c.bgPrimary, borderRadius: radius.lg,
    padding: 14, marginBottom: 8, gap: 4,
  },
  taskLate: {borderLeftWidth: 3, borderLeftColor: c.error, paddingLeft: 11},
  // Закрытая задача бледнее: она остаётся в списке ради истории, но глазу
  // должно быть видно, что делать в ней нечего
  taskDone: {opacity: 0.62},
  taskHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  taskTitle: {flex: 1, fontFamily: font.semiBold, fontSize: 14.5, color: c.textPrimary},
  taskMeta: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, marginLeft: 23},

  checkRow: {flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10},
  checkText: {flex: 1, fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
  checkTextDone: {color: c.textTertiary},

  picker: {
    backgroundColor: c.bgSecondary, borderRadius: radius.md,
    padding: 10, marginTop: 8, gap: 6,
  },
  pickerHead: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  pickerWhy: {flex: 1, fontFamily: font.regular, fontSize: 12.5, color: c.warning, lineHeight: 17},
  pickerSearch: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.bgPrimary, borderRadius: radius.sm,
    paddingHorizontal: 10,
  },
  pickerInput: {
    flex: 1, paddingVertical: 8,
    fontFamily: font.regular, fontSize: 14, color: c.textPrimary,
  },
  pickerRow: {
    backgroundColor: c.bgPrimary, borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  pickerName: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  pickerProf: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, marginTop: 2},

  // ── Услуги ─────────────────────────────────────────────────────────────────
  srvTop: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10},
  srvCount: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
  srvCountNum: {fontFamily: font.semiBold, color: c.textPrimary},
  srvRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11},
  srvBody: {flex: 1, minWidth: 0},
  srvTitle: {fontFamily: font.regular, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  srvMeta: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, marginTop: 2},
  srvComment: {fontFamily: font.regular, fontSize: 12.5, color: c.warning, marginTop: 3},
  srvDur: {fontFamily: font.medium, fontSize: 12.5, color: c.textSecondary, paddingTop: 1},
  srvDurOld: {textDecorationLine: 'line-through', color: c.textTertiary},
  srvNote: {
    fontFamily: font.regular, fontSize: 12.5, color: c.textTertiary,
    lineHeight: 17, marginBottom: 8, marginHorizontal: 4,
  },

  // ── Журнал ─────────────────────────────────────────────────────────────────
  logRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 11},
  logTime: {width: 40, fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, paddingTop: 2},
  logDot: {width: 8, height: 8, borderRadius: 4, marginTop: 5},
  logBody: {flex: 1, minWidth: 0},
  logWhat: {fontFamily: font.medium, fontSize: 13.5, color: c.textPrimary, lineHeight: 18},
  logStep: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  logNote: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, marginTop: 4, lineHeight: 17},
  logWho: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, marginTop: 4},

  // ── Кнопки ─────────────────────────────────────────────────────────────────
  acts: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10},
  btn: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: radius.md, backgroundColor: c.bgTertiary,
  },
  btnPrimary: {backgroundColor: c.primary},
  btnDanger: {backgroundColor: `${c.error}1E`},
  btnOff: {opacity: 0.5},
  btnText: {fontFamily: font.medium, fontSize: 13.5, color: c.textPrimary},
  btnTextPrimary: {color: '#FFFFFF'},
  btnTextDanger: {color: c.error},
});
