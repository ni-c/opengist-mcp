# Contributing

Thanks for taking the time. Small, focused changes with tests land fastest.

## Development setup

```sh
git clone https://github.com/ni-c/opengist-mcp.git && cd opengist-mcp
npm install
npm test          # unit tests plus in-memory MCP client tests against a stubbed fetch
npm run build
```

No Opengist instance is needed for `npm test` — every unit test stubs `fetch`.

## Running the integration suite

Opengist stores each gist as a git repository, which is the part a stubbed
`fetch` cannot represent: a commit exists, a fork is a real clone, a rename is
a tree change. The integration suite spawns the built server over stdio against
a throwaway Opengist in Docker and calls **every tool in the catalogue**.

```sh
npm run build     # the suite runs dist/index.js, not src/
docker compose -f test/integration/compose.yml up -d
npm run test:integration
docker compose -f test/integration/compose.yml down -v
```

`test/integration/bootstrap.ts` does what a browser would, because Opengist has
no API for setting itself up. Five things it knows that cost a session each:

- **Every non-gist route moved under `/-/` in 1.15.** `/register`, `/login` and
  `/settings` are 404s; `/-/register` and friends are the real ones.
- **Personal access tokens arrived in 1.11.** On 1.10 there is no token form at
  all, and no other way to authenticate the API.
- **A token is shown exactly once**, in the flash message on the page rendered
  after the redirect. Re-fetching the list page afterwards is too late — the
  first render consumes the flash.
- **`redirect: 'follow'` loses the session.** undici follows the 302 itself and
  returns only the final response's headers, so the `Set-Cookie` the redirect
  carried is gone and every later page comes back logged out, with nothing
  saying why. The bootstrap follows redirects by hand.
- **`Set-Cookie` carries only what changed.** Replacing the whole cookie string
  with each response drops the session the moment Opengist sets just `flash`.

Two behaviours of Opengist itself that the suite pins:

- **You cannot fork your own gist** — 422, "cannot fork your own gist". That is
  why the bootstrap creates a _second_ account; without it `fork_gist` and
  `list_gist_forks` could not be exercised at all.
- **There is no search API.** `search_gists` scans the list endpoints
  client-side over title, description and topics, and says so in its own
  result. A query matching only file content finds nothing, by construction.

For poking at one tool by hand, the inspector against the same stack — the
bootstrap prints nothing, so mint a token in the UI at
<http://127.0.0.1:6157/-/settings/access-tokens>:

```sh
docker compose -f test/integration/compose.yml up -d
OPENGIST_URL=http://127.0.0.1:6157 OPENGIST_TOKEN=og_... \
  npx @modelcontextprotocol/inspector node dist/index.js
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
- Run `npm run lint` before pushing — it checks both oxlint and prettier, and prettier
  also validates the YAML, JSON and Markdown files.

## Questions and bugs

- Questions and ideas → [Discussions](https://github.com/ni-c/opengist-mcp/discussions)
- Reproducible problems → [Issues](https://github.com/ni-c/opengist-mcp/issues)
- Vulnerabilities → [private reporting](https://github.com/ni-c/opengist-mcp/security/advisories/new),
  never a public issue — see [SECURITY.md](SECURITY.md)
