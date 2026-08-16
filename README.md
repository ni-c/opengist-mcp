# opengist-mcp

[![CI](https://github.com/ni-c/opengist-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ni-c/opengist-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/opengist-mcp.svg)](https://www.npmjs.com/package/opengist-mcp)
[![npm downloads](https://img.shields.io/npm/dm/opengist-mcp.svg)](https://www.npmjs.com/package/opengist-mcp)
[![node](https://img.shields.io/node/v/opengist-mcp.svg)](https://www.npmjs.com/package/opengist-mcp)
[![license](https://img.shields.io/npm/l/opengist-mcp.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Opengist](https://github.com/thomiceli/opengist), the self-hosted pastebin powered by Git.

Lets MCP clients like Claude Code, Claude Desktop or Codex read, search, create, update and delete gists on your own Opengist instance: file contents and revisions, commit history, forks and likes, plus your user account.

> **Note:** this server talks to the Opengist REST API under `/api`, which is available in recent Opengist releases and enabled by default (`api.enabled`). A running instance serves its own OpenAPI spec at `GET /api/openapi.yaml` — compare it against your version if a tool behaves unexpectedly.

## Requirements

- Node.js 22 or newer
- An Opengist instance with the REST API enabled
- An Opengist Personal Access Token (Settings → Access Tokens). Scopes:
  - `gist:read` — read gists, including your private and unlisted ones
  - `gist:write` — create, update, delete and fork gists
  - `user:read` — read your own account
  - `user:write` — only needed for `set_gist_like`

  A token **without** `gist:read` still works, but the API then silently returns only public gists instead of failing.

## Configuration

| Variable                | Required | Description                                                                                             |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `OPENGIST_URL`          | yes      | Base URL of your instance, e.g. `https://gist.example.com`. A trailing `/api` is accepted and stripped. |
| `OPENGIST_TOKEN`        | yes      | Personal Access Token, starts with `og_`                                                                |
| `OPENGIST_READ_ONLY`    | no       | `true` registers only the read tools; the write tools do not exist at all in that session               |
| `OPENGIST_INSECURE_TLS` | no       | `true` accepts self-signed certificates, scoped to the Opengist connection (never process-wide)         |

> The token is read once at startup and then removed from `process.env`, so it is not visible to child processes. Use `https://` for anything but a loopback address — over plain http the token and every gist travel in cleartext.
>
> If your instance's `external-url` is not configured, the URLs Opengist reports (and this server passes through) point at `localhost`. Set `external-url` / `OG_EXTERNAL_URL` on the instance so links are usable.

## Installation

### Claude Code

```sh
claude mcp add opengist -s user \
  -e OPENGIST_URL=https://gist.example.com \
  -e OPENGIST_TOKEN=og_your_token \
  -- npx -y opengist-mcp
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opengist": {
      "command": "npx",
      "args": ["-y", "opengist-mcp"],
      "env": {
        "OPENGIST_URL": "https://gist.example.com",
        "OPENGIST_TOKEN": "og_your_token"
      }
    }
  }
}
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.opengist]
command = "npx"
args = ["-y", "opengist-mcp"]
env = { OPENGIST_URL = "https://gist.example.com", OPENGIST_TOKEN = "og_your_token" }
```

### From source

```sh
git clone https://github.com/ni-c/opengist-mcp.git
cd opengist-mcp
npm install
npm run build
```

## Tools

### Reading

| Tool                | Description                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `list_gists`        | List gists: your own, another user's, all public ones, or liked/forked ones (`scope` + optional `username`) |
| `search_gists`      | Find gists by title, description, topics or owner — a bounded client-side scan (Opengist has no search API) |
| `get_gist`          | Get one gist with its file contents, optionally at a revision; commits and forks on request                 |
| `get_gist_file`     | Get the raw content of a single file, at a revision and from an offset — for large or truncated files       |
| `list_gist_commits` | Commit history of a gist, newest first                                                                      |
| `list_gist_forks`   | Forks of a gist                                                                                             |
| `get_user`          | Your own account, or another user by `username` or `userId`                                                 |
| `check_gist_like`   | Whether you liked a gist; distinguishes "not liked" from "not visible to you"                               |

### Writing

| Tool                | Description                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `create_gist`       | Create a gist from a list of files. `visibility` is required; public/unlisted needs a confirmation   |
| `update_gist`       | Change title/description/visibility and write or rename files. Cannot delete files                   |
| `delete_gist_files` | Delete files from a gist — needs a confirmation token bound to exactly those filenames               |
| `delete_gist`       | Delete a gist permanently — needs a confirmation token                                               |
| `fork_gist`         | Fork a gist; reports whether a new fork was created or one already existed                           |
| `set_gist_like`     | Like or unlike a gist idempotently (reads the current state first, so a repeat call is not a toggle) |

### Safety

- **Irreversible actions need a server-generated token.** `delete_gist`, `delete_gist_files` and widening a gist's visibility refuse the first call and return a random, single-use token that expires after five minutes. A plain `confirm: true` flag could be set by the model on its own, or be talked into it by text inside a gist; a token that only ever appeared in a previous tool result cannot. The token for `delete_gist_files` is bound to the exact set of filenames, so a confirmation for one file cannot be replayed to delete another.
- **Publishing content needs the same token.** Creating a `public` or `unlisted` gist, and writing files into a gist that already is one, are disclosure events: whatever the model has in its context becomes readable by others and cannot be withdrawn from anyone who already saw it. Both refuse the first call. The token is bound to the exact content, so a confirmation for one file cannot be replayed with a second one attached. A call that makes the gist private in the same breath is not a disclosure and needs no token.
- **Confirmations are checked after validation.** A call that could not succeed anyway is reported as the input error it is, rather than first costing a confirmation round-trip.
- **Confirmation prompts never quote gist text.** Titles, descriptions, topics and filenames are user-supplied and could carry instructions aimed at manufacturing a confirmation, so refusals show only server-side metadata (visibility, file count, dates).
- **`update_gist` cannot delete a file.** The Opengist API deletes a file when its entry is `null` _or_ carries neither `content` nor `filename` — exactly the shape a sloppily built object has. This server therefore never exposes the raw file map; it accepts explicit `write`/`rename` operations and asserts before sending that no entry could be read as a deletion. Files you do not mention are left untouched.
- **Typos cannot silently duplicate a file.** A write to a filename that does not exist is refused unless `allowCreate: true` is passed, and the refusal names a case-insensitive near match (`readme.md` vs `README.md`).
- **Gist content is untrusted input.** Every response that carries file content is tagged with a note saying so. Treat gist text as data, never as instructions.
- **Results are bounded.** File contents are capped per file and against an overall budget, commits and forks are omitted by default, binary files are not dumped as text, and every truncation is reported together with the call that fetches the rest. `search_gists` states how much it scanned and marks incomplete results explicitly.
- **Requests are hardened.** Redirects are refused so the bearer token cannot be replayed to another host, every request carries a timeout, path parameters reject `.`/`..` and are URL-encoded, and upstream error bodies are truncated with HTML error pages dropped entirely.
- **Residual risk:** `OPENGIST_READ_ONLY` and the confirmation tokens are client-side guards. The real boundary is the scope of your access token and the permission prompts of your MCP host. A token limited to `gist:read`/`user:read` cannot write, whatever the model attempts.

## Development

```sh
npm install
npm run build
npm test
npm run lint
```

### Releasing

Bump the version in `package.json` and `server.json`, move the `## [Unreleased]` section of `CHANGELOG.md` to the new version, commit, then push a tag:

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin main v0.1.0
```

The release workflow verifies that the tag matches the package version, publishes to npm via OIDC trusted publishing (no long-lived token), registers the release in the MCP registry and creates a GitHub release from the changelog section.

## License

[MIT](LICENSE)
