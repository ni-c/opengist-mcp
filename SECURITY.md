# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/ni-c/opengist-mcp/security/advisories/new).
Do not open a public issue for an unpatched vulnerability, and do not include real
credentials, tokens, hostnames or private configuration in a report.

You can expect an initial response within a week. Fixed vulnerabilities are published
as a new release with a note in the CHANGELOG.

## Supported versions

Only the latest release and the current `main` branch receive security fixes.

## Trust model

`OPENGIST_TOKEN` is an Opengist Personal Access Token. Whoever holds it can do
everything its scopes allow on your instance — with the usual `gist:read` +
`gist:write` pair that means reading **every gist your account can see, private and
unlisted ones included**, and creating, rewriting or deleting them. Gists are a place
people paste configuration, logs and half-finished scripts, so treat the token as
equivalent to that whole archive.

Two consequences worth stating plainly:

- **Everything this server returns enters the model's context.** Do not point it at an
  instance whose private gists you would not paste into a chat window.
- **A public gist is a publishing channel.** It is world-readable and, on most
  instances, indexable. Content that goes out through `create_gist` cannot be
  withdrawn from anyone who already fetched it.

Treat every environment variable this server reads as a secret. The token is removed
from `process.env` once it has been read, so it is not visible to child processes,
but it stays in memory for the lifetime of the process.

Destructive and disclosing operations — deleting a gist or its files, widening a
gist's visibility, creating a public or unlisted gist, writing into one — require a
server-generated confirmation token bound to the specific target and the specific
content. A model cannot satisfy that gate on its own: the token only ever appears in
a previous tool result. Data returned from the Opengist API is untrusted input: it is
marked as such, and confirmation prompts never quote it.

`OPENGIST_READ_ONLY=true` registers only the read tools, which is a real reduction of
the attack surface rather than a runtime check — but the boundary that actually holds
is the scope of the access token. A token limited to `gist:read` and `user:read`
cannot write, whatever the model attempts.
