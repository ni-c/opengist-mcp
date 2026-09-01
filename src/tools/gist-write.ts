import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  buildFilesPayload,
  Notes,
  shapeGistDetail,
  type FileOp,
  type RawGist,
} from '../shape.js';

import type { OpengistApi } from '../api.js';
import type { ConfirmationStore } from '../confirm.js';
import { errorResult, jsonResult, run, ToolInputError } from '../result.js';
import { filename, gistId, gistPath, visibility } from '../schema.js';

const SUMMARY_OPTIONS = {
  includeContent: false,
  maxFileBytes: 0,
  maxTotalBytes: 0,
  includeCommits: false,
  maxCommits: 0,
  includeForks: false,
  includeCloneUrls: false,
};

const VISIBILITY_RANK: Record<string, number> = {
  private: 0,
  unlisted: 1,
  public: 2,
};

/**
 * Fingerprints the full effect of a call so a confirmation cannot be replayed
 * for a different one. The digest never reaches the model, so there is no
 * reason to shorten it — a truncated hash only buys an attacker a birthday
 * bound on the very property this is meant to guarantee.
 */
function fingerprint(effect: unknown): string {
  return createHash('sha256').update(JSON.stringify(effect)).digest('hex');
}

/** Loads a gist and refuses up front if it cannot be modified. */
async function loadWritableGist(
  api: OpengistApi,
  id: string
): Promise<RawGist> {
  const gist = (await api.get(gistPath(id))) as RawGist;
  if (gist.archived) {
    throw new ToolInputError(
      `Gist "${id}" is archived and therefore read-only. Un-archive it in the Opengist web UI before changing it.`
    );
  }
  return gist;
}

