/**
 * Дерево прав пользователя — то же самое, что в правой колонке карточки веба.
 *
 * ── Почему целиком, а не выборочно ───────────────────────────────────────────
 *
 * Первым заходом права с телефона решено было не раздавать, и это оказалось
 * половиной работы: сотрудника заводят и тут же выдают ему модуль, а «остальное
 * в вебе» означало дорогу к компьютеру ради второго шага. Поэтому здесь весь
 * набор: административный доступ, модули, зарплата, склад и статистика.
 *
 * Не перенесена ровно одна ветка — галочки вкладок статистики. Они и в вебе
 * никуда не сохраняются: поля `statisticsTabs` нет ни в модели пользователя, ни
 * в маршрутах. Осталось само право «Статистика», оно работает.
 *
 * ── Чем отличается от веба ───────────────────────────────────────────────────
 *
 * Ветки свёрнуты по умолчанию. В вебе дерево видно целиком, потому что рядом
 * помещается вся остальная карточка; на телефоне развёрнутые ветки — это
 * четыре экрана прокрутки до кнопки «Сохранить», и человек листает мимо того,
 * чего не трогает.
 *
 * Трёхпозиционный переключатель переключается нажатием на нужную ступень, а не
 * по кругу: мышью перебрать три состояния дёшево, пальцем — лотерея.
 *
 * ── Кто что может ────────────────────────────────────────────────────────────
 *
 * Зарплатные и складские права сервер отдаёт и принимает только у
 * суперадминистратора (isAdmin), а не у того, кому открыт раздел
 * «Пользователи»: иначе заводящий людей выдал бы сам себе зарплаты. Поэтому
 * эти две ветки у неполного администратора не рисуются вовсе — кнопка, ведущая
 * в 403, хуже её отсутствия.
 *
 * У суперадминистратора все переключатели стоят включёнными и не нажимаются:
 * ему открыто всё по определению, и снять с него отдельное право нельзя, не
 * сняв сам признак администратора.
 */
