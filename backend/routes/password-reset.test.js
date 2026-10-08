const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const bcrypt = require('bcryptjs');

const token = 'a'.repeat(64);
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
const existingHash = bcrypt.hashSync('old-password', 4);

// Load the actual route handlers with isolated dependencies: no server, .env,
// database connection, uploads, or external storage is touched by these tests.
const createHarness = (filename, options = {}) => {
  const routes = new Map();
  const invalidations = [];
  const state = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test member', email: 'member@example.com', isDeveloper: true,
    password: existingHash,
    passwordResetToken: tokenHash,
    passwordResetExpires: new Date(Date.now() + 60_000),
    passwordResetRequestedBy: 'requester',
    passwordResetRequestedAt: new Date(),
    ...options.user
  };
  const User = {
    async findOne(filter) {
      if (!filter.email.test(state.email)) return null;
      const document = structuredClone(state);
      document.save = async () => {
        const { save, ...fields } = document;
        Object.assign(state, fields);
      };
      return document;
    },
    async findById() { return structuredClone(state); },
    async findOneAndUpdate(filter, update) {
      const matches = Object.entries(filter).every(([field, value]) => {
        if (field === 'passwordResetExpires') return state[field] > value.$gt;
        return state[field] === value;
      });
      if (!matches) return null;
      Object.assign(state, update.$set);
      return structuredClone(state);
    }
  };
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    router[method] = (route, ...handlers) => routes.set(`${method} ${route}`, handlers.at(-1));
  }
  const multer = Object.assign(() => ({ single: () => () => {} }), { diskStorage: () => ({}) });
  const dependencies = {
    express: { Router: () => router },
    jsonwebtoken: { sign: () => 'new-session-token' },
    bcryptjs: { ...bcrypt, hash: options.hash || bcrypt.hash },
    crypto,
    mongoose: { Types: { ObjectId: { isValid: () => true } } },
    '../middleware/auth': () => {},
    '../models/User': User,
    '../utils/academics': { normalizeCampus: value => value, normalizeCourse: value => value },
    '../services/roles': {},
    '../utils/mediaUrls': { serializeMediaUser: value => value },
    '../utils/authSessionCache': { invalidateAuthUserState: id => invalidations.push(id) },
    multer,
    path,
    fs: { mkdirSync() {} },
    '../services/storage': {},
    '../services/ranks': {},
    '../services/gameRanks': {},
    ...Object.fromEntries(['Group', 'Task', 'GameSession', 'Friendship', 'Post'].map(name => [`../models/${name}`, {}]))
  };
  const routePath = path.join(__dirname, filename);
  const routeModule = new Module(routePath, module);
  routeModule.filename = routePath;
  routeModule.require = name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  };
  routeModule._compile(fs.readFileSync(routePath, 'utf8'), routePath);

  return {
    state, invalidations,
    async request(method, route, body) {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
      };
      const handler = routes.get(`${method} ${route}`);
      assert.ok(handler, `Missing route: ${method} ${route}`);
      await handler({ body, user: state._id, query: {}, headers: {} }, res);
      return res;
    }
  };
};

test('a reset link is consumed once even when two requests arrive together', async () => {
  const app = createHarness('auth.js');
  const responses = await Promise.all([
    app.request('post', '/reset-password', { token, password: 'first-password' }),
    app.request('post', '/reset-password', { token, password: 'second-password' })
  ]);
  assert.deepEqual(responses.map(res => res.statusCode).sort(), [200, 400]);
  const success = responses.find(res => res.statusCode === 200);
  const winningPassword = responses[0] === success ? 'first-password' : 'second-password';
  assert.equal(await bcrypt.compare(winningPassword, app.state.password), true);
  assert.equal(success.body.token, 'new-session-token');
  assert.equal(success.body.user.email, 'member@example.com');
  assert.equal(success.body.user.isDeveloper, true);
  assert.equal(Object.hasOwn(success.body.user, 'password'), false);
  assert.equal(Object.hasOwn(success.body.user, 'passwordResetToken'), false);
  assert.equal(app.state.passwordResetToken, '');
  assert.equal(app.state.passwordResetExpires, null);
  assert.equal(app.state.passwordResetRequestedBy, null);
  assert.equal(app.state.passwordResetRequestedAt, null);
  assert.equal(app.invalidations.length, 1);
});

