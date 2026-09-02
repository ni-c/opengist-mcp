# Configuration

Everything is configured through environment variables. See the
[environment variable reference](/reference/environment) for the full table.

## Getting a token

In the Opengist web UI: **Settings → Access Tokens → Generate new token**. Opengist
shows the value once; it starts with `og_`.

The server warns on startup if the token does not start with `og_`, because the most
common mistake is pasting an account password instead.

## Required scopes

| Scope        | What it unlocks                                           |
| ------------ | --------------------------------------------------------- |
| `gist:read`  | Reading gists, including your private and unlisted ones   |
| `gist:write` | `create_gist`, `update_gist`, `delete_gist*`, `fork_gist` |
| `user:read`  | `get_user`                                                |
| `user:write` | `set_gist_like` only                                      |

::: warning A token without `gist:read` fails quietly
The API does not reject it. It silently returns only public gists, so your own
private ones simply appear not to exist. If a gist you can see in the browser is
missing from `list_gists`, check the scope first.
:::

If you only want the model to read, the honest way to do it is a token with
`gist:read` and `user:read` and nothing else. `OPENGIST_READ_ONLY=true` is the
convenience version of the same idea — it stops the write tools from being
registered at all — but it is enforced by this server, not by Opengist. See
[Security](/guide/security#what-actually-holds).

## The instance URL

`OPENGIST_URL` is the root of your instance, not the API path:

```sh
OPENGIST_URL=https://gist.example.com
```

A trailing slash is stripped, and a trailing `/api` is accepted and removed rather
than producing `/api/api`.

The server refuses to start if the URL is malformed, uses a protocol other than
http/https, or contains a username or password — credentials in the URL would be sent
on every request in addition to the bearer token and would surface in error messages.

Plain `http://` to anything other than a loopback address produces a warning and then
continues. The token and every gist would travel unencrypted; use `https://`.

::: tip Set `external-url` on the instance
If Opengist's own `external-url` (`OG_EXTERNAL_URL`) is not configured, the URLs it
reports — and that this server passes through — point at `localhost`. The gists are
correct, the links are useless.
:::

## TLS

For an instance with a self-signed or internal-CA certificate:

```sh
OPENGIST_INSECURE_TLS=true
```

This is scoped to the connection to your Opengist instance through a dedicated
undici dispatcher. It does **not** set `NODE_TLS_REJECT_UNAUTHORIZED`, so it cannot
weaken any other request the process makes, and it is only applied to requests whose
origin matches `OPENGIST_URL`.

It still turns off certificate validation for that connection, which means anyone
able to intercept it can read your token. Installing the CA certificate in the
system trust store, or using `NODE_EXTRA_CA_CERTS`, is strictly better where it is an
option.

## Read-only mode

```sh
OPENGIST_READ_ONLY=true
```

The six write tools — `create_gist`, `update_gist`, `delete_gist_files`,
`delete_gist`, `fork_gist`, `set_gist_like` — are not registered. The model does not
see them in `tools/list` and cannot call them, rather than being told "no" after
asking.

`true`, `1` and `yes` all turn it on, in any casing. This switch takes capability
away, so it is read generously on purpose: a spelling an operator plausibly meant
must not quietly leave every write tool registered. `OPENGIST_INSECURE_TLS` is the
opposite case — it grants something — and there only the exact string `true` counts.

## Turning the approval dialog off

Deleting, and anything that widens a gist's visibility, ask a person through MCP
elicitation before they act. `ELICITATION=false` takes them to the two-call token
instead. It does not remove the guard; there is no setting in which a guarded call
goes unannounced.

The variable deliberately carries no `OPENGIST_` prefix, which means it reaches
every MCP server in the same environment, and — unlike the booleans here — a value
it does not recognise **stops the server** rather than failing off. See
[Asking a person](/guide/approval).

## Choosing the tools that load

Read-only mode is one cut, along a line this server drew for you.
`OPENGIST_ALLOW_TOOLS` and `OPENGIST_DENY_TOOLS` let you draw your own:

```sh
OPENGIST_ALLOW_TOOLS=essential
OPENGIST_ALLOW_TOOLS=list_gists,get_gist_file,create_gist
OPENGIST_DENY_TOOLS=delete_*
```

Why bother, when all fourteen work: a model chooses the right tool far more
reliably from a handful than from a long list, and every tool it can see costs
context on every single request. If this is the only MCP server in a session,
fourteen is fine. If it is one of six, it is not.

**The syntax.** Comma-separated entries. An entry is either an exact tool name or
a prefix with a trailing `*` — `list_*` matches every tool whose name starts with
`list_`. Entries are trimmed and case-insensitive, empty ones are ignored, and an
empty value counts as unset. Nothing else is a pattern: `*_x` and `list_*_x` are
rejected rather than silently matching nothing.

**`essential`** is a curated preset of seven:

`list_gists`, `search_gists`, `get_gist`, `get_gist_file`, `create_gist`, `update_gist`, `delete_gist`.

It composes — naming a tool alongside it puts that one back, and
`OPENGIST_DENY_TOOLS` takes one away.

**Both together.** `OPENGIST_ALLOW_TOOLS` decides what is in;
`OPENGIST_DENY_TOOLS` is then subtracted from the result. With only a deny list,
everything else stays.

**A name that matches nothing stops the server**, with the offending entry and the
list of real names. That is deliberate: the alternative is a tool quietly missing
from `tools/list`, and nobody traces an absence back to an environment variable.
The same applies to a pattern that matches no tool.

**With read-only mode**, the write tools are not registered at all, so naming
one explicitly in `OPENGIST_ALLOW_TOOLS` is an error that says so — rather than
calling a tool unknown when it plainly exists. A _pattern_ that covers write
tools is fine and simply contributes nothing, and
`OPENGIST_ALLOW_TOOLS=essential` narrows to the read half of the preset.

::: tip It is the same cut, not a second one
A filtered tool is never registered, so it is absent from `tools/list` and
unknown to `tools/call` alike — exactly what `OPENGIST_READ_ONLY` does to a
write tool. There is no "hidden but callable" state to reason about.
:::
