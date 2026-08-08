import {Platform} from 'react-native';
import {version as appVersion} from '../../package.json';

/**
 * Минимум сведений об устройстве для списка «мои устройства» на сервере.
 *
 * Отдельная зависимость (react-native-device-info) ради двух строк не нужна:
 * модель и бренд Android отдаёт сам Platform.constants.
 */

function deviceName() {
  const c = Platform.constants || {};
  if (Platform.OS === 'android') {
    const parts = [c.Brand, c.Model].filter(Boolean);
    return parts.length ? parts.join(' ') : 'Android';
  }
  // На iOS Platform.constants модели не отдаёт — только версию системы
  return `iOS ${Platform.Version}`;
}

export default {
  appVersion,
  deviceName: deviceName(),
};