test('expired or unknown reset links leave the password untouched', async () => {
  for (const user of [
    { passwordResetExpires: new Date(Date.now() - 1000) },
    { passwordResetToken: 'another-token-hash' }
  ]) {
    const app = createHarness('auth.js', { user });
    const res = await app.request('post', '/reset-password', { token, password: 'new-password' });
    assert.equal(res.statusCode, 400);
    assert.equal(app.state.password, existingHash);
    assert.equal(app.invalidations.length, 0);
  }
});

test('a link replaced while its password is being hashed cannot overwrite the newer link', async () => {
  const app = createHarness('auth.js', {
    hash: async password => {
      app.state.passwordResetToken = 'newer-link-hash';
      return bcrypt.hash(password, 4);
    }
  });
  const res = await app.request('post', '/reset-password', { token, password: 'new-password' });
  assert.equal(res.statusCode, 400);
  assert.equal(app.state.password, existingHash);
  assert.equal(app.state.passwordResetToken, 'newer-link-hash');
  assert.equal(app.invalidations.length, 0);
});

test('changing the current password invalidates all pending recovery fields', async () => {
  const app = createHarness('users.js');
  const res = await app.request('put', '/password', {
    currentPassword: 'old-password', newPassword: 'new-password'
  });
  assert.equal(res.statusCode, 200);
  assert.equal(await bcrypt.compare('new-password', app.state.password), true);
  assert.equal(app.state.passwordResetToken, '');
  assert.equal(app.state.passwordResetExpires, null);
  assert.equal(app.state.passwordResetRequestedBy, null);
  assert.equal(app.state.passwordResetRequestedAt, null);
  assert.deepEqual(app.invalidations, [app.state._id]);
});

test('an in-flight password change cannot overwrite a concurrent recovery', async () => {
  const recoveredPassword = bcrypt.hashSync('recovered-password', 4);
  const app = createHarness('users.js', {
    hash: async password => {
      app.state.password = recoveredPassword;
      return bcrypt.hash(password, 4);
    }
  });
  const res = await app.request('put', '/password', {
    currentPassword: 'old-password', newPassword: 'new-password'
  });
  assert.equal(res.statusCode, 409);
  assert.equal(app.state.password, recoveredPassword);
  assert.equal(app.invalidations.length, 0);
});

const withEnvironment = async (values, callback) => {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('production without reset delivery preserves an existing link and gives the same guidance for unknown accounts', async () => {
  await withEnvironment({ NODE_ENV: 'production', PASSWORD_RESET_TOKEN_PREVIEW: 'false' }, async () => {
    const app = createHarness('auth.js');
    const before = structuredClone(app.state);
    const known = await app.request('post', '/forgot-password', { email: app.state.email });
    const unknown = await app.request('post', '/forgot-password', { email: 'unknown@example.com' });
    assert.equal(known.statusCode, 200);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(known.body.emailConfigured, false);
    assert.match(known.body.msg, /administrator/);
    assert.equal(Object.hasOwn(known.body, 'resetToken'), false);
    assert.deepEqual(app.state, before);
  });
});

test('development token preview still provides a usable hashed recovery token', async () => {
  await withEnvironment({ NODE_ENV: 'development', PASSWORD_RESET_TOKEN_PREVIEW: 'false' }, async () => {
    const app = createHarness('auth.js');
    const res = await app.request('post', '/forgot-password', { email: app.state.email });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.resetToken, /^[a-f0-9]{64}$/);
    assert.equal(new URL(res.body.resetUrl).searchParams.get('resetToken'), res.body.resetToken);
    assert.equal(app.state.passwordResetToken, crypto.createHash('sha256').update(res.body.resetToken).digest('hex'));
    assert.equal(app.state.password, existingHash);
  });
});
