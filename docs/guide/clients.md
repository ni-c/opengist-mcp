# Connecting clients

Every snippet below sets the two required variables inline. See
[Configuration](/guide/configuration) for where the token comes from and what else
you can set.

## Claude Code

```sh
claude mcp add opengist -s user \
  -e OPENGIST_URL=https://gist.example.com \
  -e OPENGIST_TOKEN=og_your_token \
  -- npx -y opengist-mcp
```

`-s user` registers it for every project. Use `-s project` to put it in the current
repository's `.mcp.json` instead — but then the token lands in a file you might
commit, so prefer `-s user` unless the whole team shares the instance.

Check it with `/mcp` inside Claude Code; the server should list fourteen tools (eight
with `OPENGIST_READ_ONLY=true`).

## Claude Desktop

`claude_desktop_config.json` — on macOS
`~/Library/Application Support/Claude/`, on Windows `%APPDATA%\Claude\`:

```json
{
  "mcpServers": {
    "opengist": {
      "command": "npx",
      "args": ["-y", "opengist-mcp"],
      "env": {
        "OPENGIST_URL": "https://gist.example.com",
        "OPENGIST_TOKEN": "og_your_token"
      }
    }
  }
}
```

Restart Claude Desktop afterwards; it only reads the file at startup.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.opengist]
command = "npx"
args = ["-y", "opengist-mcp"]
env = { OPENGIST_URL = "https://gist.example.com", OPENGIST_TOKEN = "og_your_token" }
```

## MCP Inspector

Useful for looking at the raw tool schemas and results:

```sh
OPENGIST_URL=https://gist.example.com OPENGIST_TOKEN=og_your_token \
  npx -y @modelcontextprotocol/inspector npx -y opengist-mcp
```

Or headless, which is what the smoke test in
[Getting started](/guide/getting-started#check-that-it-works) uses:

```sh
npx -y @modelcontextprotocol/inspector --cli \
  npx -y opengist-mcp --method tools/list
```

## Docker

A multi-arch image is published to GHCR for every release:

```sh
docker run --rm -i \
  -e OPENGIST_URL=https://gist.example.com \
  -e OPENGIST_TOKEN=og_your_token \
  ghcr.io/ni-c/opengist-mcp:latest
```

`-i` is required: the transport is stdio, and without it the container gets no
stdin and exits immediately. There is no port to publish and no `-t` — a TTY would
corrupt the protocol stream.

As a client entry:

```json
{
  "mcpServers": {
    "opengist": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "OPENGIST_URL",
        "-e",
        "OPENGIST_TOKEN",
        "ghcr.io/ni-c/opengist-mcp:latest"
      ],
      "env": {
        "OPENGIST_URL": "https://gist.example.com",
        "OPENGIST_TOKEN": "og_your_token"
      }
    }
  }
}
```

Passing `-e NAME` without a value forwards the variable from the client's
environment, so the token is not repeated inside the `args` array.

If your Opengist instance is reachable only from the Docker host's network, add
`--network host` — and note that `localhost` inside the container is the container,
not your machine.

## From source

```sh
git clone https://github.com/ni-c/opengist-mcp.git
cd opengist-mcp
npm install
npm run build
```

Then point the client at `node /path/to/opengist-mcp/dist/index.js`.
