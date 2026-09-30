/**
 * Лица писем: аватар отправителя и знак ящика — так же, как в вебе.
 *
 * Отправитель-сотрудник получает фото из профиля портала, внешний отправитель —
 * логотип своего домена (BIMI или favicon). Логотип сервер достаёт сам и
 * отдаёт готовым PNG: телефон сотрудника к чужому домену не обращается, иначе
 * отправитель по журналу своего сервера видел бы, кто и когда открыл почту.
 * Поэтому картинка идёт через наш маршрут с токеном, а токен нативному
 * загрузчику <Image> передаётся заголовком (см. authHeader).
 *
 * Пока картинка не загрузилась или её нет вовсе, виден цветной кружок с
 * первой буквой — цвет считается от адреса, чтобы один отправитель всегда
 * выглядел одинаково. Палитра та же, что в вебе.
 */
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';

import {Archive, FileText, Folder, Inbox, OctagonAlert, Send, Trash2} from 'lucide-react-native';

import CONFIG from '../../config';
import {authHeader, mail as mailApi} from '../../services/api';
import {useTheme} from '../../store/settingsStore';
import {font} from '../../theme';
import {isInbox} from './mailMeta';

const FOLDER_ICONS = {
  '\\Sent': Send,
  '\\Drafts': FileText,
  '\\Trash': Trash2,
  '\\Junk': OctagonAlert,
  '\\Archive': Archive,
};

/** Иконка папки по её роли на сервере — тот же набор, что в вебе. */
export function folderIcon(folder) {
  if (isInbox(folder)) return Inbox;
  return FOLDER_ICONS[folder?.specialUse] || Folder;
}

const SENDER_COLORS = ['#5965d8', '#2e8b74', '#c56b38', '#9a5bc4', '#3278bd', '#b6526d', '#6f7f35'];

// Домены, у которых логотипа нет. Без этой памяти список из полусотни писем
// от одного отправителя без favicon спрашивал бы сервер при каждой прокрутке.
const missingLogos = new Set();

// Токен кэширует сам authHeader и забывает его при выходе, поэтому здесь
// своей памяти нет — спросить его на каждую аватарку ничего не стоит.
function useAuthHeaders() {
  const [headers, setHeaders] = useState(null);
  useEffect(() => {
    let active = true;
    authHeader().catch(() => ({})).then(value => { if (active) setHeaders(value); });
    return () => { active = false; };
  }, []);
  return headers;
}

export function senderDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  const domain = at >= 0 ? value.slice(at + 1).replace(/\.$/, '') : '';
  return domain.includes('.') && /^[a-z0-9.-]+$/.test(domain) ? domain : null;
}

export function senderColor(value) {
  const hash = [...String(value || '')].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) | 0, 0);
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

function firstLetter(value) {
  return String(value || '?').trim().charAt(0).toUpperCase() || '?';
}

/** Логотип домена через наш сервер; null, если его нет или ещё нет токена. */
function useDomainLogo(domain) {
  const headers = useAuthHeaders();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [domain]);
  if (!domain || !headers || failed || missingLogos.has(domain)) return {source: null, fail: () => {}};
  return {
    source: {uri: mailApi.senderLogoUrl(domain), headers},
    fail: () => { missingLogos.add(domain); setFailed(true); },
  };
}

export function SenderAvatar({message, size = 38}) {
  const internal = message?.senderAvatar ? CONFIG.fileUrl(message.senderAvatar) : null;
  const [internalFailed, setInternalFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const domain = senderDomain(message?.fromEmail);
  const name = message?.fromName || message?.fromEmail || '?';
  const useInternal = Boolean(internal) && !internalFailed;
  const brand = useDomainLogo(useInternal ? null : domain);

  useEffect(() => { setLoaded(false); }, [internal, internalFailed, brand.source?.uri]);

  const source = useInternal ? {uri: internal} : brand.source;
  const shape = {width: size, height: size, borderRadius: size / 2};

  return (
    <View style={[styles.circle, shape, {backgroundColor: senderColor(message?.fromEmail || name)}]}>
      {!loaded && <Text style={[styles.letter, {fontSize: Math.round(size * 0.38)}]}>{firstLetter(name)}</Text>}
      {source && (
        <Image
          source={source}
          // Фото сотрудника — во весь кружок, логотип компании — целиком на
          // белом: знаки рисуют под белый лист, и обрезать их по кругу нельзя.
          style={[StyleSheet.absoluteFill, shape, !useInternal && styles.logo, !loaded && styles.hidden]}
          resizeMode={useInternal ? 'cover' : 'contain'}
          onLoad={() => setLoaded(true)}
          onError={() => { setLoaded(false); if (useInternal) setInternalFailed(true); else brand.fail(); }}
        />
      )}
    </View>
  );
}

/**
 * Знак ящика: логотип медцентра на белой плитке (или плитка фирменного цвета
 * с буквой) и в углу — значок почтовой площадки, как в вебе.
 */
export function AccountLogo({account, size = 34, showProvider = true}) {
  const c = useTheme();
  const medCenter = account?.medCenter;
  const logo = medCenter?.logoUrl ? CONFIG.fileUrl(medCenter.logoUrl) : null;
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => { setLogoFailed(false); }, [logo]);
  const brand = medCenter?.color || c.primary;
  const name = medCenter?.displayName || medCenter?.name || account?.displayName || account?.email || '';
  const shape = {width: size, height: size, borderRadius: Math.round(size * 0.3)};
  const showLogo = logo && !logoFailed;

  return (
    <View style={{width: size, height: size}}>
      <View style={[styles.tile, shape, {backgroundColor: showLogo ? '#FFFFFF' : `${brand}22`, borderColor: `${brand}33`}]}>
        {showLogo
          ? <Image source={{uri: logo}} style={styles.tileLogo} resizeMode="contain" onError={() => setLogoFailed(true)} />
          : <Text style={[styles.tileLetter, {color: brand, fontSize: Math.round(size * 0.4)}]}>{firstLetter(name)}</Text>}
      </View>
      {showProvider && <ProviderBadge domain={account?.providerLogoDomain} size={Math.round(size * 0.46)} ring={c.bgPrimary} />}
    </View>
  );
}

function ProviderBadge({domain, size, ring}) {
  const {source, fail} = useDomainLogo(domain);
  const [loaded, setLoaded] = useState(false);
  if (!source) return null;
  return (
    <View style={[styles.badge, {width: size, height: size, borderRadius: size / 2, borderColor: ring}, !loaded && styles.hidden]}>
      <Image source={source} style={styles.badgeImage} resizeMode="contain" onLoad={() => setLoaded(true)} onError={fail} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  letter: {fontFamily: font.bold, color: '#FFFFFF'},
  logo: {backgroundColor: '#FFFFFF'},
  hidden: {opacity: 0},
  tile: {alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1},
  tileLogo: {width: '84%', height: '84%'},
  tileLetter: {fontFamily: font.bold},
  badge: {
    position: 'absolute', right: -4, bottom: -4, overflow: 'hidden',
    backgroundColor: '#FFFFFF', borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  badgeImage: {width: '100%', height: '100%'},
});
