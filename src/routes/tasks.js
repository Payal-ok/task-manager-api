'use strict';

const express = require('express');
const { HttpError } = require('../errors');
const { authenticate } = require('../auth');
const { validateTask, parseId, parseListQuery } = require('../validate');

// Whitelist of sortable columns: user input is never placed into SQL directly.
const SORT_SQL = {
  createdAt: 'created_at',
  dueDate: 'due_date',
  title: 'title COLLATE NOCASE',
  priority: "CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
};

function toTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Escape LIKE wildcards so "50%" searches for the literal text. */
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function taskRoutes({ db, jwtSecret }) {
  const router = express.Router();
  router.use(authenticate({ db, secret: jwtSecret }));

  const getOwned = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?');
  const insert = db.prepare(
    `INSERT INTO tasks (user_id, title, description, status, priority, due_date)
     VALUES (@user_id, @title, @description, @status, @priority, @due_date)`
  );

  function findOr404(id, userId) {
    const row = getOwned.get(id, userId);
    if (!row) throw new HttpError(404, 'Task not found');
    return row;
  }

  // GET /api/tasks?status=&priority=&search=&sort=&order=&page=&limit=
  router.get('/', (req, res) => {
    const q = parseListQuery(req.query);
    const where = ['user_id = @userId'];
    const params = { userId: req.user.id };
    if (q.status) { where.push('status = @status'); params.status = q.status; }
    if (q.priority) { where.push('priority = @priority'); params.priority = q.priority; }
    if (q.search) {
      where.push("(title LIKE @like ESCAPE '\\' OR description LIKE @like ESCAPE '\\')");
      params.like = `%${escapeLike(q.search)}%`;
    }
    const whereSql = where.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE ${whereSql}`).get(params).n;
    const direction = q.order === 'asc' ? 'ASC' : 'DESC';
    // id is a tiebreaker so pages are stable when many rows share the sort value
    const rows = db
      .prepare(
        `SELECT * FROM tasks WHERE ${whereSql}
         ORDER BY ${SORT_SQL[q.sort]} ${direction}, id ${direction}
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: q.limit, offset: (q.page - 1) * q.limit });

    res.json({
      data: rows.map(toTask),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    });
  });

  // POST /api/tasks
  router.post('/', (req, res) => {
    const fields = validateTask(req.body);
    const { lastInsertRowid } = insert.run({
      user_id: req.user.id,
      description: '',
      status: 'todo',
      priority: 'medium',
      due_date: null,
      ...fields,
    });
    res.status(201).json(toTask(getOwned.get(Number(lastInsertRowid), req.user.id)));
  });

  // GET /api/tasks/:id
  router.get('/:id', (req, res) => {
    res.json(toTask(findOr404(parseId(req.params.id), req.user.id)));
  });

  // PATCH /api/tasks/:id  (partial update)
  router.patch('/:id', (req, res) => {
    const id = parseId(req.params.id);
    findOr404(id, req.user.id);
    const fields = validateTask(req.body, { partial: true });

    // Column names come from validateTask's fixed set of keys, never from the client.
    const assignments = Object.keys(fields).map((col) => `${col} = @${col}`);
    db.prepare(`UPDATE tasks SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = @id AND user_id = @user_id`)
      .run({ ...fields, id, user_id: req.user.id });

    res.json(toTask(getOwned.get(id, req.user.id)));
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    findOr404(id, req.user.id);
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, req.user.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { taskRoutes };
