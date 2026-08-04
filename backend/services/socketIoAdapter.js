'use strict';

const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const { envInteger } = require('../utils/databaseRuntimeConfig');
const { envFlag } = require('../utils/env');

function createSocketIoAdapterManager({
  redisUrl = process.env.SOCKET_IO_REDIS_URL || '',
  redisRequired = envFlag(process.env.SOCKET_IO_REDIS_REQUIRED, false),
  connectTimeoutMs = envInteger(process.env, 'SOCKET_IO_REDIS_CONNECT_TIMEOUT_MS', 10_000, 1_000, 60_000),
  createRedisClient = createClient,
  adapterFactory = createAdapter,
  logger = console,
} = {}) {
  let pubClient = null;
  let subClient = null;
  let initialized = false;

  const status = () => ({
    mode: redisUrl ? 'redis' : 'memory',
    configured: Boolean(redisUrl),
    required: redisRequired,
    ready: redisUrl ? Boolean(initialized && pubClient?.isReady && subClient?.isReady) : !redisRequired,
    publisherReady: redisUrl ? Boolean(pubClient?.isReady) : null,
    subscriberReady: redisUrl ? Boolean(subClient?.isReady) : null,
  });

  const destroyClient = client => {
    if (!client) return;
    try {
      if (client.isOpen) client.destroy();
    } catch (_) {
      // Cleanup must not hide the original connection error.
    }
  };

  async function initialize(io) {
    if (initialized) return status();
    if (!redisUrl) {
      if (redisRequired) {
        throw new Error('Socket.IO Redis adapter is required but SOCKET_IO_REDIS_URL is not set');
      }
      logger.warn('⚠️ Socket.IO uses the in-memory adapter (single backend instance only)');
      return status();
    }

    pubClient = createRedisClient({
      url: redisUrl,
      socket: { connectTimeout: connectTimeoutMs },
    });
    subClient = pubClient.duplicate();

    pubClient.on('error', error => logger.error('[socket.io redis publisher]', error.message));
    subClient.on('error', error => logger.error('[socket.io redis subscriber]', error.message));

    let timer;
    try {
      await Promise.race([
        Promise.all([pubClient.connect(), subClient.connect()]),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Socket.IO Redis connection timed out after ${connectTimeoutMs}ms`)),
            connectTimeoutMs,
          );
        }),
      ]);
      io.adapter(adapterFactory(pubClient, subClient));
      initialized = true;
      logger.log('✅ Socket.IO Redis adapter connected');
      return status();
    } catch (error) {
      destroyClient(pubClient);
      destroyClient(subClient);
      pubClient = null;
      subClient = null;
      throw new Error(`Socket.IO Redis adapter initialization failed: ${error.message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function close() {
    const clients = [subClient, pubClient];
    pubClient = null;
    subClient = null;
    initialized = false;

    await Promise.allSettled(clients.map(async client => {
      if (!client?.isOpen) return;
      try {
        await client.close();
      } catch (_) {
        destroyClient(client);
      }
    }));
  }

  return { initialize, close, getStatus: status };
}

const socketIoAdapter = createSocketIoAdapterManager();

module.exports = { createSocketIoAdapterManager, socketIoAdapter };
