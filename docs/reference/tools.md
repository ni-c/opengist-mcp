# Tools

All fourteen are registered unless you say otherwise. `OPENGIST_ALLOW_TOOLS` and
`OPENGIST_DENY_TOOLS` narrow the list to the ones you want, and `essential` selects a
curated seven — see
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).

Fourteen tools. With `OPENGIST_READ_ONLY=true` only the eight reading tools are
registered — the writing ones do not appear in `tools/list` at all.

[[toc]]

## Reading

### `list_gists`

Lists gist summaries — no file contents. Use `get_gist` for those.

| Parameter  | Type   | Default | Notes                                                     |
| ---------- | ------ | ------- | --------------------------------------------------------- |
| `scope`    | enum   | `mine`  | `mine`, `public`, `liked`, `forked`                       |
| `username` | string | —       | Narrows the scope to that user instead of the token owner |
| `since`    | string | —       | RFC 3339 timestamp; only gists updated after it           |
| `page`     | number | `1`     |                                                           |
| `perPage`  | number | `30`    |                                                           |

::: warning Missing private gists mean a missing scope
If gists you can see in the browser are absent here, the token lacks `gist:read`.
The API does not fail in that case — it silently returns only the public ones.
:::

### `get_gist`

One gist including its file contents, optionally at an older revision.

| Parameter          | Type    | Default  | Notes                                         |
| ------------------ | ------- | -------- | --------------------------------------------- |
| `gistId`           | string  | required |                                               |
| `sha`              | string  | —        | Read the gist as of this commit               |
| `includeContent`   | boolean | `true`   |                                               |
| `maxFileBytes`     | number  |          | Per-file cap                                  |
| `maxTotalBytes`    | number  |          | Cap across all files of the call              |
| `includeCommits`   | boolean | `false`  |                                               |
| `maxCommits`       | number  |          |                                               |
| `includeForks`     | boolean | `false`  |                                               |
| `includeCloneUrls` | boolean | `false`  | `clone_url` and `ssh_url`, for handing to git |

Truncated or omitted content always produces a note naming the `get_gist_file` call
that returns the rest. Binary files are reported as omitted rather than dumped.

A 404 means the gist does not exist **or** is invisible to this token. It does not
mean it was deleted.

### `get_gist_file`

The raw content of one file, optionally at a revision and from a byte offset. This
is what you use to page through a file `get_gist` truncated.

| Parameter  | Type   | Default  |
| ---------- | ------ | -------- |
| `gistId`   | string | required |
| `filename` | string | required |
| `sha`      | string | —        |
| `offset`   | number | `0`      |
| `maxBytes` | number |          |

### `list_gist_commits`

Commit history, newest first. Feed a SHA from here into `get_gist` or
`get_gist_file` to read an older revision.

Parameters: `gistId` (required), `page`, `perPage`.

### `list_gist_forks`

The gists forked from this one. Parameters: `gistId` (required), `page`, `perPage`.

### `search_gists`

Opengist has no search endpoint, so this pages through the list endpoints and filters
client-side. It is bounded by design and the result always says how much it scanned
and whether it was cut short.

| Parameter    | Type     | Default                           | Notes                              |
| ------------ | -------- | --------------------------------- | ---------------------------------- |
| `query`      | string   | required                          |                                    |
| `in`         | string[] | title, description, topics, owner | Which fields to match              |
| `scope`      | enum     | `mine`                            | Same scopes as `list_gists`        |
| `username`   | string   | —                                 |                                    |
| `visibility` | enum     | —                                 | Filter the results                 |
| `archived`   | boolean  | —                                 |                                    |
| `since`      | string   | —                                 |                                    |
| `limit`      | number   |                                   | Stop after this many matches       |
| `maxPages`   | number   |                                   | Stop after this many pages scanned |

Searching _inside_ file contents is not supported — it would mean downloading every
file of every gist. Narrow the field here, then read the candidates with `get_gist`.

### `get_user`

Without arguments: the account the token belongs to, including its email address.
With `username` or `userId`: that user's public profile.

The returned fields are an allowlist (`id`, `username`, `login`, `type`,
`avatarUrl`, `email`, `createdAt`), not a pass-through, so anything Opengist adds to
this endpoint later does not reach the model automatically.

