import { assertLoopback, waitForHttp } from 'mcp-integration-harness';

/**
 * Brings the throwaway Opengist from empty to usable, without a browser.
 *
 * Opengist has no API for creating an account or minting a token — both are
 * browser forms — so the bootstrap does what a browser would: register (the
 * first account on a fresh instance becomes the admin), then post the
 * access-token form and read the token out of the page that comes back.
 *
 * Three things here cost a session each, and none of them are in Opengist's
 * documentation:
 *
 *  - **Every non-gist route moved under `/-/` in 1.15.** `/register`,
 *    `/login` and `/settings` are 404s; `/-/register` and friends are the real
 *    ones. A suite written against an older tag fails with a 404 that reads
 *    like a typo.
 *  - **Access tokens are 1.11 or newer.** On 1.10 the settings page has no
 *    token form at all, and there is no other way to authenticate the API.
 *  - **The token is shown exactly once**, as a flash message on the page after
 *    the redirect, prefixed `og_`. Following the redirect and then re-fetching
 *    the list page loses it — the flash is consumed by the first render.
 */

export const USERNAME = 'integration';
export const PASSWORD = 'integration-not-a-secret';
/**
 * A second account, and it is not optional.
 *
 * Opengist refuses `POST /gists/{id}/forks` on your own gist with
 * 422 "cannot fork your own gist", so `fork_gist` and `list_gist_forks` cannot
 * be exercised at all from a single account.
 */
export const OTHER_USERNAME = 'integration-other';
export const OTHER_PASSWORD = 'integration-other-not-a-secret';

export interface Sandbox {
  url: string;
  token: string;
  env: Record<string, string>;
  /** The second account, for the fork tools. */
  other: { username: string; token: string; env: Record<string, string> };
}

function csrf(html: string): string {
  const match = /name="_csrf"[^>]*value="([^"]+)"/.exec(html);
  if (match?.[1] === undefined) {
    throw new Error(
      `no _csrf in the page — Opengist renders one into every form, so a page ` +
        `without it is usually a redirect. Got: ${html.slice(0, 200)}`
    );
  }
  return match[1];
}

class Session {
  /**
   * Kept as a map, not a string, and that is the second trap here.
   *
   * `Set-Cookie` carries only what *changed*. Opengist's register response
   * sets `flash` and nothing else, so replacing the whole cookie string with
   * it drops the CSRF and session cookies — and the next page then comes back
   * logged out, with no error anywhere to say why.
   */
  private readonly cookies = new Map<string, string>();

  constructor(private readonly url: string) {}

  private remember(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    if (this.cookies.size === 0) return extra;
    const cookie = [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    return { ...extra, cookie };
  }

  async get(path: string): Promise<string> {
    const response = await fetch(`${this.url}${path}`, {
      headers: this.headers(),
      // Manual everywhere, and this is the whole reason: `redirect: 'follow'`
      // makes undici follow the 302 itself and return only the final
      // response's headers, so the `Set-Cookie` that the 302 carried — the
      // session — is gone. Registration then appears to succeed and every
      // later page comes back logged out.
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    this.remember(response);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location !== null) {
        return this.get(new URL(location, this.url).pathname);
      }
    }
    return response.text();
  }

  /** Posts a form and returns the page the redirect leads to, rendered. */
  async post(path: string, form: Record<string, string>): Promise<string> {
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/x-www-form-urlencoded',
      }),
      body: new URLSearchParams(form),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    this.remember(response);
    if (response.status >= 400) {
      throw new Error(
        `POST ${path} failed: HTTP ${response.status} — ` +
          `${(await response.text()).slice(0, 300)}`
      );
    }
    const location = response.headers.get('location');
    if (location === null) return response.text();
    // The flash message lives on this render and only on this one.
    return this.get(new URL(location, this.url).pathname);
  }
}

export async function bootstrap(
  url = 'http://127.0.0.1:6157'
): Promise<Sandbox> {
  assertLoopback(url);
  await waitForHttp(`${url}/-/login`, {
    timeoutSeconds: 180,
    ready: (response) => response.ok,
  });

  const token = await accountWithToken(url, USERNAME, PASSWORD, true);
  const otherToken = await accountWithToken(
    url,
    OTHER_USERNAME,
    OTHER_PASSWORD,
    false
  );

  const env = (value: string): Record<string, string> => ({
    OPENGIST_URL: url,
    OPENGIST_TOKEN: value,
    // Defaults to false in this server; set explicitly so the suite does not
    // depend on that default staying put.
    OPENGIST_READ_ONLY: 'false',
  });

  return {
    url,
    token,
    env: env(token),
    other: {
      username: OTHER_USERNAME,
      token: otherToken,
      env: env(otherToken),
    },
  };
}

/** Registers an account through the browser form and mints it a token. */
async function accountWithToken(
  url: string,
  username: string,
  password: string,
  first: boolean
): Promise<string> {
  const session = new Session(url);

  const register = await session.get('/-/register');
  if (!register.includes('name="_csrf"')) {
    throw new Error(
      'Opengist did not offer the registration form at all, which is not the ' +
        'sign-up being refused but the page being missing — check the image ' +
        'tag in compose.yml.'
    );
  }
  await session.post('/-/register', {
    _csrf: csrf(register),
    username,
    password,
  });

  const form = await session.get('/-/settings/access-tokens');
  if (!form.includes('name="scope_gist"')) {
    // Two different failures land here and they need different answers.
    //
    // `OG_DISABLE_SIGNUP` stays false for the whole life of the container, so
    // the form above renders whether or not the account already exists — a
    // check for its presence never fires. And Opengist refuses a duplicate
    // sign-up with 200 and the page re-rendered rather than a 4xx, so `post`
    // does not throw either. On a stack brought up twice the registration is
    // silently rejected, no session is established, and this page is the login
    // form. Reporting that as a wrong image tag sends the reader to the wrong
    // file for a state that `down -v` fixes.
    // Not a check for a login form: an unauthenticated `/-/settings/*` does
    // not render one, it redirects to the gist list, which is a 200 with a
    // "Login" link in the nav and nothing else to go on. A settings page —
    // any settings page, on any version — carries a `_csrf` token because it
    // carries a form; the landing page does not.
    const loggedOut = !form.includes('_csrf');
    throw new Error(
      loggedOut
        ? `Opengist did not sign ${username} in, so this instance already has ` +
            'that account: the suite needs a fresh one, because a duplicate ' +
            'sign-up is refused with a re-rendered page rather than an error. ' +
            'Run `docker compose -f test/integration/compose.yml down -v` and ' +
            'up again.'
        : `Opengist has no access-token form for ${username}, and the session ` +
            'is fine — personal access tokens arrived in 1.11, so check the ' +
            'image tag in compose.yml. The ' +
            (first ? 'first' : 'second') +
            ' account is the one that failed.'
    );
  }
  const created = await session.post('/-/settings/access-tokens', {
    _csrf: csrf(form),
    name: 'integration',
    // Never.
    expires_at: '0',
    // 2 is "Read & Write" on both scopes. A token without gist write can
    // still read public gists, so the failure of getting this wrong is not an
    // error but a short list — which is why it is set explicitly.
    scope_gist: '2',
    scope_user: '2',
  });

  const token = /og_[a-f0-9]{32,}/.exec(created)?.[0];
  if (token === undefined) {
    throw new Error(
      `Opengist did not show a token for ${username}. It appears exactly ` +
        'once, in the flash message on the page rendered after the redirect ' +
        '— re-fetching the list page afterwards is too late, because the ' +
        `first render consumes it. Got: ${created.slice(0, 300)}`
    );
  }
  return token;
}
