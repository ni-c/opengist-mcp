# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-08-16

### Fixed

- The documented value for the `scope` parameter of `list_gists` and `search_gists`
  was wrong: it is `mine`, not `own`. The docs, the getting-started smoke test and the
  demo tape were written from the tool descriptions instead of the schema, and a live
  call against a real instance rejected the value they showed.

### Changed

- `homepage` points at [opengist-mcp.ni-c.de](https://opengist-mcp.ni-c.de) rather
  than the README anchor, so the npm page links to the documentation.
- Published from CI through npm Trusted Publishing, so this release carries build
  provenance. 0.2.0 was published by hand and does not.

## [0.2.0] - 2026-08-16

### Added

- A `Dockerfile` and `.dockerignore`. The image is digest-pinned, runs as the
  unprivileged `node` user under `tini` and carries the MCP Registry ownership label.
  Multi-arch images (amd64, arm64) with an SBOM and build provenance are published to
  `ghcr.io/ni-c/opengist-mcp`.
- A documentation site at [opengist-mcp.ni-c.de](https://opengist-mcp.ni-c.de) with a
  guide, the full tool reference and the security notes.
- CI now runs CodeQL and a Trivy scan of the container image on both architectures in
  addition to the test matrix and `npm audit`. The runtime image ships without npm and
  corepack, whose vendored dependency trees were the only source of HIGH/CRITICAL
  findings on it.

### Changed

- The server now starts **without** `OPENGIST_URL`/`OPENGIST_TOKEN`: it completes the
  MCP handshake and lists its tools, and only a tool call fails with the setup
  instructions. Registries and sandbox inspectors start the server without secrets
  and could not enumerate the tools before. An invalid URL still exits, since that
  one could send the token to the wrong host.
- `get_user` returns an allowlisted set of fields instead of the raw API object, so
  fields Opengist may add later cannot appear in the model context on their own. A
  response that is not a user object is reported as an error naming the likely cause
  instead of being passed through.

### Security

- **Publishing content now needs a confirmation token.** `create_gist` with
  `visibility: "public"` or `"unlisted"` refuses the first call and returns a
  single-use token, the same gate that widening an existing gist's visibility already
  had. Creating a public gist is the stronger of the two primitives — the content
  comes straight out of the model's context rather than from something already stored
  — and a required `visibility` field only prevents an _accidental_ public default,
  not a directed one. `update_gist` gets the same gate when it writes files into a
  gist that is already public or unlisted; a call that makes the gist private in the
  same breath is not a disclosure and stays ungated.
- `update_gist` validates its file operations **before** asking for a confirmation, so
  a call that could never succeed no longer costs a confirmation round-trip and no
  token is ever issued for one.
- The access token is now removed from `process.env` before any early return, not
  after the URL has been parsed. The credential-less start path is exactly the one
  where a token is set and something else is wrong — a typo in the URL, a half-filled
  config — and it used to leave the token readable in `/proc/<pid>/environ`.
- Truncation and binary-content notes refer to a file by its index in the returned
  `files` array instead of quoting its name. A filename is written by whoever created
  the gist; interpolated into server-voice prose it could close the quoting and forge
  what reads as operator guidance. The name is still available to the model as the
  `filename` field of the entry, where it is data rather than prose.
- The untrusted-metadata marker now also fires for the titles, descriptions and topics
  of embedded forks and of the gist a gist was forked from — those are written by
  _other_ users, so a gist with no metadata of its own could carry theirs through
  unmarked. Commit author names get their own marker, and `change_status` is reduced
  to its four documented keys instead of being passed through.
- Responses are refused past 8 MB, by `content-length` where one is declared and while
  reading otherwise. Every per-tool budget trims data that is already resident as a
  string, so without this ceiling a hostile instance could exhaust memory before any
  of them was consulted.
- Confirmation tokens are compared in constant time, and the effect fingerprints they
  are bound to use the full SHA-256 digest instead of its first 64 bits.
- The insecure-TLS dispatcher is now selected only for requests whose origin matches
  the configured instance, independent of the `redirect: 'error'` that already
  prevented cross-origin hops.
- The confirmation token of `update_gist` is now bound to the **entire** effect of the
  call, not just the new visibility. A confirmation obtained for "make this public"
  could previously be replayed with additional `fileOps`, `title` or `description`
  attached, so the user approved disclosure and silently got content changes as well.
  The refusal now also names the other changes the same call would make.
- `delete_gist_files` no longer echoes the filenames it is about to delete into the
  confirmation message, and the "unknown filename" error no longer echoes the
  requested or the existing filenames. Both are attacker-influenceable text in a
  message that a model reads — the rule the other confirmations already followed.
- The "nothing we send may be read as a deletion" invariant is now backed by a
  measurement instead of an assumption. Verified against Opengist on 2026-08-15: on
  **update**, an entry with `content: ""` keeps the file and empties it; only an entry
  that is `null` or carries neither `content` nor `filename` deletes. On **create**,
  by contrast, a file with empty content is silently dropped — which is why
  `create_gist` requires non-empty content and `update_gist` does not.
- Gist titles, descriptions and topics are now tagged as untrusted input in
  `list_gists`, `list_gist_forks`, `search_gists` and the gist detail. Only file
  contents carried that note before, while `list_gists` with `scope: "public"` returns
  the metadata of every gist on the instance — usually the first call of a session.
- The release workflow installs `mcp-publisher` from a pinned version verified against
  a SHA-256 checksum instead of `releases/latest`, and runs `npm ci --ignore-scripts`
  in the job that holds the npm Trusted Publishing credential.

## [0.1.0] - 2026-08-11

### Added

- Initial release: MCP server for the Opengist REST API.
- Read tools: `list_gists` (own, public, liked, forked, and per user), `search_gists`,
  `get_gist`, `get_gist_file`, `list_gist_commits`, `list_gist_forks`, `get_user`,
  `check_gist_like`.
- Write tools: `create_gist`, `update_gist`, `delete_gist_files`, `delete_gist`,
  `fork_gist`, `set_gist_like`.
- `OPENGIST_READ_ONLY=true` registers only the read tools.
- `OPENGIST_INSECURE_TLS=true` accepts self-signed certificates, scoped to the
  Opengist connection instead of process-wide.

### Security

- Irreversible operations (`delete_gist`, `delete_gist_files`, widening a gist's
  visibility) require a server-generated, single-use confirmation token that expires
  after five minutes. The token for `delete_gist_files` is bound to the exact set of
  filenames, so a confirmation cannot be replayed for a larger set.
- Confirmation messages never echo gist titles, descriptions, topics or filenames,
  which are user-supplied text and could be used to manufacture a confirmation.
- The raw Opengist `files` map is never exposed as a tool input, because an entry that
  is `null` or carries neither `content` nor `filename` deletes the file. `update_gist`
  takes explicit `write`/`rename` operations and asserts that nothing it sends can be
  read as a deletion; `delete_gist_files` is the only tool that deletes files.
- A write to a filename that does not exist is refused unless `allowCreate` is set,
  and the refusal names a case-insensitive near match.
- Responses that carry file content are tagged as untrusted input.
- Requests refuse redirects, carry a 30 s timeout, and URL-encode path parameters that
  are additionally validated against `.`/`..` and control characters.
- Upstream error bodies are truncated at 2000 characters and HTML error pages are
  dropped instead of being pushed into the model context.
- The access token is removed from `process.env` after startup, and a URL containing
  credentials is rejected.

[unreleased]: https://github.com/ni-c/opengist-mcp/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/ni-c/opengist-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ni-c/opengist-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ni-c/opengist-mcp/releases/tag/v0.1.0
