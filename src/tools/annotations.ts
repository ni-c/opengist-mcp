/**
 * The annotation block every reading tool of this server carries, and the rule
 * the writing ones follow.
 *
 * Written out rather than left to the defaults, because the defaults are not
 * neutral: the specification says `destructiveHint` and `openWorldHint` both
 * default to **true**, so an omitted field is the *stronger* claim. A tool that
 * says nothing is a destructive tool in an open world.
 *
 * The line this family draws for `destructiveHint`:
 *
 *   **Content that a person wrote, replaced with no way back — destructive.**
 *   **A setting, a state or a marker, changed — not destructive.**
 *
 * Opengist is where that line and the confirmations visibly disagree, and the
 * disagreement is correct. `create_gist` and `update_gist` are guarded when
 * they publish, and neither is destructive: publishing content cannot be
 * withdrawn from anyone who has already read it, but nothing is lost. No
 * annotation carries a disclosure risk — `destructiveHint: true` would be the
 * wrong axis and would only look like a warning.
 *
 * `openWorldHint: false`: this server talks to the one Opengist it is
 * configured for.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