export function registerGistWriteTools(
  server: McpServer,
  api: OpengistApi,
  confirmations: ConfirmationStore
): void {
  server.registerTool(
    'create_gist',
    {
      title: 'Create a gist',
      description:
        'Create a new gist from one or more files. Topics cannot be set through the API. ' +
        'Expiry can only be set here, never changed afterwards. ' +
        'visibility "public" or "unlisted" publishes the content and therefore needs a confirm_token: ' +
        'the first call is refused and returns one. Use "private" unless the user asked for otherwise.',
      inputSchema: z.object({
        files: z
          .array(
            z.object({
              filename,
              content: z
                .string()
                .min(1)
                .describe(
                  'File content. Must not be empty — Opengist silently drops files without content.'
                ),
            })
          )
          .min(1)
          .max(50)
          .describe('The files of the new gist'),
        visibility: visibility.describe(
          'Required on purpose so the choice is never implicit: public = listed and world-readable, ' +
            'unlisted = reachable by URL only, private = only you. Ask the user if unsure.'
        ),
        title: z
          .string()
          .max(250)
          .optional()
          .describe('Title of the gist; defaults to the first filename'),
        description: z.string().max(1000).optional(),
        confirm_token: z
          .string()
          .optional()
          .describe(
            'Confirmation token from a previous create_gist call with identical arguments. Only required when visibility is public or unlisted; omit on the first call.'
          ),
        expire: z
          .enum(['never', '1hour', '12hours', '1day', '7days', '15days'])
          .optional()
          .describe(
            'Delete the gist automatically after this delay. Mutually exclusive with expiresAt.'
          ),
        expiresAt: z
          .string()
          .optional()
          .describe(
            'Delete the gist automatically at this RFC 3339 timestamp. Mutually exclusive with expire.'
          ),
      }),
      annotations: {},
    },
    ({
      files,
      visibility,
      title,
      description,
      expire,
      expiresAt,
      confirm_token,
    }) =>
      run(async () => {
        if (expire !== undefined && expiresAt !== undefined) {
          throw new ToolInputError(
            'Pass either expire or expiresAt, not both — the API would silently let expiresAt win.'
          );
        }
        const names = files.map((file) => file.filename);
        const duplicate = names.find(
          (name, index) => names.indexOf(name) !== index
        );
        if (duplicate !== undefined) {
          throw new ToolInputError(
            `The file "${duplicate}" is listed more than once; filenames must be unique within a gist.`
          );
        }
        if (expiresAt !== undefined) {
          const timestamp = Date.parse(expiresAt);
          if (Number.isNaN(timestamp)) {
            throw new ToolInputError(
              `expiresAt is not a valid RFC 3339 timestamp: ${expiresAt}`
            );
          }
          if (timestamp <= Date.now()) {
            throw new ToolInputError(
              'expiresAt is in the past; the gist would be deleted immediately.'
            );
          }
        }

        // Creating a public or unlisted gist is a disclosure event, exactly
        // like widening the visibility of an existing one — and it is the
        // stronger primitive of the two, because the content comes from the
        // model's own context rather than from something already stored. A
        // required `visibility` field prevents an accidental public default,
        // not a directed one: text inside a gist read earlier in the session
        // can ask for precisely this call. So it gets the same gate.
        if (visibility !== 'private') {
          const resource = `gist:create:${visibility}:${fingerprint({
            files: files.map((file) => [file.filename, file.content]),
            title: title ?? null,
            description: description ?? null,
            expire: expire ?? null,
            expiresAt: expiresAt ?? null,
          })}`;
          if (!confirmations.consume(resource, confirm_token)) {
            const token = confirmations.issue(resource);
            const bytes = files.reduce(
              (total, file) => total + Buffer.byteLength(file.content, 'utf8'),
              0
            );
            // Only server-side counts are quoted. Filenames, title and
            // description are caller-supplied text that would land in a
            // confirmation prompt a model reads back.
            return errorResult(
              `Creating a ${visibility} gist publishes its content: ${visibility === 'public' ? 'it is listed on the instance and readable by anyone' : 'anyone with the URL can read it, and the URL may be shared onward'}. ` +
                `This call would write ${files.length} file(s), ${bytes} byte(s) in total. Filenames, title and description are withheld here on purpose (they are supplied by the caller, not by the server) — check them in the arguments you are about to send. ` +
                `Confirm with the user that this content may become world-readable, then call create_gist again within ${confirmations.ttlMinutes} minutes with confirm_token: "${token}" and otherwise identical arguments. Use visibility "private" if in doubt.`
            );
          }
        }

        const body: Record<string, unknown> = {
          files: Object.fromEntries(
            files.map((file) => [file.filename, { content: file.content }])
          ),
          visibility,
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(expire !== undefined && { expire }),
          ...(expiresAt !== undefined && { expires_at: expiresAt }),
        };

        const response = await api.post('/gists', body);
        const gist = response.data as RawGist;
        const notes = new Notes();
        const shaped = shapeGistDetail(gist, SUMMARY_OPTIONS, notes);
        return jsonResult({
          created: true,
          ...shaped,
          notes: notes.list(),
        });
      })
  );

  server.registerTool(
    'update_gist',
    {
      title: 'Update a gist',
      description:
        'Change the metadata of a gist and/or write and rename files. ' +
        'Files you do not list are left untouched — never list a file just to preserve it. ' +
        'This tool can never delete a file; use delete_gist_files for that. ' +
        'Widening the visibility (private → unlisted/public, unlisted → public) discloses the gist and therefore needs a confirm_token, ' +
        'as does writing files into a gist that is already public or unlisted. Narrowing the visibility does not.',
      inputSchema: z.object({
        gistId,
        title: z.string().max(250).optional(),
        description: z.string().max(1000).optional(),
        visibility: visibility.optional(),
        fileOps: z
          .array(
            z.discriminatedUnion('op', [
              z.object({
                op: z.literal('write'),
                filename,
                // Empty content is allowed here, unlike in create_gist. Verified
                // against Opengist 2026-08-15: an update entry carrying
                // content:"" keeps the file and empties it, while the same shape
                // on create makes the file disappear. Deletion needs the entry to
                // carry neither content nor filename, which buildFilesPayload
                // refuses to emit.
                content: z
                  .string()
                  .describe(
                    'The complete new content of the file; may be empty to blank the file. Use delete_gist_files to remove it.'
                  ),
              }),
              z.object({
                op: z.literal('rename'),
                filename: filename.describe('The current filename'),
                newFilename: filename.describe('The new filename'),
                content: z
                  .string()
                  .optional()
                  .describe('Optionally replace the content while renaming'),
              }),
            ])
          )
          .min(1)
          .max(50)
          .optional()
          .describe('File changes to apply'),
        allowCreate: z
          .boolean()
          .default(false)
          .describe(
            'Allow a write operation to add a file that does not exist yet. Off by default so a typo in a filename cannot silently create a duplicate file.'
          ),
        confirm_token: z
          .string()
          .optional()
          .describe(
            'Only needed when widening the visibility. Omit on the first call; the refusal returns the token.'
          ),
      }),
      annotations: { idempotentHint: true },
    },
    ({
      gistId: id,
      title,
      description,
      visibility: newVisibility,
      fileOps,
      allowCreate,
      confirm_token,
    }) =>
      run(async () => {
        if (
          title === undefined &&
          description === undefined &&
          newVisibility === undefined &&
          fileOps === undefined
        ) {
          throw new ToolInputError(
            'Nothing to change: pass at least one of title, description, visibility or fileOps.'
          );
        }

        const gist = await loadWritableGist(api, id);
        const current = gist.visibility ?? 'private';
        // What the gist will be visible as once this call is done.
        const effective = newVisibility ?? current;
        const widens =
          newVisibility !== undefined &&
          (VISIBILITY_RANK[newVisibility] ?? 0) >
            (VISIBILITY_RANK[current] ?? 0);
        // Writing new content into an already-public gist discloses it just as
        // surely as widening a private one — same primitive, same content out
        // of the model's context, only without a visibility change to notice.
        // A call that narrows the visibility in the same breath is not a
        // disclosure, which is why this tests the *effective* visibility.
        const publishesContent =
          fileOps !== undefined && effective !== 'private';

        // Validate the operations BEFORE asking for a confirmation. A call that
        // would be rejected anyway must not first cost the user a confirmation
        // round-trip, and a token should only ever be issued for a call that
        // could actually go through.
        const existing = Object.keys(gist.files ?? {});
        const payload =
          fileOps === undefined
            ? undefined
            : buildFilesPayload(fileOps as FileOp[], existing, allowCreate);

        if (widens || publishesContent) {
          // The token is bound to the ENTIRE effect of this call, not just the
          // new visibility. Otherwise a confirmation obtained for "make it
          // public" could be replayed with extra fileOps, title or description
          // attached — the user would have approved disclosure and additionally
          // get content changes they were never shown.
          const effectFingerprint = fingerprint({
            title: title ?? null,
            description: description ?? null,
            visibility: newVisibility,
            allowCreate,
            fileOps:
              (fileOps as FileOp[] | undefined)?.map((op) =>
                op.op === 'write'
                  ? ['write', op.filename, op.content]
                  : ['rename', op.filename, op.newFilename, op.content ?? null]
              ) ?? null,
          });
          const resource = `gist:${id}:update:${effective}:${effectFingerprint}`;
          if (!confirmations.consume(resource, confirm_token)) {
            const token = confirmations.issue(resource);
            const opCount = fileOps === undefined ? 0 : fileOps.length;
            const alsoChanges = [
              title !== undefined && 'the title',
              description !== undefined && 'the description',
              opCount > 0 && `${opCount} file operation(s)`,
            ].filter((v): v is string => Boolean(v));
            const headline = widens
              ? `Changing the visibility of gist ${id} from ${current} to ${newVisibility} makes it readable by others and cannot be undone for anyone who already saw it. `
              : `Gist ${id} is ${current}, so writing to it publishes the new content: ${opCount} file operation(s) whose content becomes readable by others and cannot be withdrawn from anyone who already saw it. `;
            return errorResult(
              headline +
                `The gist has ${Object.keys(gist.files ?? {}).length} file(s). Title, description and filenames are withheld here on purpose (they are user-supplied text). ` +
                (widens && alsoChanges.length > 0
                  ? `This same call also changes ${alsoChanges.join(', ')} — confirm those too. `
                  : widens
                    ? 'This call changes nothing but the visibility. '
                    : '') +
                `Confirm with the user, then call update_gist again within ${confirmations.ttlMinutes} minutes with confirm_token: "${token}" and otherwise identical arguments — the token only works for exactly this set of changes.`
            );
          }
        }

        const body: Record<string, unknown> = {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(newVisibility !== undefined && { visibility: newVisibility }),
          ...(payload !== undefined && { files: payload.files }),
        };

        const previousSha = gist.commits?.[0]?.version;
        const response = await api.patch(gistPath(id), body);
        const updated = response.data as RawGist;
        const notes = new Notes();
        const shaped = shapeGistDetail(updated, SUMMARY_OPTIONS, notes);

        const touched = new Set(
          payload === undefined
            ? []
            : [
                ...payload.written,
                ...payload.created,
                ...payload.renamed.map((rename) => rename.from),
              ]
        );
        notes.add('Files that were not listed were left unchanged.');
        if (previousSha !== undefined) {
          notes.add(
            `The state before this change stays retrievable: get_gist with sha="${previousSha}".`
          );
        }

        return jsonResult({
          updated: true,
          ...shaped,
          changed: {
            title: title !== undefined,
            description: description !== undefined,
            visibility: newVisibility !== undefined,
          },
          fileChanges: {
            written: payload?.written ?? [],
            created: payload?.created ?? [],
            renamed: payload?.renamed ?? [],
            untouched: existing.filter((name) => !touched.has(name)),
          },
          previousRevision: previousSha,
          notes: notes.list(),
        });
      })
  );

  server.registerTool(
    'delete_gist_files',
    {
      title: 'Delete files from a gist',
      description:
        'Delete one or more files from a gist. The files disappear from the current revision; older revisions keep them in the git history. ' +
        'The first call returns a short-lived confirmation token bound to exactly these filenames; ask the user, then call again with confirm_token.',
      inputSchema: z.object({
        gistId,
        filenames: z
          .array(filename)
          .min(1)
          .max(50)
          .describe('The files to delete'),
        confirm_token: z
          .string()
          .optional()
          .describe(
            'Confirmation token from a previous delete_gist_files call for the same gist and the same files. Omit on the first call.'
          ),
      }),
      annotations: { destructiveHint: true },
    },
    ({ gistId: id, filenames, confirm_token }) =>
      run(async () => {
        const sorted = [...new Set(filenames)].sort();
        // Binding the token to the file set stops a confirmation for one file
        // from being replayed to delete additional ones.
        const fileSetFingerprint = createHash('sha256')
          .update(sorted.join('\u0000'))
          .digest('hex');
        const resource = `gist:${id}:rmfiles:${fileSetFingerprint}`;

        const gist = await loadWritableGist(api, id);
        const existing = Object.keys(gist.files ?? {});
        const unknown = sorted.filter((name) => !existing.includes(name));
        if (unknown.length > 0) {
          // Neither list is quoted: `unknown` is caller-supplied and `existing`
          // comes straight from the API, i.e. from whoever wrote the gist.
          throw new ToolInputError(
            `${unknown.length} of the requested file(s) do not exist in gist "${id}", which currently has ${existing.length} file(s). ` +
              'Call get_gist to see the current filenames.'
          );
        }
        if (sorted.length === existing.length) {
          throw new ToolInputError(
            'This would remove every file of the gist, which the API rejects. Use delete_gist to delete the whole gist instead.'
          );
        }

        if (!confirmations.consume(resource, confirm_token)) {
          const token = confirmations.issue(resource);
          const previousSha = gist.commits?.[0]?.version;
          // The filenames are deliberately NOT quoted back here. They are
          // caller-supplied and may have been copied out of a foreign gist, so
          // echoing them would put attacker-chosen text into a confirmation
          // prompt. The caller already knows which files it asked for, and the
          // token is bound to that exact set anyway.
          return errorResult(
            `Deleting ${sorted.length} file(s) from gist ${id}, as listed in this call's filenames argument. ` +
              `They will be gone from the current revision${previousSha !== undefined ? ` (recoverable via get_gist with sha="${previousSha}")` : ''}. ` +
              `Confirm the file list with the user, then call delete_gist_files again within ${confirmations.ttlMinutes} minutes with confirm_token: "${token}".`
          );
        }

        const files = Object.fromEntries(sorted.map((name) => [name, null]));
        const response = await api.patch(gistPath(id), { files });
        const updated = response.data as RawGist;
        const notes = new Notes();
        const shaped = shapeGistDetail(updated, SUMMARY_OPTIONS, notes);
        return jsonResult({
          deletedFiles: sorted,
          ...shaped,
          notes: notes.list(),
        });
      })
  );

  server.registerTool(
    'delete_gist',
    {
      title: 'Delete a gist',
      description:
        'Permanently delete a gist. This is irreversible: the git repository with every revision and the database row are destroyed. ' +
        'The first call returns a short-lived confirmation token; ask the user for confirmation, then call again with confirm_token.',
      inputSchema: z.object({
        gistId,
        confirm_token: z
          .string()
          .optional()
          .describe(
            'Confirmation token from a previous delete_gist call for the same gist. Omit on the first call.'
          ),
      }),
      annotations: { destructiveHint: true },
    },
    ({ gistId: id, confirm_token }) =>
      run(async () => {
        const resource = `gist:${id}:delete`;
        if (!confirmations.consume(resource, confirm_token)) {
          // Fails with an API error if the gist does not exist or is invisible.
          const gist = (await api.get(gistPath(id))) as RawGist;
          const token = confirmations.issue(resource);
          // Only server-side metadata is echoed here. Title, description,
          // topics and filenames are user-supplied text and could carry
          // instructions aimed at manufacturing a confirmation.
          return errorResult(
            `Deleting gist ${id} is irreversible: the git repository with all revisions is destroyed. ` +
              `Gist: visibility=${gist.visibility}, ${Object.keys(gist.files ?? {}).length} file(s), ` +
              `${gist.fork_count ?? 0} fork(s), ${gist.like_count ?? 0} like(s), created ${gist.created_at}` +
              `${gist.archived ? ', archived' : ''}. Title and description are withheld on purpose (user-supplied text). ` +
              `Confirm with the user, then call delete_gist again within ${confirmations.ttlMinutes} minutes with confirm_token: "${token}".`
          );
        }
        await api.delete(gistPath(id));
        return jsonResult({ deleted: true, gistId: id });
      })
  );

  server.registerTool(
    'fork_gist',
    {
      title: 'Fork a gist',
      description:
        "Fork somebody else's gist into your own account. Forking a gist you already forked returns the existing fork instead of creating a second one.",
      inputSchema: z.object({ gistId }),
      annotations: { idempotentHint: true },
    },
    ({ gistId: id }) =>
      run(async () => {
        const response = await api.post(gistPath(id, '/forks'));
        const gist = response.data as RawGist;
        const notes = new Notes();
        const shaped = shapeGistDetail(gist, SUMMARY_OPTIONS, notes);
        if (response.status === 200) {
          notes.add(
            'You had already forked this gist; the existing fork is returned instead of a new one.'
          );
        }
        return jsonResult({
          created: response.status === 201,
          ...shaped,
          notes: notes.list(),
        });
      })
  );
}
