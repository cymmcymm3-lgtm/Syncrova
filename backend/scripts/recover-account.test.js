const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseArgs, recoverAccount } = require('./recover-account');

const createUserModel = (users) => {
  const calls = { updates: [] };
  return {
    calls,
    find(filter) {
      calls.filter = filter;
      return {
        select(fields) { calls.fields = fields; return this; },
        limit(count) { calls.limit = count; return this; },
        async lean() { return users; }
      };
    },
    async updateOne(...args) {
      calls.updates.push(args);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
};

test('requires an explicit email and a trustworthy frontend URL', () => {
  assert.throws(() => parseArgs([]), /existing account email/);
  assert.throws(() => parseArgs(['--email']), /argument value/);
  assert.throws(() => parseArgs(['--email', 'member@example.com', '--frontend-url', 'http://example.com']), /HTTPS/);
  assert.throws(() => parseArgs(['--email', 'member@example.com', '--frontend-url', 'https://user:secret@example.com']), /credentials/);
  assert.equal(parseArgs(['--email', 'MEMBER@example.com']).frontendOrigin, 'http://localhost:3000');
  assert.equal(parseArgs(['--email', 'MEMBER@example.com']).email, 'member@example.com');
});

test('dry run only reads selected metadata using an escaped exact email match', async () => {
  const User = createUserModel([{ _id: 'existing-id', email: 'member+dev@example.com', isDeveloper: true }]);
  const result = await recoverAccount({
    User, email: 'member+dev@example.com', dryRun: true,
    randomBytes() { assert.fail('A dry run must not generate tokens'); }
  });
  assert.deepEqual(result, { email: 'member+dev@example.com', isDeveloper: true, dryRun: true });
  assert.equal(User.calls.fields, 'email isDeveloper');
  assert.equal(User.calls.limit, 2);
  assert.equal(User.calls.filter.email.test('MEMBER+DEV@example.com'), true);
  assert.equal(User.calls.filter.email.test('memberrrdev@example.com'), false);
  assert.equal(User.calls.filter.email.test('prefixmember+dev@example.com'), false);
  assert.equal(User.calls.updates.length, 0);
});

test('issues a compatible 20-minute link and changes only reset fields', async () => {
  const User = createUserModel([{ _id: 'existing-id', email: 'member@example.com', isDeveloper: true }]);
  const timestamp = Date.parse('2026-10-06T00:00:00Z');
  const token = Buffer.alloc(32, 7).toString('hex');
  const result = await recoverAccount({
    User, email: 'member@example.com', frontendOrigin: 'http://localhost:3000',
    now: () => timestamp, randomBytes: () => Buffer.alloc(32, 7)
  });
  const link = new URL(result.resetUrl);
  assert.equal(link.pathname, '/login');
  assert.equal(link.searchParams.get('resetToken'), token);
  assert.equal(link.searchParams.get('resetEmail'), 'member@example.com');
  assert.equal(result.expiresAt, '2026-10-06T00:20:00.000Z');
  assert.equal(result.isDeveloper, true);
  assert.deepEqual(User.calls.updates, [[
    { _id: 'existing-id' },
    { $set: {
      passwordResetToken: crypto.createHash('sha256').update(token).digest('hex'),
      passwordResetExpires: new Date(timestamp + 20 * 60 * 1000),
      passwordResetRequestedBy: null,
      passwordResetRequestedAt: new Date(timestamp)
    } },
    { timestamps: false, upsert: false }
  ]]);
});

test('missing or ambiguous accounts do not trigger writes', async () => {
  for (const users of [[], [{ _id: 'first' }, { _id: 'second' }]]) {
    const User = createUserModel(users);
    await assert.rejects(recoverAccount({ User, email: 'member@example.com' }), /No changes were made/);
    assert.equal(User.calls.updates.length, 0);
  }
});
