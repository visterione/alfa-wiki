'use strict';

/**
 * Реестр каналов доставки (ver. 7.84).
 *
 * Каналы подключаются сюда и наружу выглядят одинаково. Сейчас это только
 * Telegram; следом встанут MAX и — когда дойдёт очередь до ухода от агрегатора —
 * Имобис с его SMS и Notify. Отправитель уведомлений обращается к каналу через
 * этот реестр и не знает, чей код исполняется.
 */

const telegram = require('./telegram');

const CHANNELS = {
  telegram
};

function getChannel(platform) {
  const channel = CHANNELS[platform];
  if (!channel) throw new Error(`Канал «${platform}» не подключён`);
  return channel;
}

module.exports = { getChannel, CHANNELS };
