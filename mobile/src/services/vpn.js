/**
 * VPN Service — заглушка.
 *
 * Текущее поведение: приложение работает только в LAN.
 * Когда будет готова конфигурация VPN-сервера — здесь будет
 * реализована интеграция с WireGuard (Android: react-native-wireguard,
 * iOS: NetworkExtension / NEVPNManager) с On-Demand rules для
 * прозрачного автоподключения.
 */

import {Platform} from 'react-native';
import CONFIG from '../config';

const VpnService = {
  /**
   * Проверяет доступность сервера (LAN или через VPN-туннель).
   * @returns {Promise<boolean>}
   */
  async isServerReachable() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      // Адрес берём из общего конфига, а не из отдельной константы с http и IP:
      // раньше эта проверка ходила мимо BASE_URL и врала после переезда на домен
      const response = await fetch(`${CONFIG.API_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Инициализирует VPN-соединение.
   * Сейчас — заглушка. Позже: WireGuard On-Demand.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async connect() {
    // TODO: implement WireGuard / OpenVPN
    console.log('[VPN] Stub — skipping VPN connect, assuming LAN access');
    return {success: true, message: 'LAN mode (VPN not configured)'};
  },

  async disconnect() {
    // TODO: implement
    console.log('[VPN] Stub — disconnect');
  },

  /**
   * Возвращает статус для отображения в настройках.
   */
  async getStatus() {
    const reachable = await this.isServerReachable();
    return {
      vpnConfigured: false, // будет true после реализации
      serverReachable: reachable,
      platform: Platform.OS,
      // После реализации: { tunnelState, ip, ... }
    };
  },
};

export default VpnService;
