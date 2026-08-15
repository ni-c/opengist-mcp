# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A `Dockerfile` and `.dockerignore`. The image is digest-pinned, runs as the
  unprivileged `node` user and carries the MCP Registry ownership label.

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

[Unreleased]: https://github.com/ni-c/opengist-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ni-c/opengist-mcp/releases/tag/v0.1.0
