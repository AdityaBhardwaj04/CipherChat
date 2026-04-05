#!/usr/bin/env node
/**
 * Fetches the latest PR review comment on the current branch and prints
 * a JSON hookSpecificOutput so Claude Code injects it as context.
 *
 * Used as a SessionStart hook — runs once when Claude Code starts.
 */
import { execFileSync } from 'child_process';

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

try {
  // Resolve current branch → open PR number
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const prJson = run('gh', ['pr', 'list', '--head', branch, '--json', 'number,title,url', '--limit', '1']);
  const prs = JSON.parse(prJson);

  if (!prs.length) {
    // No open PR for this branch — stay silent
    process.exit(0);
  }

  const { number, title, url } = prs[0];

  // Fetch PR comments (issue comments = reviewer bot posts)
  const commentsJson = run('gh', ['pr', 'view', String(number), '--json', 'comments']);
  const { comments } = JSON.parse(commentsJson);

  if (!comments.length) {
    process.exit(0);
  }

  // Take the most recent comment
  const latest = comments[comments.length - 1];
  const author = latest.author?.login ?? 'reviewer';
  const body = latest.body?.trim() ?? '';

  if (!body) process.exit(0);

  // Output JSON — Claude Code injects additionalContext into the session
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        `## Latest PR Review Comment\n` +
        `**PR #${number}:** ${title} (${url})\n` +
        `**From:** @${author}\n\n` +
        `${body}`,
    },
  };

  process.stdout.write(JSON.stringify(output) + '\n');
} catch {
  // Never block session start — silently exit
  process.exit(0);
}
