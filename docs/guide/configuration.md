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

Any value other than the exact string `true` counts as false. `1`, `yes` and `TRUE`
all leave the write tools enabled.
