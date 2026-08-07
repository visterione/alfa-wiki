import React from 'react';
import { RotateCcw } from 'lucide-react';
import UserBadge from './chat/UserBadge';
import BadgeIconPicker from './BadgeIconPicker';
import { CHAT_BADGE_ICON_LABELS, DEFAULT_BADGE_COLOR } from './chat/badgeIcons';

// Повторяет backend/utils/resolveChatBadge.js: иконку даёт самая приоритетная
// роль, цвет — самая приоритетная клиника. Здесь это нужно, чтобы админ видел
// метку до сохранения, ещё в момент переключения ролей и медцентров.
const pickRole = (roles) => roles
  .filter(role => role.chatBadgeIcon)
  .sort((a, b) =>
    (b.badgePriority || 0) - (a.badgePriority || 0) ||
    String(a.name).localeCompare(String(b.name), 'ru'))[0] || null;

const pickMedCenter = (medCenters) => medCenters
  .filter(mc => mc.color)
  .sort((a, b) =>
    (a.sortOrder ?? 100) - (b.sortOrder ?? 100) ||
    String(a.name).localeCompare(String(b.name), 'ru'))[0] || null;

export default function ChatBadgeField({
  override,
  onChange,
  displayName,
  roleList = [],
  medCenterList = [],
  roleIds = [],
  medCenterIds = []
}) {
  const value = override || {};

  const roles = roleList.filter(r => roleIds.includes(r.id));
  const medCenters = medCenterList.filter(mc => medCenterIds.includes(mc.id));

  const autoRole = pickRole(roles);
  const autoMedCenter = pickMedCenter(medCenters);

  const icon = value.value || autoRole?.chatBadgeIcon || '';
  const color = value.color || autoMedCenter?.color || DEFAULT_BADGE_COLOR;
  const roleLabel = !value.value && autoRole?.chatBadgeLabel ? autoRole.chatBadgeLabel : '';
  const label = value.label || roleLabel || CHAT_BADGE_ICON_LABELS[icon] || '';

  const patch = (fields) => {
    const next = { ...value, ...fields };
    Object.keys(next).forEach(key => { if (!next[key]) delete next[key]; });
    onChange(Object.keys(next).length ? next : null);
  };

  const paletteColors = medCenterList.filter(mc => mc.color);

  return (
    <div className="form-group badge-field">
      <label className="form-label">Метка сотрудника в чатах</label>

      <div className="badge-field-preview">
        <div className="badge-field-sample">
          <span>{displayName || 'Сотрудник'}</span>
          <UserBadge badge={{ value: icon, color, label }} size={16} />
        </div>
        <div className="badge-field-source">
          <div>
            Иконка:{' '}
            {value.value
              ? <>задана вручную — <b>{CHAT_BADGE_ICON_LABELS[value.value] || value.value}</b></>
              : autoRole
                ? <>по роли <b>{autoRole.name}</b></>
                : <>ни у одной роли сотрудника не задана — метки не будет</>}
          </div>
          <div>
            Цвет:{' '}
            {value.color
              ? <>задан вручную</>
              : autoMedCenter
                ? <>по клинике <b>{autoMedCenter.name}</b></>
                : <>клиника не выбрана — цвет по умолчанию</>}
          </div>
        </div>
        {(value.value || value.color || value.label) && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onChange(null)}
            title="Вернуть метку к автоматической"
          >
            <RotateCcw size={14} /> Сбросить
          </button>
        )}
      </div>

      <div className="badge-field-row">
        <label>
          <input
            type="checkbox"
            checked={Boolean(value.value)}
            onChange={e => patch({ value: e.target.checked ? (autoRole?.chatBadgeIcon || 'BadgeCheck') : '' })}
          />
          Переопределить иконку
        </label>
      </div>

      {value.value && (
        <div style={{ marginTop: 8 }}>
          <BadgeIconPicker
            value={value.value}
            onChange={next => patch({ value: next })}
            color={color}
            emptyLabel="Вернуться к иконке роли"
          />
        </div>
      )}

      <div className="badge-field-row">
        <label>
          <input
            type="checkbox"
            checked={Boolean(value.color)}
            onChange={e => patch({ color: e.target.checked ? color : '' })}
          />
          Переопределить цвет
        </label>

        {value.color && (
          <>
            <div className="badge-field-swatches">
              {paletteColors.map(mc => (
                <button
                  key={mc.id}
                  type="button"
                  className={`badge-field-swatch ${value.color?.toLowerCase() === mc.color.toLowerCase() ? 'active' : ''}`}
                  style={{ background: mc.color }}
                  title={mc.name}
                  onClick={() => patch({ color: mc.color })}
                />
              ))}
            </div>
            <input
              type="color"
              value={value.color}
              onChange={e => patch({ color: e.target.value })}
              title="Произвольный цвет"
              style={{ width: 34, height: 34, padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
            />
          </>
        )}
      </div>

      <div className="badge-field-row">
        <input
          className="input"
          value={value.label || ''}
          maxLength={80}
          placeholder={`Подпись при наведении${roleLabel ? ` — по умолчанию «${roleLabel}»` : ''}`}
          onChange={e => patch({ label: e.target.value })}
        />
      </div>
    </div>
  );
}
