# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/opengist-mcp.git && cd opengist-mcp
npm install
npm test          # unit tests plus in-memory MCP client tests against a stubbed fetch
npm run build
```

No Opengist instance is needed for the test suite — every test stubs `fetch`. If you
want to try changes against a real instance, the quickest one is Opengist's own
container:

```sh
docker run --rm -p 6157:6157 ghcr.io/thomiceli/opengist:1
# then create a token under Settings → Access Tokens
export OPENGIST_URL=http://localhost:6157
export OPENGIST_TOKEN=og_...
node dist/index.js
```

## Expectations

- **Tests.** Behaviour changes come with a test that fails without the change.
  CI runs lint, build and the test suite on Node 22 and 24, plus `npm audit`, CodeQL
  and a Trivy scan of the container image on both architectures.
- **Comments** explain constraints the code cannot show — not what the next line does.
- **Security-sensitive areas** (config parsing, confirmation tokens, anything that
  builds a request URL, anything that puts upstream text into a message a model
  reads): please describe the attack you are defending against, or the one your
  change might open, in the PR text.
- **No new runtime dependencies** without a very good reason; the small tree is a
  feature.
- Run `npm run lint` before pushing — it checks both eslint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/opengist-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/opengist-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/opengist-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
