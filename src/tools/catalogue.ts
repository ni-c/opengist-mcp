/**
 * The tools this server can register, declared rather than discovered.
 *
 * Declared, because the tool filter has to answer "is this a name you have?"
 * *before* anything is registered — and in read-only mode the write tools are
 * never registered at all. Deriving the catalogue from what actually reached
 * `registerTool` would make `OPENGIST_ALLOW_TOOLS=create_gist` report
 * "unknown tool" under `OPENGIST_READ_ONLY=true`, which is the one answer that
 * is wrong.
 *
 * This is also the full tool surface, hard-coded on purpose: a tool that appears
 * or disappears by accident is a change to the server's contract and has to be a
 * deliberate edit here. `test/tool-filter.test.ts` asserts that these lists and
 * the tools the server really registers are the same set.
 */

/** Registered always. Every one carries `readOnlyHint: true`. */
export const READ_TOOLS = [
  'check_gist_like',
  'get_gist',
  'get_gist_file',
  'get_user',
  'list_gist_commits',
  'list_gist_forks',
  'list_gists',
  'search_gists',
] as const;

/** Registered unless `OPENGIST_READ_ONLY` is set. */
export const WRITE_TOOLS = [
  'create_gist',
  'delete_gist',
  'delete_gist_files',
  'fork_gist',
  'set_gist_like',
  'update_gist',
] as const;

/** Every tool, read-only mode aside. */
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS];

/**
 * What `OPENGIST_ALLOW_TOOLS=essential` selects: the snippet lifecycle.
 *
 * 7 of 14. Left out on purpose: commits, forks and likes — VCS-adjacent and rarely asked for.
 * `delete_gist_files` is covered by `update_gist`.
 */
export const ESSENTIAL_TOOLS: readonly string[] = [
  'list_gists',
  'search_gists',
  'get_gist',
  'get_gist_file',
  'create_gist',
  'update_gist',
  'delete_gist',
];
