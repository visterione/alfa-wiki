'use strict';

/**
 * Реестр каналов доставки (ver. 7.84).
 *
 * Каналы подключаются сюда и наружу выглядят одинаково: Telegram и MAX — наши
 * боты, Fromni — вторая ступень каскада (она живёт отдельно, входящих у неё для
 * нас нет). Когда дойдёт очередь до ухода от агрегатора, сюда же встанет Имобис.
 * Отправитель уведомлений обращается к каналу через реестр и не знает, чей код
 * исполняется.
 */

const telegram = require('./telegram');
const max = require('./max');

const CHANNELS = {
  telegram,
  max
};

function getChannel(platform) {
  const channel = CHANNELS[platform];
  if (!channel) throw new Error(`Канал «${platform}» не подключён`);
  return channel;
}

module.exports = { getChannel, CHANNELS };
