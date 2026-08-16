# Getting started

## Requirements

- Node.js ≥ 22
- A running Opengist instance with the REST API enabled (`api.enabled`, which is the
  default in recent releases)
- An Opengist Personal Access Token — see [Configuration](/guide/configuration)

## Run it

```sh
OPENGIST_URL=https://gist.example.com \
OPENGIST_TOKEN=og_your_token \
npx -y opengist-mcp
```

Nothing will appear to happen: the server speaks the MCP protocol over stdin/stdout
and waits for a client. That is the point — you normally never start it by hand, your
MCP client does. See [Connecting clients](/guide/clients) for the configuration
snippet of each one.

Without credentials the server still starts and lists its tools; every call then
fails with setup instructions instead of reaching the API. That is deliberate, so
registries and sandbox inspectors can enumerate the tool surface without a token.

## Check that it works

The quickest smoke test is the MCP Inspector's CLI mode:

```sh
npx -y @modelcontextprotocol/inspector --cli \
  npx -y opengist-mcp \
  --method tools/list
```

With credentials set, a read-only call against the real instance:

```sh
npx -y @modelcontextprotocol/inspector --cli \
  npx -y opengist-mcp \
  --method tools/call --tool-name list_gists --tool-arg scope=mine
```

If that returns your gists, the token and the URL are both right.

## First things to try

Once the server is connected to your client, these are the calls worth knowing:

- _"What gists do I have about nginx?"_ → `search_gists`, a bounded scan over titles,
  descriptions, topics and owners.
- _"Show me the deploy script gist"_ → `get_gist`, which returns file contents up to
  a budget and tells you what it left out.
- _"What changed in it since last month?"_ → `list_gist_commits`, then `get_gist`
  with a `sha` to read an older revision.
- _"Save this as a private gist"_ → `create_gist` with `visibility: "private"`.

Anything that publishes or deletes will come back refused the first time, with a
confirmation token and a description of what it would do. That is
[by design](/guide/security#confirmation-tokens).
