# Asking a person

Four of the fourteen tools either destroy something or hand it to strangers.
They **ask a person first** — the destroying ones always, the disclosing ones only
when they actually disclose.

Not a `confirm: true` argument the model can set. Not a token the model reads out
of its own previous result. A dialog, raised through [MCP
elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation),
that goes to the client and is shown to whoever is sitting there.

The specification says a client _should_ keep a human in the loop:

> there **SHOULD** always be a human in the loop with the ability to deny tool
> invocations

This server does not rely on that. It raises the question itself, and until an
answer comes back, nothing happens.

## What asks, and when

| Tool                | When it asks                                                |
| ------------------- | ----------------------------------------------------------- |
| `delete_gist`       | always                                                      |
| `delete_gist_files` | always, bound to the exact set of filenames                 |
| `create_gist`       | only when `visibility` is **not** `private`                 |
| `update_gist`       | only when the gist is not private, or the visibility widens |
| everything else     | never                                                       |

The two conditional ones are the interesting half. Widening visibility — private →
unlisted → public — is a **disclosure**, and whatever the model is holding becomes
readable by others and cannot be withdrawn from anyone who already saw it. Nothing
is destroyed; that is exactly why an annotation cannot carry it.

Narrowing visibility is never asked about: making a gist private is not a
disclosure. Neither is `fork_gist` or `set_gist_like`.

Confirmations are checked **after** the arguments are validated, so a call that
could not have succeeded anyway is reported as the input error it is rather than
costing a round-trip.

## What the dialog contains

Server-side metadata only: visibility, file counts, dates. Never a title, a
description, a topic or a filename.

Those are user-supplied, and a gist the model read earlier in the session is
exactly where an instruction aimed at manufacturing a confirmation would sit.

```
This will delete 1 file(s) from gist abc123.

The file contents are not recoverable from here.
```

The approval is bound to its target, so one obtained for a call cannot be
replayed against another. For a _set_ of targets the binding is a fingerprint of
the exact list: an approval for `["a"]` does not execute `["a", "b"]`.

## Clients that cannot show a dialog

Not every MCP client implements elicitation, and a stateless gateway may not be
able to speak for the one it is currently serving. Rather than refuse to work —
which pushes people towards switching the guard off entirely — the tool falls
back to a **two-call token**: the first call returns a random string, the second
has to quote it back.

Be clear about what that proves, because this server is:

> the token proves the call was made twice with the same arguments, and nothing
> more.

A model can read the token out of the first result and call again in the same
turn without anybody seeing it. It catches a widened target set; it does not
catch a model that was talked into the whole thing. The fallback text says so
rather than implying somebody approved.

## Switching the dialog off

```sh
ELICITATION=false
```

Default is `true`. `false` does **not** remove the guard — it takes the fallback
path above, which means the token. There is no setting in which a guarded call
goes unannounced.

Use it where a dialog is the wrong shape rather than an unwanted one: a scheduled
job, a test harness, a client whose dialog interrupts something else.

::: warning It is deliberately not prefixed
`ELICITATION` has no `OPENGIST_` in front of it, so one
`export ELICITATION=false` — or one `-e ELICITATION=false` in a compose file —
reaches **every** MCP server in that environment, not just this one. That is the
point of it and also its risk.

Two things make it visible rather than silent:

- a server started with it off prints one line at startup, in the log of every
  server it actually reached:

  ```
  opengist-mcp: ELICITATION=false — guarded tools fall back to the two-call token
  ```

- the fallback text names the server that did not ask, instead of blaming a
  client that was working fine.
  :::

Anything other than `true` or `false` — `1`, `off`, `yes` — **stops the server**
with exit code 1 and a message naming both valid values. This is the only
variable in this family that defaults to _on_: a typo that fell back to the
default would leave the dialog running while the operator believed it was off,
and there would be nothing to tell them.

## Annotations are the other half, and they are only a hint

Every tool of this server declares all four MCP tool annotations —
`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` — so a
client can tell before it calls what a call would do. See
[Tools](/reference/tools).

They are advice, and the specification says so:

> clients **MUST** consider tool annotations to be untrusted unless they come
> from trusted servers

An annotation is something a client may ignore. The dialog is not: it is enforced
here, on the server side, and no answer means no change. The two are different
claims — the annotation says what a call _does_, the dialog decides whether it
_happens_ — which is why a tool can be marked destructive without being guarded.
`create_gist` is the clearest case: it is `destructiveHint: false` — it creates
something — and it is still asked about when the result is public.

## Behind a gateway

Both protocol revisions are handled from one code path. On `2025-11-25` the
question is pushed to the client; on `2026-07-28` there is no server→client
channel at all, so the call returns `input_required`, ends, and the client
retries carrying the answer.

That answer arrives as ordinary request content, which the SDK does not
validate — so the state that ties an answer to its question is sealed (HMAC). A
reply whose seal does not open, or opens onto a different target, counts as **no
answer** and produces a fresh question rather than an error. The likeliest cause
is not an attack: it is a gateway that put the server to sleep while the person
was reading.

If you run this behind [mcp-hub](https://github.com/ni-c/mcp-hub), the hub passes
elicitation through in both directions; see its
[elicitation guide](https://ni-c.github.io/mcp-hub/guide/elicitation).
