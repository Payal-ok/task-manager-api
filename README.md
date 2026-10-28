# Task Manager API

A REST API for managing personal tasks, built with **Node.js, Express 5, SQLite and JWT authentication**. Each user registers, logs in, and manages only their own tasks.

## Features

- **User accounts:** register, log in, and a `/me` endpoint. Passwords are hashed with **scrypt** and a random salt, and are never returned.
- **JWT authentication:** tokens expire after 1 hour, and a token for a deleted user is rejected.
- **Full task CRUD:** create, read, update (partial `PATCH`) and delete.
- **Filtering, search, sorting and pagination** on the task list.
- **Data isolation:** one user can never read, change or delete another user's tasks (they get `404`).
- **Input validation** that reports every problem at once, with clear messages.
- **Security basics:** parameterised SQL queries only, a whitelist for sortable columns, escaped `LIKE` search, request size limit, and rate limiting on login and register.
- **Consistent JSON errors** from one central error handler.
- **29 automated tests** using Node's built-in test runner.

## Quick start

Requires **Node.js 22.13 or newer** (check with `node --version`). SQLite is built into Node, so there is no database to install and no native packages to compile.

```bash
git clone https://github.com/Payal-ok/task-manager-api.git
cd task-manager-api
npm install
npm start
```

The server starts at `http://localhost:3000` and stores data in `./data/tasks.db`.

### Configuration (environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | Port to listen on | `3000` |
| `DB_PATH` | SQLite database file | `./data/tasks.db` |
| `JWT_SECRET` | Secret used to sign tokens | a dev-only default (the server **refuses to start** in production without one) |
| `NODE_ENV` | Set to `production` for real deployments | unset |

Example:

```bash
JWT_SECRET="a-long-random-string" PORT=4000 npm start
```

## Try it with curl

```bash
# 1. Register (returns a token)
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"supersecret1"}'

# 2. Save the token, then create a task
TOKEN="paste-the-token-here"
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Push projects to GitHub","priority":"high","dueDate":"2026-10-30"}'

# 3. List high priority tasks
curl "http://localhost:3000/api/tasks?priority=high" -H "Authorization: Bearer $TOKEN"

# 4. Mark task 1 as done
curl -X PATCH http://localhost:3000/api/tasks/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

## API reference

### Auth

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create an account. Body: `email`, `password` (8 to 128 characters). Returns `201` with `user` and `token`. |
| POST | `/api/auth/login` | Log in. Returns `user` and `token`. |
| GET | `/api/auth/me` | The current user (needs a token). |

Send the token on every other request: `Authorization: Bearer <token>`.

### Tasks (all require a token)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasks` | List your tasks (see query options below) |
| POST | `/api/tasks` | Create a task |
| GET | `/api/tasks/:id` | Get one task |
| PATCH | `/api/tasks/:id` | Update some fields |
| DELETE | `/api/tasks/:id` | Delete a task (`204`, no body) |

Also: `GET /api/health` (no token) returns `{"status":"ok"}`.

**Task fields**

| Field | Type | Rules |
|---|---|---|
| `title` | string | required on create, 1 to 120 characters |
| `description` | string | optional, up to 1000 characters |
| `status` | string | `todo` (default), `in_progress`, `done` |
| `priority` | string | `low`, `medium` (default), `high` |
| `dueDate` | string or null | a real date as `YYYY-MM-DD` |

**List query options**

| Parameter | Values | Default |
|---|---|---|
| `status`, `priority` | filter by exact value | none |
| `search` | text found in the title or description (case-insensitive) | none |
| `sort` | `createdAt`, `dueDate`, `priority`, `title` | `createdAt` |
| `order` | `asc`, `desc` | `desc` |
| `page` | 1 and up | `1` |
| `limit` | 1 to 100 | `10` |

Example response:

```json
{
  "data": [
    {
      "id": 1,
      "title": "Push projects to GitHub",
      "description": "",
      "status": "todo",
      "priority": "high",
      "dueDate": "2026-10-30",
      "createdAt": "2026-10-27 19:26:25",
      "updatedAt": "2026-10-27 19:26:25"
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

Timestamps are in UTC.

**Errors** always look like this:

```json
{ "error": "Validation failed", "details": { "title": "Title is required (1-120 characters)" } }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input, bad ID, or invalid JSON |
| 401 | Missing, invalid or expired token; wrong login |
| 404 | Task or route not found (also used for other users' tasks) |
| 409 | Email already registered |
| 413 | Request body too large |
| 429 | Too many login or register attempts |

## Project structure

```
task-manager-api/
├── src/
│   ├── server.js        # starts the server, reads environment variables
│   ├── app.js           # builds the Express app and error handling
│   ├── db.js            # SQLite connection and schema
│   ├── auth.js          # password hashing, JWT, auth middleware
│   ├── validate.js      # input validation
│   ├── rateLimit.js     # small in-memory rate limiter
│   ├── errors.js        # HttpError class
│   └── routes/
│       ├── auth.js
│       └── tasks.js
└── tests/               # auth.test.js, tasks.test.js, helpers.js
```

## Design notes

- **Built-in SQLite:** the project uses Node's `node:sqlite` module, so `npm install` only fetches Express and jsonwebtoken (both pure JavaScript). Depending on your Node version, you may see a one-time "SQLite is an experimental feature" warning at startup. It is harmless.
- **`createApp({ db, jwtSecret })`** receives its dependencies as arguments. Tests run the real app against an in-memory database, so no mocking is needed.
- **Why 404 for another user's task?** It does not reveal that the task exists.
- **Login errors are identical** for a wrong password and an unknown email, and a password check always runs, so neither the message nor the timing tells an attacker which emails are registered.
- **Stable pagination:** results are sorted by the chosen column and then by `id`, so rows with equal values never appear twice or go missing between pages.

## Tests

```bash
npm test
```

The tests start the real server on a random port and call it with `fetch`. They cover registration and login, token security (forged, expired and deleted-user tokens), validation, ownership isolation, SQL injection attempts, filtering, search, sorting, pagination and rate limiting.

## Possible next steps

- Refresh tokens and a logout endpoint
- Task categories or tags
- OpenAPI / Swagger documentation
- A Docker setup
- Swap SQLite for PostgreSQL or MongoDB
- Add Express request logging

## License

MIT
