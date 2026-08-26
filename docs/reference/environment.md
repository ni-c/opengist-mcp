# Environment variables

| Variable                | Required | Default | Description                                                             |
| ----------------------- | -------- | ------- | ----------------------------------------------------------------------- |
| `OPENGIST_URL`          | yes      | —       | Root URL of the instance, e.g. `https://gist.example.com`               |
| `OPENGIST_TOKEN`        | yes      | —       | Personal Access Token, starts with `og_`                                |
| `OPENGIST_READ_ONLY`    | no       | `false` | `true` registers only the eight read tools                              |
| `OPENGIST_INSECURE_TLS` | no       | `false` | `true` accepts self-signed certificates on the Opengist connection only |

Only the exact string `true` enables a boolean. `1`, `yes` and `TRUE` are false.

## `OPENGIST_URL`

The root of the instance, not the API path. A trailing slash is stripped, and a
trailing `/api` is accepted and removed rather than producing `/api/api`.

The server exits at startup if the value is not a valid URL, uses a protocol other
than `http:`/`https:`, or contains a username or password. It warns and continues for
plain `http://` to a non-loopback host — the token and every gist would travel
unencrypted.

## `OPENGIST_TOKEN`

Created in the web UI under **Settings → Access Tokens**. Scopes:
`gist:read`, `gist:write`, `user:read`, and `user:write` for `set_gist_like`. See
[Configuration](/guide/configuration#required-scopes) — a token without `gist:read`
does not fail, it silently returns only public gists.

The value is read once at startup and then removed from `process.env`, so it is not
inherited by child processes and does not appear in `/proc/<pid>/environ`.

A token that does not start with `og_` produces a warning: the usual cause is an
account password pasted in its place.

## `OPENGIST_READ_ONLY`

`true` means `create_gist`, `update_gist`, `delete_gist_files`, `delete_gist`,
`fork_gist` and `set_gist_like` are never registered. The model does not see them.

This is a guard rail in this process, not a boundary — the boundary is the token's
scopes. See [Security](/guide/security#what-actually-holds).

## `OPENGIST_INSECURE_TLS`

`true` disables certificate validation **for connections to `OPENGIST_URL` only**,
through a dedicated undici dispatcher. `NODE_TLS_REJECT_UNAUTHORIZED` is never set,
so no other request the process makes is affected, and the relaxed dispatcher is only
selected when the request origin matches the configured instance.

Prefer installing the CA certificate in the system trust store, or
`NODE_EXTRA_CA_CERTS`, where that is possible.

## Starting without credentials

If `OPENGIST_URL` or `OPENGIST_TOKEN` is missing, the server prints the setup
instructions to stderr and **still starts**. It completes the MCP handshake and
answers `tools/list`; every tool call then fails with the same instructions without
making a request.

This is deliberate: registries and sandbox inspectors start the server without
secrets, and could not enumerate the tool surface otherwise.

## Narrowing the tool list

| Variable               | Required | Description                                                       |
| ---------------------- | -------- | ----------------------------------------------------------------- |
| `OPENGIST_ALLOW_TOOLS` | no       | Tool names, `list_*` prefixes or `essential`; only these register |
| `OPENGIST_DENY_TOOLS`  | no       | Same syntax; subtracted from whatever the allow list left         |

Both are comma-separated. Each entry is either an exact tool name or a prefix with
a single trailing `*`. Entries are trimmed and matched case-insensitively; empty
entries are ignored, and a value that is empty or only whitespace counts as unset —
`OPENGIST_ALLOW_TOOLS=` in a compose file does not mean "allow nothing".
`essential` is recognised only in the allow list, and selects `list_gists`, `search_gists`, `get_gist`, `get_gist_file`, `create_gist`, `update_gist`, `delete_gist`.

**An entry that matches no tool aborts startup**, naming the entry and listing the
valid names, as does a malformed pattern such as `*_x` or `list_*_x`. The
alternative — ignoring the entry — leaves a tool missing from `tools/list` with
nothing pointing at the cause. If both lists together remove everything, the server
refuses to start rather than offering an empty tool list.

Under `OPENGIST_READ_ONLY`, an exact write-tool name in the allow list is an
error naming the read-only setting rather than "unknown tool"; a pattern covering
write tools is accepted and merely contributes nothing, with a warning on stderr.
Deny entries are exempt: denying an already-suppressed tool is how a defensive
list is written.
