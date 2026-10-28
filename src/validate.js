'use strict';

const { HttpError } = require('./errors');

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function fail(errors) {
  throw new HttpError(400, 'Validation failed', errors);
}

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
}


function validateCredentials(body, { checkStrength }) {
  requireObject(body);
  const errors = {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = body.password;

  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = 'A valid email is required';
  if (typeof password !== 'string' || password.length === 0) {
    errors.password = 'Password is required';
  } else if (checkStrength && (password.length < 8 || password.length > 128)) {
    errors.password = 'Password must be between 8 and 128 characters';
  }
  if (Object.keys(errors).length) fail(errors);
  return { email: email.toLowerCase(), password };
}


function validateTask(body, { partial = false } = {}) {
  requireObject(body);
  const errors = {};
  const out = {};

  if ('title' in body || !partial) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 120) errors.title = 'Title is required (1-120 characters)';
    else out.title = title;
  }
  if ('description' in body) {
    if (typeof body.description !== 'string' || body.description.length > 1000) {
      errors.description = 'Description must be a string of at most 1000 characters';
    } else out.description = body.description.trim();
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) errors.status = `Status must be one of: ${STATUSES.join(', ')}`;
    else out.status = body.status;
  }
  if ('priority' in body) {
    if (!PRIORITIES.includes(body.priority)) errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}`;
    else out.priority = body.priority;
  }
  if ('dueDate' in body) {
    if (body.dueDate === null) out.due_date = null;
    else if (typeof body.dueDate !== 'string' || !isValidDate(body.dueDate)) {
      errors.dueDate = 'dueDate must be a real date in YYYY-MM-DD format, or null';
    } else out.due_date = body.dueDate;
  }

  if (Object.keys(errors).length) fail(errors);
  if (partial && Object.keys(out).length === 0) {
    throw new HttpError(400, 'Provide at least one field to update');
  }
  return out;
}


function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'ID must be a positive integer');
  return id;
}


function parseListQuery(query) {
  const errors = {};
  const out = {};

  if (query.status !== undefined) {
    if (!STATUSES.includes(query.status)) errors.status = `Status must be one of: ${STATUSES.join(', ')}`;
    else out.status = query.status;
  }
  if (query.priority !== undefined) {
    if (!PRIORITIES.includes(query.priority)) errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}`;
    else out.priority = query.priority;
  }
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 100) errors.search = 'search must be at most 100 characters';
    else out.search = query.search.trim();
  }

  const sortFields = ['createdAt', 'dueDate', 'priority', 'title'];
  out.sort = query.sort ?? 'createdAt';
  if (!sortFields.includes(out.sort)) errors.sort = `sort must be one of: ${sortFields.join(', ')}`;
  out.order = (query.order ?? 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(out.order)) errors.order = 'order must be asc or desc';

  out.page = query.page === undefined ? 1 : Number(query.page);
  out.limit = query.limit === undefined ? 10 : Number(query.limit);
  if (!Number.isInteger(out.page) || out.page < 1) errors.page = 'page must be a positive integer';
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 100) errors.limit = 'limit must be an integer from 1 to 100';

  if (Object.keys(errors).length) fail(errors);
  return out;
}

module.exports = { validateCredentials, validateTask, parseId, parseListQuery, STATUSES, PRIORITIES };
