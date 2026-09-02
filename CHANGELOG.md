# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- #region changelog -->

## [Unreleased]

### Added

- Every tool declares an `outputSchema` and answers with `structuredContent`
  beside the text block. A client no longer has to parse prose to use a result.

  Every tool that reports gist content carries `untrusted: true` and
  `source: "opengist"` as fields. This server has always said so in `notes`,
  which is prose in a list — a client can read it but not check it, and the
  field is what makes it checkable. `check_gist_like`, `set_gist_like` and
  `delete_gist` are without it: their answer is an id they were given and a
  boolean, and a marker on those would be noise.

### Changed

- A result too large even after file contents are dropped is now an error. It
  used to answer with the JSON cut at the ceiling — unparseable, but visible —
  and that is not something `structuredContent` can carry, nor something the
  SDK would accept against the schema the tool declares.

- The two-call `confirm_token` prompt is an error result. What was asked for did
  not happen, which is what `isError` says, and a tool with an output schema may
  not answer without `structuredContent` unless the result is an error. The text
  is unchanged and still carries the token.

- Tools that need a confirmation now **ask the user**, on clients that can show
  a prompt. The two-call token remains for clients that cannot, so nothing that
  works today stops working — but where a person can be asked, one is, instead
  of a token that only proves the same call was made twice. This covers all four
  guarded tools: `create_gist`, `update_gist`, `delete_gist_files` and
  `delete_gist`.

- `ELICITATION` switches the dialog off — `false` sends a client that could have
  been asked down the two-call-token path instead. For a scheduled job or a test
  harness, where a dialog is the wrong shape rather than an unwanted one.

  It does **not** remove the guard: there is no setting in which a guarded call
  goes unannounced. Two deliberate rough edges come with it. The variable is
  **not prefixed**, so one `export ELICITATION=false` reaches every MCP server in
  the environment — which is why a server started with it off prints a line
  saying so, on a line of its own rather than folded into the connection message
  people grep for a URL, and why the fallback text names the server instead of
  blaming a client that was working fine. And a value that is neither `true` nor
  `false` **stops the server**: it is the only variable here that defaults to
  _on_, so failing off on a typo would leave the dialog running while the
  operator believed it was off. It is read after `OPENGIST_TOKEN` is wiped from
  the environment, so that exit cannot leave the token behind.

- A `docs/guide/approval.md` page.

### Changed

- **BREAKING:** the confirmation parameter is now `confirm_token`, not
  `confirmToken`. A caller that sends the old name is told the argument is
  unknown. This server names every parameter in camelCase, so the old spelling
  fitted its neighbours — but the confirmation parameter belongs to the family
  rather than to Opengist, and the prompt text now comes from `mcp-approval`,
  which names it `confirm_token` verbatim. A schema spelling it differently
  would hand the model an instruction its own schema rejects.

- The confirmation prompt is a **plain result rather than an error**. Asking a
  question is not a failure, and the rest of the family answers it this way.

- A `confirm_token` that does not match its arguments is **refused with the
  reason** instead of being answered with a fresh prompt. The binding is
  unchanged: a confirmation issued for one gist still cannot delete another.

- `delete_gist` fetches the gist on every call rather than only when building a
  prompt, so the counts shown are the same whichever way the answer arrives —
  and the gist is confirmed to still exist before it is destroyed.

- Runs on **MCP SDK 2.0**. Existing clients see the same protocol revision they
  always did; the change is the package layout behind it, and it is what lets
  the dialog above work on both protocol eras from one code path — including
  behind a stateless gateway, where the older mechanism silently fell back to
  the weaker token for every client.

- The linter is **oxlint** instead of eslint plus typescript-eslint, which lifts
  the TypeScript ceiling: typescript-eslint pins `typescript` below 6.1, so this
  repository was held on TypeScript 6 by its linter rather than by its code.

- The tool filter, the confirmation store, the host classifier and the
  documentation-asset generator now come from **`mcp-tool-allowlist`**,
  **`mcp-approval`**, **`mcp-internal-hosts`** and **`svg-asset-set`** rather
  than from copies kept here — 652 fewer lines, and one place to fix each. None
  of them has a runtime dependency of its own.

### Fixed

- Confirmation tokens are compared with a **constant-time** comparison. The copy
  in this repository used `!==`, which leaks through timing how much of a guess
  was right. Reaching a token still requires having received it in a previous
  tool result, so this closes a margin rather than a hole.

- An entry in `OPENGIST_ALLOW_TOOLS` that is not tool-name-shaped is now
  **redacted** in the error rather than quoted back. `OPENGIST_TOKEN` and
  `OPENGIST_ALLOW_TOOLS` are adjacent lines in every compose file, and a paste
  into the wrong one used to print the credential into the client's log.

- `MAX_RESULT_BYTES` is a **ceiling** again. The fallback for an oversized
  result only replaced file contents, so a payload whose bulk sat anywhere else
  — twenty thousand filenames, five hundred fork summaries, a hundred long
  descriptions — was announced as truncated and returned in full anyway.
  Megabytes reached the model that way. The result is now cut outright when
  stripping is not enough, and the number of file entries and fork entries a
  single gist detail may carry is capped like the commit list already was, each
  with a note naming the tool that pages through the rest.

