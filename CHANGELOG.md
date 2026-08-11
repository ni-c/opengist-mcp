# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