import React, {useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';

import {font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {Card, SectionTitle, ToggleRow, PermControl, GroupHead} from './parts';
import {
  ADMIN_RIGHTS, MODULE_RIGHTS, SALARY_CLINICS, SALARY_TABS, SALARY_PERM_DEFAULT,
  WAREHOUSE_PERM_DEFAULT,
} from './usersMeta';

export default function PermissionsTree({form, setForm, canGrantAdmin, canGrantModules, whCatalogue}) {
  const c = useTheme();
  const own = useThemedStyles(makeStyles);
  const [open, setOpen] = useState({});

  const admin = Boolean(form.isAdmin);
  const access = form.adminAccess || {};
  const salary = form.salaryPerm || SALARY_PERM_DEFAULT;
  const warehouse = form.warehousePerm || WAREHOUSE_PERM_DEFAULT;

  const toggle = key => setOpen(prev => ({...prev, [key]: !prev[key]}));

  const setAccess = (key, value) => setForm(f => ({
    ...f, adminAccess: {...(f.adminAccess || {}), [key]: value},
  }));
  const setSalary = patch => setForm(f => ({
    ...f, salaryPerm: {...(f.salaryPerm || SALARY_PERM_DEFAULT), ...patch},
  }));
  const setWarehousePerm = (key, value) => setForm(f => ({
    ...f,
    warehousePerm: {
      ...(f.warehousePerm || WAREHOUSE_PERM_DEFAULT),
      perms: {...((f.warehousePerm || {}).perms || {}), [key]: value},
    },
  }));
  // Значение галочки модуля лежит либо в adminAccess, либо отдельным полем
  // пользователя — см. MODULE_RIGHTS
  const moduleValue = (key, where) => (where === 'access' ? access[key] : form[key]);
  const setModule = (key, where, value) => (where === 'access'
    ? setAccess(key, value)
    : setForm(f => ({...f, [key]: value})));

  return (
    <>
      <SectionTitle>Права</SectionTitle>
      <Card>
        {/* Признак суперадминистратора выдаёт только суперадминистратор — то же
            правило, что в вебе и на сервере (PUT /users/:id отбивает чужую
            попытку 403-м) */}
        <ToggleRow
          label="Администратор портала"
          color={c.warning}
          value={admin}
          disabled={!canGrantAdmin}
          onChange={value => setForm(f => ({...f, isAdmin: value}))}
        />

        <Branch
          own={own}
          label="Административный доступ"
          expanded={open.admin}
          onExpand={() => toggle('admin')}
          value={admin || ADMIN_RIGHTS.every(([key]) => access[key])}
          disabled={admin}
          onChange={(value) => {
            if (admin) return;
            setForm(f => ({
              ...f,
              adminAccess: {
                ...(f.adminAccess || {}),
                ...Object.fromEntries(ADMIN_RIGHTS.map(([key]) => [key, value])),
              },
            }));
          }}>
          {ADMIN_RIGHTS.map(([key, label]) => (
            <ToggleRow
              key={key}
              label={label}
              value={admin || Boolean(access[key])}
              disabled={admin}
              onChange={value => setAccess(key, value)}
            />
          ))}
        </Branch>

        <Branch
          own={own}
          label="Модули"
          expanded={open.modules}
          onExpand={() => toggle('modules')}
          value={admin || MODULE_RIGHTS.every(([key, , where]) => moduleValue(key, where))}
          disabled={admin}
          onChange={(value) => {
            if (admin) return;
            setForm((f) => {
              const nextAccess = {...(f.adminAccess || {})};
              const next = {...f};
              MODULE_RIGHTS.forEach(([key, , where]) => {
                if (where === 'access') nextAccess[key] = value;
                else next[key] = value;
              });
              return {...next, adminAccess: nextAccess};
            });
          }}>
          {MODULE_RIGHTS.map(([key, label, where]) => (
            <ToggleRow
              key={key}
              label={label}
              value={admin || Boolean(moduleValue(key, where))}
              disabled={admin}
              onChange={value => setModule(key, where, value)}
            />
          ))}
        </Branch>

        {canGrantModules && (
          <Branch
            own={own}
            label="Зарплата"
            expanded={open.salary}
            onExpand={() => toggle('salary')}
            value={admin || Boolean(form.canAccessSalary)}
            disabled={admin}
            onChange={value => setForm(f => ({...f, canAccessSalary: value}))}>
            <SubHead own={own} label="Медцентры" />
            {SALARY_CLINICS.map(clinic => (
              <ToggleRow
                key={clinic.id}
                label={clinic.name}
                dot={clinic.color}
                value={admin || (salary.clinics || []).includes(clinic.id)}
                disabled={admin}
                onChange={(value) => {
                  const list = salary.clinics || [];
                  setSalary({
                    clinics: value ? [...list, clinic.id] : list.filter(id => id !== clinic.id),
                  });
                }}
              />
            ))}

            <SubHead own={own} label="Вкладки" />
            {SALARY_TABS.map((tab, i) => (
              <React.Fragment key={tab.key}>
                {tab.group && tab.group !== SALARY_TABS[i - 1]?.group && (
                  <Text style={own.subLabel}>{tab.group}</Text>
                )}
                <PermRow
                  own={own}
                  label={tab.label}
                  inset={Boolean(tab.group)}
                  value={salary[tab.key]}
                  disabled={admin}
                  onChange={value => setSalary({[tab.key]: value})}
                />
              </React.Fragment>
            ))}

            {/* АУП не зависит от признака администратора: администратор без
                этого флага данных АУП не видит, в этом весь его смысл */}
            <ToggleRow
              label="АУП — секретная клиника"
              dot="#111111"
              value={Boolean(form.canAccessTopSalary)}
              onChange={value => setForm(f => ({...f, canAccessTopSalary: value}))}
            />
          </Branch>
        )}

        {canGrantModules && Boolean(whCatalogue) && (
          <Branch
            own={own}
            label="Складской учёт"
            expanded={open.warehouse}
            onExpand={() => toggle('warehouse')}
            value={admin || Boolean(access.warehouse)}
            disabled={admin}
            onChange={value => setAccess('warehouse', value)}>
            {Boolean(whCatalogue.medCenters?.length) && (
              <>
                <SubHead own={own} label="Медцентры" />
                {/* Пустой список означает «вся сеть»: ограничение с пустым
                    списком и его отсутствие выглядят одинаково, а значат
                    противоположное */}
                {whCatalogue.medCenters.map(mc => (
                  <ToggleRow
                    key={mc.id}
                    label={mc.name}
                    dot={mc.color}
                    value={admin || (warehouse.medCenterIds || []).includes(mc.id)}
                    disabled={admin}
                    onChange={(value) => {
                      const list = warehouse.medCenterIds || [];
                      setForm(f => ({
                        ...f,
                        warehousePerm: {
                          ...(f.warehousePerm || WAREHOUSE_PERM_DEFAULT),
                          medCenterIds: value
                            ? [...list, mc.id]
                            : list.filter(id => id !== mc.id),
                        },
                      }));
                    }}
                  />
                ))}
              </>
            )}

            <SubHead own={own} label="Разделы" />
            {(whCatalogue.sections || []).map(section => (
              <PermRow
                key={section.key}
                own={own}
                label={section.label}
                value={(warehouse.perms || {})[section.key]}
                disabled={admin}
                onChange={value => setWarehousePerm(section.key, value)}
              />
            ))}

            {Boolean(whCatalogue.reports?.length) && (
              <>
                <Pressable style={own.subToggle} onPress={() => toggle('whReports')}>
                  <Text style={own.subLabel}>
                    Отчёты ({whCatalogue.reports.length})
                  </Text>
                  <Text style={own.subAction}>
                    {open.whReports ? 'Свернуть' : 'Развернуть'}
                  </Text>
                </Pressable>
                {open.whReports && whCatalogue.reports.map(report => (
                  <PermRow
                    key={report.key}
                    own={own}
                    label={report.label}
                    inset
                    value={(warehouse.perms || {})[report.key]}
                    disabled={admin}
                    onChange={value => setWarehousePerm(report.key, value)}
                  />
                ))}
              </>
            )}
          </Branch>
        )}

        {/* Статистика — один переключатель, а не ветка. В вебе под ним лежит
            дерево галочек по вкладкам, но `statisticsTabs` не знает ни модель
            пользователя, ни маршруты: значение никуда не уезжает. Рисовать
            полтора десятка переключателей, которые ничего не меняют, — хуже,
            чем не рисовать их вовсе (см. usersMeta.js). */}
        <ToggleRow
          label="Статистика"
          value={admin || Boolean(form.canAccessStatistics)}
          disabled={admin}
          onChange={value => setForm(f => ({...f, canAccessStatistics: value}))}
        />
      </Card>
    </>
  );
}

/** Ветка дерева: заголовок с общим переключателем и содержимое под ним. */
function Branch({own, label, expanded, onExpand, value, onChange, disabled, children}) {
  return (
    <View>
      <GroupHead
        label={label}
        expanded={expanded}
        onExpand={onExpand}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      {expanded ? <View style={own.branchBody}>{children}</View> : null}
    </View>
  );
}

function SubHead({own, label}) {
  return <Text style={own.subLabel}>{label}</Text>;
}

function PermRow({own, label, value, onChange, disabled, inset}) {
  return (
    <View style={[own.permRow, inset && own.permRowInset]}>
      <Text style={own.permLabel} numberOfLines={2}>{label}</Text>
      <PermControl value={value} onChange={onChange} disabled={disabled} />
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  // Содержимое ветки сдвинуто вправо и отчёркнуто слева: без этой линии
  // вложенность на телефоне не читается — все строки выглядят одним списком
  branchBody: {
    marginLeft: 8,
    paddingLeft: 10,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: c.border,
  },

  subLabel: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 12,
    marginBottom: 2,
  },
  subToggle: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between'},
  subAction: {fontFamily: font.medium, fontSize: 12, color: c.primary},

  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderLight,
  },
  permRowInset: {paddingLeft: 8},
  permLabel: {flex: 1, fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
});