- A file named `constructor`, `toString`, `valueOf`, `hasOwnProperty` or
  `__proto__` is handled like any other. The payload builder tested for presence
  against an object literal, so those names answered with an inherited
  `Object.prototype` member: a rename **onto** such a file passed the collision
  check and destroyed it, and a write **to** one was refused as a duplicate that
  did not exist. Filenames come out of the gist, and all five are legal ones.

- `OPENGIST_READ_ONLY` accepts `1` and `yes` as well as `true`, in any casing. A
  switch that takes capability away is read generously on purpose: the exact
  string comparison this replaces left every write tool registered without
  saying a word. `OPENGIST_INSECURE_TLS` grants something instead, so there the
  strict comparison stays — an unrecognised value must fail towards verifying.

### Security

- `update_gist` **asks before publishing a title or a description**. The gate
  tested for file operations, so a call that changed nothing else went straight
  to the PATCH — on a public gist, with a client that could have shown a dialog
  and was never given one. A title and a description are content out of the
  model's context exactly like a file body is, `create_gist` has always
  fingerprinted all three together, and on a public gist they are the part a
  reader sees without opening a file. The prompt names what is about to be
  published and still quotes none of it.

- `SECURITY.md` states what an approval proves and what it does not: binding to
  one operation with one set of arguments, but not freshness. The two-call token
  is single-use, and on a 2025-era connection the dialog answer never leaves the
  process — the residual case, and what to do about it, is written down against
  the day this server serves a protocol revision where it does.

## [0.3.0] - 2026-08-27

### Added

- `OPENGIST_ALLOW_TOOLS` and `OPENGIST_DENY_TOOLS` choose which of the 14
  tools are registered. Both take comma-separated tool names or a prefix with a
  trailing `*`, the allow list decides what is in and the deny list is subtracted
  from it, and `OPENGIST_ALLOW_TOOLS=essential` selects a curated seven —
  `list_gists`, `search_gists`, `get_gist`, `get_gist_file`, `create_gist`, `update_gist`, `delete_gist`. A model picks the right tool far more reliably from seven than
  from fourteen, and every visible tool costs context on every request. Nothing
  changes for an installation that sets neither.

  A filtered tool is not registered at all, so it is absent from `tools/list`
  and answers `tools/call` with "tool not found" — the same cut
  `OPENGIST_READ_ONLY` already makes, not a second, weaker one.

  An entry that matches no tool **stops the server at startup**, naming the
  entry and listing the real names, rather than being ignored: an ignored typo
  leaves a tool missing from `tools/list` with nothing pointing at the cause.

### Changed

- The README now carries the same eight badges, in the same order, as every other
  MCP server in this family, all of them reading from npm rather than hard-coded;
  the opening follows one shape; and the standalone "Full documentation" line is
  gone, because the docs badge three lines above it points at the same page.

### Fixed

- The container image no longer ships OpenSSL 3.5.7-r0, which carries
  **CVE-2026-14456** (denial of service via unbounded memory growth). The pinned
  `node:24-alpine` digest is already the newest one; Alpine's fixed 3.5.8-r0 has
  simply not been rebuilt into it yet, so the runtime stage now upgrades
  `libcrypto3` and `libssl3` by name. Upgrading those two rather than running a
  blanket `apk upgrade` keeps the rest of the image exactly as the digest pins
  it. The step can go once the base image ships the fix.

## [0.2.4] - 2026-08-26

### Changed

- The check that decides whether `OPENGIST_URL` points somewhere local — and
  therefore whether sending a credential over plain `http` is worth warning
  about — now uses the same host classifier as the other MCP servers in this
  family, in `src/hosts.ts`. The string comparison it replaces missed several
  spellings of the same address: `http://[::ffff:127.0.0.1]`, which `URL`
  canonicalises to `[::ffff:7f00:1]` before any check sees it, and `localhost.`
  with its root label. It also treated `127.example.com` as loopback, because it
  matched on the `127.` prefix, and so stayed quiet about a plain-http URL to a
  public host.

Nothing else changes: this server has no tool that takes a URL, so there is no
request whose target a caller can choose.

## [0.2.3] - 2026-08-18

### Fixed

- A malformed `OPENGIST_URL` is no longer echoed into the log. That branch fires
  precisely when the variable does not hold a URL, which most often means the
  token was pasted into the wrong variable — and it then landed verbatim in the
  MCP host's log.

## [0.2.2] - 2026-08-18

### Fixed

- The architecture diagram no longer depends on the reader's operating system.
  It carried a `prefers-color-scheme` block, which resolves against the OS rather
  than the theme toggle of GitHub or npm — so dark-mode readers on a light OS got
  the light artwork on a dark page. The README now uses `<picture>`, which is
  resolved against the page, and the `<img>` that npm falls back to brings its own
  card instead of a media query.

### Changed

- The diagram is generated from a single source, `docs/assets/architecture.source.svg`,
  by `npm run assets`. The four rendered copies had already drifted apart; CI now
  fails if one of them is edited by hand.
- `docs/public/og.png` is generated at exactly 1280x640, GitHub's recommended size
  for a social preview, instead of being drawn by hand.
- The TypeScript major is now parked in `.github/dependabot.yml` with its reason,
  instead of living only as an `@dependabot ignore` on the closed PR #1 — that
  state is invisible to anyone reading the config and is lost if the PR is reopened.

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
[0.2.2]: https://github.com/ni-c/opengist-mcp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ni-c/opengist-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ni-c/opengist-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ni-c/opengist-mcp/releases/tag/v0.1.0

<!-- #endregion changelog -->
