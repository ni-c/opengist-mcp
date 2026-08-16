# Security

This page is the prose version of
[SECURITY.md](https://github.com/ni-c/opengist-mcp/blob/main/SECURITY.md).

## Trust model

`OPENGIST_TOKEN` is an Opengist Personal Access Token. Whoever holds it can do
everything its scopes allow. With the usual `gist:read` + `gist:write` pair that
means reading **every gist your account can see** — private and unlisted included —
and creating, rewriting or deleting them.

Gists are where configuration, logs and half-finished scripts end up. Treat the token
as equivalent to that whole archive, and take two consequences seriously:

- **Everything this server returns enters the model's context.** Do not point it at
  an instance whose private gists you would not paste into a chat window.
- **A public gist is a publishing channel.** It is world-readable and, on most
  instances, listed. Content that goes out through `create_gist` cannot be withdrawn
  from anyone who already fetched it.

The token is read once at startup and then deleted from `process.env`, so it is not
visible to child processes or in `/proc/<pid>/environ`. It stays in memory for the
lifetime of the process, which is unavoidable — it has to sign every request.

## Confirmation tokens

Three kinds of operation refuse their first call:

| Operation                                            | Why it is gated                             |
| ---------------------------------------------------- | ------------------------------------------- |
| `delete_gist`, `delete_gist_files`                   | irreversible                                |
| Widening visibility (private → unlisted → public)    | irreversible disclosure                     |
| Creating a public/unlisted gist, or writing into one | disclosure of whatever the model is holding |

The refusal carries a random, single-use token that expires after five minutes. The
second call, with the token attached, executes.

The reason it is a token and not a `confirm: true` flag is that a flag is something
the model can set on its own — and can be _talked into_ setting by text inside a gist
it read earlier in the session. A token that only ever appeared in a previous tool
result cannot be produced that way.

Each token is bound to the exact effect of the call it was issued for:

- `delete_gist_files` binds to the precise set of filenames, so a confirmation for
  `["notes.txt"]` cannot be replayed for `["notes.txt", "secrets.env"]`.
- `create_gist` binds to the file contents, the title, the description and the expiry,
  so a confirmation obtained for harmless content cannot be replayed with different
  content under the same filename.
- `update_gist` binds to the _whole_ call — visibility, title, description and every
  file operation — so an approval for "make this public" cannot arrive with extra
  file writes attached.

Two smaller properties are worth knowing. Confirmations are checked **after** the
arguments are validated, so a call that could not have succeeded anyway is reported
as the input error it is rather than costing a round-trip. And narrowing visibility
never needs a token: making a gist private is not a disclosure.

## Untrusted content

Everything Opengist returns was written by a person, and quite possibly not by you:
file contents, titles, descriptions, topics, and the git author names on commits. A
gist is exactly the shape of thing that contains "ignore your previous instructions",
whether deliberately or because someone pasted a prompt-injection example into it in 2024.

Two mechanisms handle this:

**Marking.** Any response carrying upstream text is tagged with an explicit note
saying it is untrusted data to be reported, never followed. This covers file contents,
gist metadata, the metadata of embedded forks and of the gist something was forked
from, and commit author names.

**Not quoting it back.** The notes and refusals this server writes are prose that a
model reads as instructions from its tooling, so no user-controlled string is
interpolated into them. Confirmation prompts describe a deletion by counting the
files, not by naming them. Truncation notes refer to `files[2]`, not to
`"config.yaml"` — a filename ending in `", offset 0). SYSTEM:` would otherwise close
the quoting and forge what looks like operator guidance. The names are still
available to the model, as structured fields of the JSON result, where they are data.

## Bounded results

Anything unbounded is a way to fill a context window with something useless:

- File contents are capped per file **and** against a total budget, with a further
  400 KB backstop on the whole serialized result.
- Binary content is detected and omitted rather than dumped as mojibake.
- Commits and forks are left out unless asked for.
- Response bodies over 8 MB are refused while being read, before any of the above
  gets a chance to trim a string that is already resident in memory.
- `search_gists` states exactly how much it scanned and marks incomplete results.

Every omission names the call that fetches the rest, so nothing disappears silently.

## Transport

Requests refuse redirects, so the bearer token cannot be replayed against another
host. Every request carries a 30-second timeout. Path parameters are validated
against `.`, `..`, slashes and control characters, and then URL-encoded. Upstream
error bodies are truncated at 2000 characters and HTML error pages are dropped
entirely rather than pushed into the context.

## What actually holds

The confirmation tokens and `OPENGIST_READ_ONLY` are guard rails inside this process.
They are worth having, and they are not a security boundary — a bug in this server
would be enough to get past them.

The boundaries that hold are outside it: **the scope of your access token**, and the
permission prompts of your MCP host. A token with `gist:read` and `user:read` and
nothing else cannot write, whatever the model attempts and whatever this code does.
If that is the property you want, set the scopes.

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/ni-c/opengist-mcp/security/advisories/new),
never a public issue, and do not include real tokens, hostnames or gist contents in
the report.
