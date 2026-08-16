# What is opengist-mcp?

An [MCP](https://modelcontextprotocol.io) server that puts a self-hosted
[Opengist](https://github.com/thomiceli/opengist) instance in reach of an MCP client:
Claude Code, Claude Desktop, Codex, or anything else that speaks the protocol. It
exposes fourteen tools over the Opengist REST API — reading and searching gists,
fetching individual files and older revisions, and creating, updating, deleting,
forking and liking them.

It runs over stdio as a local process. Your access token stays in that process; the
model only ever sees what the tools return.

## Why

Opengist is where a lot of small, useful text ends up: a config that took an
afternoon to get right, the log excerpt from last week's incident, a script someone
pasted in chat. It is a good place to put things and an awkward place to get them
back out of — the web UI is built for a human with a browser open, not for an
assistant that has been asked "what did we do about this last time?".

Handing a model the raw REST API would answer that, and open two problems with it:

- **Gists are large and often binary-ish.** An unbounded `GET` of a gist with a
  200 KB minified bundle in it fills the context and buys nothing. Everything here is
  capped, and every omission names the call that fetches the rest.
- **Gists are text other people wrote.** A gist is exactly the shape of thing that
  carries "ignore your previous instructions" — either deliberately or because
  someone pasted a prompt-injection example into it years ago. This server marks
  every piece of upstream text as untrusted data, and keeps it out of the sentences
  the model reads as instructions.

The third reason is the one that shaped the write tools: an MCP server with a
`gist:write` token is a publishing channel. See [Security](/guide/security).

## What it is not

- **Not a git client.** It talks to the REST API. Cloning, pushing and branching are
  git's job; `clone_url` and `ssh_url` are returned so you can hand them to git.
- **Not an admin tool.** There is nothing here for users, settings or instance
  administration, and `get_user` deliberately returns an allowlisted set of fields
  rather than whatever the API happens to include.
- **Not a search index.** Opengist has no search endpoint, so `search_gists` is a
  bounded client-side scan that tells you exactly how much it looked at. It is good
  for "find that gist about nginx", not for a full-text query over a large instance.
- **Not a security boundary on its own.** The confirmation tokens and
  `OPENGIST_READ_ONLY` are guard rails. The boundary that holds is the scope of your
  access token.