### `check_gist_like`

Whether the token owner has liked a gist. Distinguishes "not liked" from "not
visible to you". Parameter: `gistId`.

## Writing

### `create_gist`

| Parameter      | Type   | Default  | Notes                                                    |
| -------------- | ------ | -------- | -------------------------------------------------------- |
| `files`        | array  | required | `{ filename, content }`, 1–50, content must be non-empty |
| `visibility`   | enum   | required | `private`, `unlisted`, `public` — never implicit         |
| `title`        | string | —        | Defaults to the first filename                           |
| `description`  | string | —        |                                                          |
| `expire`       | enum   | —        | `never`, `1hour`, `12hours`, `1day`, `7days`, `15days`   |
| `expiresAt`    | string | —        | RFC 3339; mutually exclusive with `expire`               |
| `confirmToken` | string | —        | Required for `public` and `unlisted` — see below         |

Content must be non-empty: Opengist silently drops files without content on create,
so an empty one would vanish rather than fail.

::: danger Publishing needs confirmation
`visibility: "public"` or `"unlisted"` is a disclosure event. The first call is
refused and returns a single-use token; call again within five minutes with
`confirmToken` and otherwise identical arguments. The token is bound to the exact
content, so it cannot be replayed with a different or an extra file attached.
:::

Expiry can only be set at creation. There is no way to change it afterwards.

### `update_gist`

Changes metadata and/or writes and renames files. **Files you do not list are left
untouched** — never list a file just to preserve it.

| Parameter      | Type    | Default  | Notes                                              |
| -------------- | ------- | -------- | -------------------------------------------------- |
| `gistId`       | string  | required |                                                    |
| `title`        | string  | —        |                                                    |
| `description`  | string  | —        |                                                    |
| `visibility`   | enum    | —        |                                                    |
| `fileOps`      | array   | —        | `write` and `rename` operations, see below         |
| `allowCreate`  | boolean | `false`  | Permit a `write` to a filename that does not exist |
| `confirmToken` | string  | —        |                                                    |

`fileOps` entries are one of:

```json
{ "op": "write", "filename": "notes.md", "content": "…" }
{ "op": "rename", "filename": "old.md", "newFilename": "new.md", "content": "…" }
```

`content` on a rename is optional; without it the file keeps its content under the
new name.

This tool **cannot delete a file** — that is `delete_gist_files`. The Opengist API
deletes a file whose entry is `null` or carries neither `content` nor `filename`,
which is exactly the shape a carelessly built object has, so the raw file map is
never exposed as an input and every payload is checked before it is sent.

A write to a filename that does not exist is refused unless `allowCreate` is set, and
the refusal names a case-insensitive near match (`readme.md` vs `README.md`) so a
typo does not quietly become a second file.

A confirmation token is required when the call **widens** the visibility, and when it
writes files into a gist that is already `public` or `unlisted`. It is not required
when the same call makes the gist private, or for metadata-only changes.

The response reports `previousRevision`, so the state before the change stays
retrievable with `get_gist` and a `sha`.

### `delete_gist_files`

Deletes files from a gist. They disappear from the current revision; older revisions
keep them in git history.

Parameters: `gistId`, `filenames` (1–50), `confirmToken`.

The token is bound to the exact set of filenames — a confirmation for one file cannot
be replayed to delete another. Deleting _every_ file is refused; use `delete_gist`.

### `delete_gist`

Permanently deletes a gist: the git repository with every revision and the database
row. Irreversible.

Parameters: `gistId`, `confirmToken`.

The refusal quotes server-side metadata only — visibility, file count, fork count,
like count, creation date — never the title or description.

### `fork_gist`

Forks someone else's gist into your account. Forking one you already forked returns
the existing fork rather than creating a second one, and the result says which
happened. Parameter: `gistId`.

### `set_gist_like`

Likes or unlikes a gist. Idempotent: the current state is read first and the gist is
only toggled when it differs, so calling it twice with the same value does not undo
itself. Requires `user:write` on the token.

Parameters: `gistId`, `liked` (boolean, required).
