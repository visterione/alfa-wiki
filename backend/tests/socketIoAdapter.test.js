'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createSocketIoAdapterManager } = require('../services/socketIoAdapter');

function fakeRedisPair({ fail = false } = {}) {
  const makeClient = () => {
    const client = new EventEmitter();
    client.isOpen = false;
    client.isReady = false;
    client.connect = async () => {
      client.isOpen = true;
      if (fail) throw new Error('redis unavailable');
      client.isReady = true;
    };
    client.close = async () => {
      client.isReady = false;
      client.isOpen = false;
    };
    client.destroy = () => {
      client.isReady = false;
      client.isOpen = false;
    };
    return client;
  };

  const publisher = makeClient();
  const subscriber = makeClient();
  publisher.duplicate = () => subscriber;
  return { publisher, subscriber };
}

const silentLogger = { log() {}, warn() {}, error() {} };

test('keeps the in-memory adapter when Redis is not configured', async () => {
  let installed = false;
  const manager = createSocketIoAdapterManager({
    redisUrl: '',
    adapterFactory: () => { installed = true; },
    logger: silentLogger,
  });

  assert.deepEqual(await manager.initialize({ adapter() {} }), {
    mode: 'memory', configured: false, required: false, ready: true,
    publisherReady: null, subscriberReady: null,
  });
  assert.equal(installed, false);
});

test('rejects memory mode when Redis is required for a cluster', async () => {
  const manager = createSocketIoAdapterManager({
    redisUrl: '',
    redisRequired: true,
    logger: silentLogger,
  });
  await assert.rejects(
    manager.initialize({ adapter() {} }),
    /Redis adapter is required/,
  );
  assert.equal(manager.getStatus().ready, false);
});

test('connects both Redis clients and installs the adapter', async () => {
  const pair = fakeRedisPair();
  let installedAdapter = null;
  const expectedAdapter = {};
  const manager = createSocketIoAdapterManager({
    redisUrl: 'redis://example.test:6379',
    createRedisClient: () => pair.publisher,
    adapterFactory: (publisher, subscriber) => {
      assert.equal(publisher, pair.publisher);
      assert.equal(subscriber, pair.subscriber);
      return expectedAdapter;
    },
    logger: silentLogger,
  });

  const state = await manager.initialize({ adapter: value => { installedAdapter = value; } });
  assert.equal(state.ready, true);
  assert.equal(installedAdapter, expectedAdapter);

  await manager.close();
  assert.equal(pair.publisher.isOpen, false);
  assert.equal(pair.subscriber.isOpen, false);
});

test('fails startup instead of silently falling back when Redis is configured', async () => {
  const pair = fakeRedisPair({ fail: true });
  let installed = false;
  const manager = createSocketIoAdapterManager({
    redisUrl: 'redis://example.test:6379',
    createRedisClient: () => pair.publisher,
    adapterFactory: () => { installed = true; },
    logger: silentLogger,
  });

  await assert.rejects(
    manager.initialize({ adapter() {} }),
    /Redis adapter initialization failed: redis unavailable/,
  );
  assert.equal(installed, false);
  assert.equal(manager.getStatus().ready, false);
});
