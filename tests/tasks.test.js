'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

describe('tasks API', () => {
  let ctx, alice, bob;
  before(async () => {
    ctx = await startServer();
    alice = (await ctx.register('alice@example.com')).token;
    bob = (await ctx.register('bob@example.com')).token;
  });
  after(async () => { await ctx.close(); });

  const create = (body, token = alice) => ctx.request('POST', '/api/tasks', { body, token });

  test('every task route requires authentication', async () => {
    for (const [method, path] of [['GET', '/api/tasks'], ['POST', '/api/tasks'], ['GET', '/api/tasks/1'], ['PATCH', '/api/tasks/1'], ['DELETE', '/api/tasks/1']]) {
      const res = await ctx.request(method, path, method === 'POST' || method === 'PATCH' ? { body: {} } : {});
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  test('create applies defaults and returns 201', async () => {
    const res = await create({ title: '  Buy milk  ' });
    assert.equal(res.status, 201);
    assert.equal(res.body.title, 'Buy milk');
    assert.equal(res.body.status, 'todo');
    assert.equal(res.body.priority, 'medium');
    assert.equal(res.body.description, '');
    assert.equal(res.body.dueDate, null);
    assert.ok(res.body.id && res.body.createdAt && res.body.updatedAt);
  });

  test('create accepts all fields', async () => {
    const res = await create({ title: 'Finish report', description: 'Q3 numbers', status: 'in_progress', priority: 'high', dueDate: '2026-12-31' });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'in_progress');
    assert.equal(res.body.priority, 'high');
    assert.equal(res.body.dueDate, '2026-12-31');
  });

  test('create validates input and reports every problem', async () => {
    const res = await create({ title: '', status: 'finished', priority: 'urgent', dueDate: '2026-02-30' });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.details).sort(), ['dueDate', 'priority', 'status', 'title']);

    assert.equal((await create({})).status, 400);
    assert.equal((await create({ title: 'x'.repeat(121) })).status, 400);
    assert.equal((await create({ title: 'ok', dueDate: '31/12/2026' })).status, 400);
  });

  test('SQL injection attempts are stored as plain text and break nothing', async () => {
    const evil = "Robert'); DROP TABLE tasks;--";
    const res = await create({ title: evil });
    assert.equal(res.status, 201);
    assert.equal(res.body.title, evil);
    assert.equal((await ctx.request('GET', '/api/tasks', { token: alice })).status, 200);
  });

  test('get one task, with 404 for a missing id and 400 for a bad id', async () => {
    const { body: made } = await create({ title: 'Read me' });
    const got = await ctx.request('GET', `/api/tasks/${made.id}`, { token: alice });
    assert.equal(got.status, 200);
    assert.equal(got.body.title, 'Read me');

    assert.equal((await ctx.request('GET', '/api/tasks/999999', { token: alice })).status, 404);
    assert.equal((await ctx.request('GET', '/api/tasks/abc', { token: alice })).status, 400);
    assert.equal((await ctx.request('GET', '/api/tasks/-4', { token: alice })).status, 400);
  });

  test("users cannot see, change or delete each other's tasks", async () => {
    const { body: mine } = await create({ title: "Alice's secret" });
    const path = `/api/tasks/${mine.id}`;

    assert.equal((await ctx.request('GET', path, { token: bob })).status, 404);
    assert.equal((await ctx.request('PATCH', path, { token: bob, body: { title: 'hacked' } })).status, 404);
    assert.equal((await ctx.request('DELETE', path, { token: bob })).status, 404);

    const stillThere = await ctx.request('GET', path, { token: alice });
    assert.equal(stillThere.body.title, "Alice's secret");

    const bobsList = await ctx.request('GET', '/api/tasks', { token: bob });
    assert.equal(bobsList.body.meta.total, 0);
  });

  test('PATCH updates only the given fields and bumps updatedAt', async () => {
    const { body: made } = await create({ title: 'Patch me', priority: 'low' });
    ctx.db.prepare("UPDATE tasks SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(made.id);

    const res = await ctx.request('PATCH', `/api/tasks/${made.id}`, { token: alice, body: { status: 'done' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'done');
    assert.equal(res.body.title, 'Patch me');
    assert.equal(res.body.priority, 'low');
    assert.notEqual(res.body.updatedAt, '2000-01-01 00:00:00');

    const withDate = await ctx.request('PATCH', `/api/tasks/${made.id}`, { token: alice, body: { dueDate: '2027-01-01' } });
    assert.equal(withDate.body.dueDate, '2027-01-01');
    const removed = await ctx.request('PATCH', `/api/tasks/${made.id}`, { token: alice, body: { dueDate: null } });
    assert.equal(removed.body.dueDate, null);
  });

  test('PATCH rejects empty bodies and bad values; id and user_id cannot be changed', async () => {
    const { body: made } = await create({ title: 'Strict' });
    const path = `/api/tasks/${made.id}`;
    assert.equal((await ctx.request('PATCH', path, { token: alice, body: {} })).status, 400);
    assert.equal((await ctx.request('PATCH', path, { token: alice, body: { status: 'nope' } })).status, 400);
    assert.equal((await ctx.request('PATCH', path, { token: alice, body: { title: '' } })).status, 400);

    const res = await ctx.request('PATCH', path, { token: alice, body: { title: 'Renamed', user_id: 999, id: 5 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, made.id);
    assert.equal(res.body.title, 'Renamed');
    const row = ctx.db.prepare('SELECT user_id FROM tasks WHERE id = ?').get(made.id);
    assert.notEqual(row.user_id, 999);
  });

  test('DELETE removes the task and returns 204', async () => {
    const { body: made } = await create({ title: 'Delete me' });
    const del = await ctx.request('DELETE', `/api/tasks/${made.id}`, { token: alice });
    assert.equal(del.status, 204);
    assert.equal((await ctx.request('GET', `/api/tasks/${made.id}`, { token: alice })).status, 404);
    assert.equal((await ctx.request('DELETE', `/api/tasks/${made.id}`, { token: alice })).status, 404);
  });

  describe('listing', () => {
    let carol;
    before(async () => {
      carol = (await ctx.register('carol@example.com')).token;
      const seed = [
        { title: 'Write tests', priority: 'high', status: 'todo', dueDate: '2026-11-05' },
        { title: 'Fix bug', priority: 'high', status: 'in_progress', dueDate: '2026-11-01' },
        { title: 'Plan trip', priority: 'low', status: 'todo', description: 'Book flights' },
        { title: 'Call mum', priority: 'medium', status: 'done', dueDate: '2026-10-30' },
        { title: 'Save 50% on rent', priority: 'medium', status: 'todo' },
        { title: 'Read book', priority: 'low', status: 'done' },
        { title: 'Clean desk', priority: 'low', status: 'todo' },
      ];
      for (const t of seed) assert.equal((await create(t, carol)).status, 201);
    });

    const list = (query = '') => ctx.request('GET', `/api/tasks${query}`, { token: carol });
    const titles = (res) => res.body.data.map((t) => t.title);

    test('returns data plus pagination metadata', async () => {
      const res = await list();
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.meta, { page: 1, limit: 10, total: 7, totalPages: 1 });
    });

    test('filters by status and priority', async () => {
      assert.deepEqual(titles(await list('?status=done&sort=title&order=asc')), ['Call mum', 'Read book']);
      const both = await list('?status=todo&priority=high');
      assert.deepEqual(titles(both), ['Write tests']);
    });

    test('searches title and description, treating % literally', async () => {
      assert.deepEqual(titles(await list('?search=flights')), ['Plan trip']);
      assert.deepEqual(titles(await list('?search=BUG')), ['Fix bug']);
      assert.deepEqual(titles(await list('?search=' + encodeURIComponent('50%'))), ['Save 50% on rent']);
      assert.equal((await list('?search=' + encodeURIComponent('%'))).body.meta.total, 1);
    });

    test('sorts by title and by priority', async () => {
      const byTitle = titles(await list('?sort=title&order=asc'));
      assert.deepEqual(byTitle, [...byTitle].sort((a, b) => a.localeCompare(b)));

      const byPriority = (await list('?sort=priority&order=desc')).body.data.map((t) => t.priority);
      assert.deepEqual(byPriority, ['high', 'high', 'medium', 'medium', 'low', 'low', 'low']);
    });

    test('paginates without overlap or gaps', async () => {
      const seen = [];
      for (let page = 1; page <= 3; page++) {
        const res = await list(`?limit=3&page=${page}&sort=title&order=asc`);
        assert.equal(res.body.meta.totalPages, 3);
        seen.push(...titles(res));
      }
      assert.equal(seen.length, 7);
      assert.equal(new Set(seen).size, 7);
      assert.deepEqual((await list('?limit=3&page=4')).body.data, []);
    });

    test('rejects bad query parameters', async () => {
      for (const q of ['?status=x', '?priority=x', '?sort=password', '?order=sideways', '?page=0', '?limit=1000', '?limit=abc']) {
        assert.equal((await list(q)).status, 400, q);
      }
    });
  });
});
