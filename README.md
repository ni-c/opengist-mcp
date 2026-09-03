# opengist-mcp

[![CI](https://img.shields.io/github/actions/workflow/status/ni-c/opengist-mcp/ci.yml?branch=main&label=CI)](https://github.com/ni-c/opengist-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/opengist-mcp)](https://www.npmjs.com/package/opengist-mcp)
[![npm downloads](https://img.shields.io/npm/dm/opengist-mcp)](https://www.npmjs.com/package/opengist-mcp)
[![node](https://img.shields.io/node/v/opengist-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/opengist-mcp)](LICENSE)
[![container](https://img.shields.io/badge/ghcr.io-ni--c%2Fopengist--mcp-blue)](https://github.com/ni-c/opengist-mcp/pkgs/container/opengist-mcp)
[![docs](https://img.shields.io/badge/docs-opengist--mcp.ni--c.de-informational)](https://opengist-mcp.ni-c.de)
[![HTTP • via mcp-hub](https://img.shields.io/badge/HTTP-via%20mcp--hub-6f42c1)](https://mcp-hub.ni-c.de)
[![sponsor](https://img.shields.io/badge/sponsor-ni--c-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ni-c)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Opengist](https://github.com/thomiceli/opengist), the self-hosted pastebin powered by Git.

Lets MCP clients like Claude Code, Claude Desktop or Codex read, search, create, update and delete gists on your own Opengist instance: file contents and revisions, commit history, forks and likes, plus your user account.

Fourteen tools is the ceiling, not the floor: `OPENGIST_ALLOW_TOOLS=essential`
registers a curated seven instead, and a model picks the right tool far more
reliably from seven than from fourteen — see
[choosing which tools load](#choosing-which-tools-load).

<!-- <picture> is resolved against the colour scheme of the page showing it, so GitHub
     picks the variant that matches its own theme toggle. npm strips <picture> and
     <source> when it sanitises the README and keeps the <img>, which is why that
     fallback brings its own dark card instead of relying on a media query. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://opengist-mcp.ni-c.de/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://opengist-mcp.ni-c.de/architecture-light.svg">
  <img src="https://opengist-mcp.ni-c.de/architecture.svg" alt="An MCP client speaks stdio to opengist-mcp, which calls the Opengist REST API over HTTPS; the token stays in the server process and every response is shaped before it reaches the model" width="800">
</picture>

> **Note:** this server talks to the Opengist REST API under `/api`, which is available in recent Opengist releases and enabled by default (`api.enabled`). A running instance serves its own OpenAPI spec at `GET /api/openapi.yaml` — compare it against your version if a tool behaves unexpectedly.

## What makes it different

**Fourteen tools over one API surface**, derived from the Opengist REST API and
verified against a live instance: reading, searching, writing, forking and liking
gists, including revisions, commit history and raw file access.

**Bounded by construction.** File contents are capped per file and against an
overall budget, binary files are never dumped as text, and every truncation names
the call that fetches the rest.

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
| `OPENGIST_READ_ONLY`    | no       | `true`, `1` or `yes` registers only the read tools; the write tools do not exist at all in that session |
| `OPENGIST_INSECURE_TLS` | no       | `true` accepts self-signed certificates, scoped to the Opengist connection (never process-wide)         |
| `OPENGIST_ALLOW_TOOLS`  | no       | Comma-separated tool names, `list_*` prefixes, or `essential` for a curated preset                      |
| `OPENGIST_DENY_TOOLS`   | no       | Same syntax; removed from whatever `OPENGIST_ALLOW_TOOLS` left                                          |
| `ELICITATION`           | no       | `false` replaces the approval dialog with the two-call token. **Not prefixed**                          |

> The token is read once at startup and then removed from `process.env`, so it is not visible to child processes. Use `https://` for anything but a loopback address — over plain http the token and every gist travel in cleartext.
>
> If your instance's `external-url` is not configured, the URLs Opengist reports (and this server passes through) point at `localhost`. Set `external-url` / `OG_EXTERNAL_URL` on the instance so links are usable.

### Choosing which tools load

`OPENGIST_ALLOW_TOOLS` and `OPENGIST_DENY_TOOLS` take comma-separated tool names;
a trailing `*` matches a whole family. `essential` is a curated preset of
seven: `list_gists`, `search_gists`, `get_gist`, `get_gist_file`, `create_gist`, `update_gist`, `delete_gist`.

```sh
OPENGIST_ALLOW_TOOLS=essential
OPENGIST_ALLOW_TOOLS=list_gists,get_gist_file,create_gist
OPENGIST_DENY_TOOLS=delete_*
```

An entry that matches no tool aborts startup and names it, so a typo cannot
silently hide a tool — an absent tool is not something anyone traces back to an
environment variable. A filtered tool is never registered, so it is absent from
`tools/list` and unknown to `tools/call` alike, exactly like a write tool under
`OPENGIST_READ_ONLY`.

If you run several of these servers at once, [mcp-hub](https://mcp-hub.ni-c.de)
is the other answer — its `/hub` endpoint replaces every server's tools with six
meta-tools.

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

### Docker

```sh
docker run --rm -i \
  -e OPENGIST_URL=https://gist.example.com \
  -e OPENGIST_TOKEN=og_your_token \
  ghcr.io/ni-c/opengist-mcp:latest
```

`-i` is required — the transport is stdio. Do not add `-t`; a TTY corrupts the
protocol stream.

### From source

```sh
git clone https://github.com/ni-c/opengist-mcp.git
cd opengist-mcp
npm install
npm run build
```

### Through mcp-hub

A client that cannot spawn a local process — ChatGPT connectors, Claude on the web,
Cursor, LibreChat — reaches opengist-mcp through [mcp-hub](https://mcp-hub.ni-c.de): one
container serves many stdio MCP servers over Streamable HTTP, with an OAuth 2.1 login
behind a single password and long-lived tokens for the clients that cannot do OAuth. Its
`/hub` endpoint puts every server behind six meta-tools, so one connector reaches all of
them without N×tool schemas in the model's context, and it speaks both protocol revisions
— a question this server asks travels through it to the person at the far end.

Its `/config/mcp.json` uses Claude Code's format, so the entry is the one you already
have:

```json
{
  "mcpServers": {
    "opengist": {
      "command": "npx",
      "args": ["-y", "opengist-mcp"],
      "env": { "OPENGIST_ALLOW_TOOLS": "essential" },
      "denyTools": ["delete_*"]
    }
  }
}
```

`allowTools` and `denyTools` there are the hub's **own** per-server filter, which is not
the same thing as `*_ALLOW_TOOLS` in `env` — the difference, and the mistake it invites,
are in the [client guide](https://opengist-mcp.ni-c.de/guide/clients#through-mcp-hub).

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

| Tool                   | Description                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `create_gist` 👤       | Create a gist from a list of files. `visibility` is required; public/unlisted asks a person          |
| `update_gist`          | Change title/description/visibility and write or rename files. Cannot delete files                   |
| `delete_gist_files` 👤 | Delete files from a gist — the approval is bound to exactly those filenames                          |
| `delete_gist` 👤       | Delete a gist permanently                                                                            |
| `fork_gist`            | Fork a gist; reports whether a new fork was created or one already existed                           |
| `set_gist_like`        | Like or unlike a gist idempotently (reads the current state first, so a repeat call is not a toggle) |

### Structured output

Every tool declares an `outputSchema` and answers with `structuredContent`
alongside the text block, so a client can use the result without parsing prose:

```jsonc
{
  "untrusted": true,
  "source": "opengist",
  "scope": "self",
  "pagination": { "page": 1, "perPage": 20, "total": 42, "nextPage": 2 },
  "gists": [{ "id": "abc123", "title": "…", "visibility": "private" }],
  "notes": ["…"],
}
```

Every tool that reports gist content carries `untrusted: true` and
`source: "opengist"` as fields. This server has always said so in `notes` —
prose in a list, which a client can read but not check — and the field is what
makes it checkable. Three tools are without it, because their answer is entirely
this server's own words: `check_gist_like`, `set_gist_like` and `delete_gist`
report an id they were given and a boolean.

An over-budget result still drops file contents first. Where that is not enough
it is now an **error**: it used to answer with the JSON cut at the ceiling,
which a text block tolerates and `structuredContent` cannot.

### Safety

- **Irreversible actions ask a person.** `delete_gist`, `delete_gist_files` and widening a gist's visibility raise a real dialog through MCP elicitation where the client supports it — one the model cannot answer on its behalf. A plain `confirm: true` flag could be set by the model on its own, or be talked into it by text inside a gist. Where the client cannot show a dialog they refuse the first call and return a random, single-use token that expires after five minutes; that proves the call was made twice with the same arguments and nothing more, and the text says so. Either way the approval for `delete_gist_files` is bound to the exact set of filenames, so one for a single file cannot be replayed to delete another. `ELICITATION=false` takes the fallback deliberately; it never removes the guard. See [Asking a person](https://opengist-mcp.ni-c.de/guide/approval).
- **Publishing content is asked about the same way.** Creating a `public` or `unlisted` gist, and writing files into a gist that already is one, are disclosure events: whatever the model has in its context becomes readable by others and cannot be withdrawn from anyone who already saw it. Both ask before they act. The approval is bound to the exact content, so one for a single file cannot be replayed with a second one attached. A call that makes the gist private in the same breath is not a disclosure and is not asked about.
- **Confirmations are checked after validation.** A call that could not succeed anyway is reported as the input error it is, rather than first costing a confirmation round-trip.
- **Confirmation prompts never quote gist text.** Titles, descriptions, topics and filenames are user-supplied and could carry instructions aimed at manufacturing a confirmation, so refusals show only server-side metadata (visibility, file count, dates).
- **`update_gist` cannot delete a file.** The Opengist API deletes a file when its entry is `null` _or_ carries neither `content` nor `filename` — exactly the shape a sloppily built object has. This server therefore never exposes the raw file map; it accepts explicit `write`/`rename` operations and asserts before sending that no entry could be read as a deletion. Files you do not mention are left untouched.
- **Typos cannot silently duplicate a file.** A write to a filename that does not exist is refused unless `allowCreate: true` is passed, and the refusal names a case-insensitive near match (`readme.md` vs `README.md`).
- **Gist content is untrusted input.** Every response that carries file content is tagged with a note saying so. Treat gist text as data, never as instructions.
- **Results are bounded.** File contents are capped per file and against an overall budget, commits and forks are omitted by default, binary files are not dumped as text, and every truncation is reported together with the call that fetches the rest. `search_gists` states how much it scanned and marks incomplete results explicitly.
- **Requests are hardened.** Redirects are refused so the bearer token cannot be replayed to another host, every request carries a timeout, path parameters reject `.`/`..` and are URL-encoded, and upstream error bodies are truncated with HTML error pages dropped entirely.
- **Residual risk:** `OPENGIST_READ_ONLY` and the approval flow are client-side guards. The real boundary is the scope of your access token and the permission prompts of your MCP host. A token limited to `gist:read`/`user:read` cannot write, whatever the model attempts.

## Not exposed, on purpose

**Not a git client.** It talks to the REST API. Cloning, pushing and branching are
git's job — `clone_url` and `ssh_url` come back so you can hand them to git.

**Not an admin tool.** There is nothing here for users, settings or instance
administration, and `get_user` returns an allowlisted set of fields rather than
whatever the API happens to include.

**Not a search index.** Opengist has no search endpoint, so `search_gists` works
with what the API offers rather than pretending to more.

## Safety

- Everything Opengist returns was written by a person, and quite possibly not by
  you — file contents, titles, descriptions, topics and git author names are
  marked as untrusted data, to be reported rather than followed.
- Results are bounded: file contents are capped per file and against an overall
  budget, binary files are never dumped as text, and every truncation names the
  call that fetches the rest.
- Deleting a gist or its files, and widening a gist's visibility, ask a person
  first through MCP elicitation. Where the client cannot show a dialog, the call
  is refused and carries a random single-use token that expires after five
  minutes and only ever appeared in a previous tool result.
- Two ways to stop it writing, and they are not equivalent:
  `OPENGIST_READ_ONLY=true` does not register the write tools, which this server
  enforces; a token scoped to `gist:read` and `user:read` cannot write whatever
  this server or the model does. Use the second one when it matters.
- A public gist is a publishing channel — world-readable on most instances, and
  indexed. Making one is a decision, which is why it asks.

## Documentation

The full guide, tool reference and security notes live at
**[opengist-mcp.ni-c.de](https://opengist-mcp.ni-c.de)** (source in [`docs/`](docs/)).

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

The release workflow verifies that the tag matches the package version, publishes to npm via OIDC trusted publishing (no long-lived token), waits for the container image to appear on GHCR, registers the release in the MCP registry and creates a GitHub release from the changelog section.

If the registry step fails, fix it on `main` and dispatch `mcp-registry.yml` — never re-run the tagged job, which checks out the immutable tag.

## Releasing

Releases are tag-driven. Bump `package.json`, move the `[Unreleased]` notes in
`CHANGELOG.md` under the new version, commit, then:

```sh
git tag -s vX.Y.Z -m "vX.Y.Z"
git push origin main vX.Y.Z
```

The release workflow publishes to npm via Trusted Publishing (OIDC, with
provenance), pushes the multi-arch container image to GHCR, creates the GitHub
release from the CHANGELOG section, and updates the entry in the official MCP
registry.

## Contributing

Issues, discussions and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md). For vulnerabilities please use
[private reporting](https://github.com/ni-c/opengist-mcp/security/advisories/new)
rather than a public issue; the policy is in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Willi Thiel
