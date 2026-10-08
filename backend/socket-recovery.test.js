const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Server section missing: ${start}`);
  return source.slice(from, to);
};

// Exercise the actual server functions and matchmaking handler without executing
// server startup, loading .env, opening ports, or connecting to external services.
const createHarness = () => {
  const userId = '507f1f77bcf86cd799439011';
  const issuedAt = Math.floor(Date.now() / 1000);
  const state = { passwordChangedAtMs: (issuedAt - 2) * 1000 };
  const events = new Map();
  const socket = {
    id: 'test-socket', data: {}, join() {}, emit() {}, broadcast: { emit() {} },
    on(name, handler) { events.set(name, handler); }
  };
  const context = {
    socket,
    mongoose: { Types: { ObjectId: { isValid: id => id === userId } } },
    getAuthUserState: async () => state,
    process: { env: { JWT_SECRET: 'test-only' } },
    jwt: { verify: token => {
      if (token === 'fresh-token') return { userId, iat: issuedAt };
      if (token === 'old-token') return { userId, iat: issuedAt - 10 };
      throw new Error('Invalid token');
    } },
    addUserSocket: () => false,
    broadcastOnlineUsers() {}, broadcastUserStatusChange() {},
    removeBowDuelQueueEntry() {}, pruneBowDuelQueue() {},
    getBowDuelProfile: async () => ({}),
    bowDuelQueue: [], getOnlineUserIds: () => [userId],
    socketExists: () => true,
    result: {}
  };
  vm.runInNewContext([
    section('const normalizeId =', 'const getOnlineUserIds ='),
    section('const registerOnlineUser =', 'const removeUserSocket ='),
    section("socket.on('bow-duel:find-match'", "socket.on('bow-duel:cancel-search'"),
    'result.register = registerExistingOnlineUser;',
    'result.registerOnline = registerOnlineUser;',
    'result.canUsePresenceUser = canUsePresenceUser;'
  ].join('\n'), context);
  return { ...context.result, userId, issuedAt, state, socket, events };
};

test('recovered accounts retain verified socket token time for presence and matchmaking', async () => {
  const app = createHarness();
  assert.equal(await app.register(app.socket, app.userId, app.issuedAt), true);
  assert.equal(app.socket.data.tokenIssuedAt, app.issuedAt);
  assert.equal(await app.canUsePresenceUser(app.socket, app.userId, app.userId), true);
  let reply;
  await app.events.get('bow-duel:find-match')({}, value => { reply = value; });
  assert.equal(reply.ok, true);
  assert.equal(reply.waiting, true);

  app.state.passwordChangedAtMs = (app.issuedAt + 3) * 1000;
  assert.equal(await app.canUsePresenceUser(app.socket, app.userId, app.userId), false);
  await app.events.get('bow-duel:find-match')({}, value => { reply = value; });
  assert.equal(reply.ok, false);
});

test('payload authentication stores verified token time and rejects revoked sessions', async () => {
  const app = createHarness();
  assert.equal(await app.register(app.socket, app.userId, app.issuedAt - 10), false);
  assert.equal(app.socket.data.userId, undefined);
  assert.equal(await app.canUsePresenceUser(app.socket, app.userId, { token: 'old-token' }), false);
  assert.equal(await app.canUsePresenceUser(app.socket, app.userId, { token: 'fresh-token' }), true);
  app.registerOnline(app.socket, app.userId);
  assert.equal(app.socket.data.tokenIssuedAt, app.issuedAt);
  assert.equal(await app.canUsePresenceUser(app.socket, app.userId, app.userId), true);
  assert.equal(await app.canUsePresenceUser(app.socket, 'another-user', { token: 'fresh-token' }), false);
});
