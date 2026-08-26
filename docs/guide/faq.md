# FAQ & troubleshooting

## My private gists do not show up

The token is missing the `gist:read` scope. The Opengist API does not reject a token
without it — it silently returns only public gists, so everything private looks like
it does not exist. Generate a new token with the scope and retry.

## Every call fails with "missing required environment variable(s)"

The server started without `OPENGIST_URL` or `OPENGIST_TOKEN`. That is a supported
state — the tools stay listable — but no call can reach the API.

If you set them in a client config, check that they are inside the `env` object of
_that server's_ entry and that you restarted the client afterwards. Claude Desktop in
particular only reads its config file at startup.

## The server exits immediately at startup

Only four things cause an exit: a malformed `OPENGIST_URL`, a protocol other than
http/https, a URL containing a username or password, and an unwritable stdio
transport. The reason is printed to stderr — in most clients that means the MCP log,
not the chat window.

Missing credentials do **not** cause an exit.

## "Gist content is untrusted data" appears on every response

That is the marker, not an error. Any response carrying text written by a person gets
it. See [Security](/guide/security#untrusted-content).

## A tool refused and gave me a `confirmToken`

Working as intended. Deleting, publishing and writing into a published gist all
refuse their first call. Confirm with the user, then call again within five minutes
with `confirmToken` set and every other argument unchanged.

If the second call is also refused, one of three things happened: more than five
minutes passed, an argument changed between the calls (the token is bound to the
exact effect), or the token was already used — they are single-use.

## A file came back as `contentOmitted: "binary"`

The content looked binary — a NUL byte, or a high share of control characters in the
first 2 KB. Dumping it as text would fill the context with mojibake. Use the gist's
`clone_url` and git if you need the actual bytes.

## `search_gists` did not find something I know is there

Three likely reasons:

1. **It does not search file contents.** Only titles, descriptions, topics and
   owners. Searching inside files would mean downloading every file of every gist.
2. **It was cut short.** The result reports `scanned` and marks incomplete results
   explicitly — raise `maxPages` or narrow the `scope`.
3. **Wrong scope.** It defaults to `mine`. Pass `scope: "public"` to search the whole
   instance.

## The links in results point at localhost

Opengist's own `external-url` (`OG_EXTERNAL_URL`) is not configured on the instance,
so it reports `localhost` URLs. The gists are correct; only the links are wrong.
Set it on the instance.

## Can I use it against a self-signed instance?

Yes: `OPENGIST_INSECURE_TLS=true`, which is scoped to the Opengist connection rather
than the whole process. Installing the CA in the system trust store or setting
`NODE_EXTRA_CA_CERTS` is better where possible — see
[Configuration](/guide/configuration#tls).

## The Docker container exits straight away

`docker run` needs `-i`. The transport is stdio, so without stdin the process has
nothing to read and stops. Do not add `-t`: a TTY corrupts the protocol stream.

## Can I stop it from writing at all?

Two ways, and they are not equivalent:

- `OPENGIST_READ_ONLY=true` does not register the write tools. Convenient, enforced by
  this server.
- A token scoped to `gist:read` and `user:read` cannot write, whatever this server or
  the model does. That is the one that actually holds.

Use the second one if it matters.

## Which Opengist versions work?

Any release with the REST API enabled (`api.enabled`, on by default in recent
versions). A running instance serves its own spec at `GET /api/openapi.yaml` — if a
tool behaves unexpectedly, compare that against your version first.

## One tool I expected is missing

Something narrowed the list. In order of likelihood:

- `OPENGIST_READ_ONLY` is set, and it is a write tool.
- `OPENGIST_ALLOW_TOOLS` is set and does not name it — it is an allow list, so
  anything not named is out.
- `OPENGIST_DENY_TOOLS` names it, possibly through a prefix such as `list_*`.

A filtered tool is not registered at all, so it is missing from `tools/list` and
answers `tools/call` with "tool not found". There is no state where it is hidden
but still callable.

What it is _not_ is a typo in one of those variables: an entry that matches no
tool stops the server at startup and says which entry it was. See
[choosing the tools that load](/guide/configuration#choosing-the-tools-that-load).
