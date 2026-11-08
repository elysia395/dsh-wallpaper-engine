'use strict';

const CHECK_NAME = 'issue-claim-policy';
const COMMENT_MARKER = '<!-- issue-claim-policy -->';
const normalize = (login) => String(login || '').toLowerCase();
const sameUser = (a, b) => normalize(a) === normalize(b);
const time = (value) => {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid GitHub timestamp: ${value}`);
  return result;
};
const commentTime = (comment) => Math.max(time(comment.created_at), time(comment.updated_at || comment.created_at));

function parseCommand(body) {
  const match = /^\/(assign|approve|unassign)(?:[ \t]+@?([a-z\d](?:[a-z\d-]*[a-z\d])?))?\s*$/i.exec(String(body || '').trim());
  return match ? { name: match[1].toLowerCase(), target: match[2] || null } : null;
}

function permissionChecker(github, { owner, repo }) {
  const cache = new Map();
  return async (login) => {
    if (sameUser(login, owner)) return true;
    if (!login) return false;
    const key = normalize(login);
    if (!cache.has(key)) {
      const promise = github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login })
        .then(({ data }) => ['admin', 'maintain', 'write'].includes(data.permission))
        .catch((error) => {
          if (error.status === 404) return false;
          throw error;
        });
      cache.set(key, promise);
    }
    return cache.get(key);
  };
}

function parseIssueReferences(body, { owner, repo }) {
  const visible = String(body || '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const numbers = new Set();
  const reasons = [];
  let fence = null;
  for (const line of visible.split(/\r?\n/)) {
    const fenced = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenced) {
      if (!fence) fence = { char: fenced[1][0], length: fenced[1].length };
      else if (fenced[1][0] === fence.char && fenced[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const command = /^\s*(?:[-*]\s+)?(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?)\s*:?\s+(.+?)\s*$/i.exec(line);
    if (!command) {
      if (/\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|refs?)\s*:?\s+(?:#[1-9]\d*|[^\s/]+\/[^\s#]+#[1-9]\d*|https:\/\/github\.com\/[^\s]+\/issues\/)/i.test(line)) {
        reasons.push('Put every closing/reference directive on its own Fixes #123 or Refs #123 line.');
      }
      continue;
    }
    const ref = command[1].replace(/\.$/, '');
    let number;
    if (/^#[1-9]\d*$/.test(ref)) {
      number = Number(ref.slice(1));
    } else {
      const full = /^(?:https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)|([^/\s]+)\/([^#\s]+)#([1-9]\d*))$/i.exec(ref);
      if (!full) {
        reasons.push('Use one explicit issue reference per line, for example: Fixes #123 or Refs #123.');
        continue;
      }
      if (!sameUser(full[1] || full[4], owner) || !sameUser(full[2] || full[5], repo)) {
        reasons.push('Issue references must point to this repository.');
        continue;
      }
      number = Number(full[3] || full[6]);
    }
    if (!Number.isSafeInteger(number)) reasons.push('Invalid issue number.');
    else numbers.add(number);
  }
  if (numbers.size === 0) reasons.push('No linked issue found. Add a separate Fixes #123 or Refs #123 line to the PR body.');
  if (numbers.size > 30) reasons.push('A pull request may reference at most 30 issues.');
  return { numbers: [...numbers], reasons: [...new Set(reasons)] };
}

async function findClaimRequest(comments, login, before, hasWrite) {
  let request = null;
  const ordered = comments.slice().sort((a, b) => commentTime(a) - commentTime(b) || a.id - b.id);
  for (const comment of ordered) {
    const at = commentTime(comment);
    if (at > before) continue;
    const command = parseCommand(comment.body);
    if (!command) continue;
    if (command.name === 'assign' && !command.target && sameUser(comment.user.login, login)) {
      if (!request) request = { comment, at };
    } else if (command.name === 'unassign') {
      const own = sameUser(comment.user.login, login) && (!command.target || sameUser(command.target, login));
      const other = !sameUser(comment.user.login, login) && (!command.target || sameUser(command.target, login));
      if (own || (other && await hasWrite(comment.user.login))) request = null;
    }
  }
  return request;
}

async function issueReasons(github, repoContext, issue, pull, hasWrite) {
  const prefix = `#${issue.number}: `;
  const labels = (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name);
  if (issue.pull_request) return [prefix + 'the reference is a pull request, not an issue.'];
  if (issue.state !== 'open') return [prefix + 'the issue must be open.'];
  if (!labels.includes('status:accepted') || labels.includes('status:declined') || labels.includes('status:needs-triage')) {
    return [prefix + 'a maintainer must accept the issue (status:accepted, without declined/needs-triage).'];
  }
  if (!(issue.assignees || []).some((assignee) => sameUser(assignee.login, pull.user.login))) {
    return [prefix + 'the PR author is not an approved assignee.'];
  }
  const params = { ...repoContext, issue_number: issue.number, per_page: 100 };
  const events = await github.paginate(github.rest.issues.listEventsForTimeline, params);
  const comments = await github.paginate(github.rest.issues.listComments, params);
  const cutoff = time(pull.created_at);
  const acceptance = events.filter((event) => ['labeled', 'unlabeled'].includes(event.event)
    && event.label?.name === 'status:accepted').at(-1);
  if (!acceptance || acceptance.event !== 'labeled' || time(acceptance.created_at) >= cutoff
    || !await hasWrite(acceptance.actor?.login)) {
    return [prefix + 'maintainer acceptance must be recorded before this PR was created.'];
  }
  const assignment = events.filter((event) => ['assigned', 'unassigned'].includes(event.event)
    && sameUser(event.assignee?.login, pull.user.login)).at(-1);
  if (!assignment || assignment.event !== 'assigned' || time(assignment.created_at) >= cutoff) {
    return [prefix + 'approved assignment must be recorded before this PR was created.'];
  }
  const assignedAt = time(assignment.created_at);
  const request = await findClaimRequest(comments, pull.user.login, assignedAt, hasWrite);
  if (!request || request.at >= cutoff) return [prefix + 'the author must request /assign before approval and before creating this PR.'];
  const latestRequest = await findClaimRequest(comments, pull.user.login, Infinity, hasWrite);
  if (!latestRequest || latestRequest.comment.id !== request.comment.id) {
    return [prefix + 'the claim request has been cancelled or changed since approval.'];
  }
  let approvedAt = null;
  if (sameUser(assignment.actor?.login, 'github-actions[bot]')) {
    for (const comment of comments) {
      const command = parseCommand(comment.body);
      if (command?.name !== 'approve' || !sameUser(command.target, pull.user.login)) continue;
      const at = commentTime(comment);
      if (comment.id <= request.comment.id || at < request.at || at > assignedAt || at >= cutoff || !await hasWrite(comment.user.login)) continue;
      if (approvedAt === null || at > approvedAt) approvedAt = at;
    }
  } else if (request.at < assignedAt && await hasWrite(assignment.actor?.login)) {
    approvedAt = assignedAt;
  }
  if (approvedAt === null || time(acceptance.created_at) > approvedAt) {
    return [prefix + 'a maintainer must approve the request (or manually assign it) after accepting the issue and before creating this PR.'];
  }
  return [];
}

async function evaluatePullRequest({ github, repoContext, pull, hasWrite = permissionChecker(github, repoContext) }) {
  if (await hasWrite(pull.user.login)) return { ok: true, exempt: true, reasons: [], numbers: [] };
  const { numbers, reasons } = parseIssueReferences(pull.body, repoContext);
  if (reasons.length) return { ok: false, exempt: false, reasons, numbers };
  for (const number of numbers) {
    let issue;
    try {
      ({ data: issue } = await github.rest.issues.get({ ...repoContext, issue_number: number }));
    } catch (error) {
      if (error.status !== 404) throw error;
      reasons.push(`#${number}: issue not found in this repository.`);
      continue;
    }
    reasons.push(...await issueReasons(github, repoContext, issue, pull, hasWrite));
  }
  return { ok: reasons.length === 0, exempt: false, reasons, numbers };
}

async function enforcePullRequest({ github, context, core, number, hasWrite, dryRun = false }) {
  const repoContext = context.repo;
  const { data: pull } = await github.rest.pulls.get({ ...repoContext, pull_number: number });
  if (pull.state !== 'open') return { number, skipped: true };
  let check;
  const checks = { ...repoContext, name: CHECK_NAME, head_sha: pull.head.sha };
  try {
    if (!dryRun) ({ data: check } = await github.rest.checks.create({ ...checks, status: 'in_progress' }));
    const verdict = await evaluatePullRequest({ github, repoContext, pull, hasWrite });
    if (dryRun) return { number, ...verdict };
    const summary = verdict.ok
      ? (verdict.exempt ? 'Repository owner or collaborator with write permission: prior issue approval is not required.'
        : 'Every linked issue was accepted, requested and approved for this author before the PR was created.')
      : verdict.reasons.map((reason) => '- ' + reason).join('\n');
    await github.rest.checks.update({ ...repoContext, check_run_id: check.id, status: 'completed',
      conclusion: verdict.ok ? 'success' : 'failure', output: { title: verdict.ok ? 'Issue claim policy passed' : 'Prior issue approval required', summary } });
    if (!verdict.ok) {
      const comments = await github.paginate(github.rest.issues.listComments, { ...repoContext, issue_number: number, per_page: 100 });
      const previous = comments.find((comment) => sameUser(comment.user.login, 'github-actions[bot]') && comment.body.includes(COMMENT_MARKER));
      const body = `${COMMENT_MARKER}\nThis PR does not satisfy the repository's prior issue approval policy and is being closed.\n\n${summary}\n\n`
        + 'External contributors must first request an issue with `/assign`, wait for maintainer acceptance and `/approve @username` (or manual assignment), '
        + 'and only then create a PR with a separate `Fixes #123` or `Refs #123` line for every issue. Draft PRs follow the same rule. '
        + 'Approval obtained after this PR was created cannot qualify it: open a new PR after approval. '
        + 'Only the repository owner and collaborators with write permission are exempt.\n\n'
        + `[Contribution policy](https://github.com/${repoContext.owner}/${repoContext.repo}/blob/${context.payload.repository.default_branch}/CONTRIBUTING.md#issue-triage--labels)`;
      if (previous) await github.rest.issues.updateComment({ ...repoContext, comment_id: previous.id, body });
      else await github.rest.issues.createComment({ ...repoContext, issue_number: number, body });
      await github.rest.pulls.update({ ...repoContext, pull_number: number, state: 'closed' });
      core.warning(`PR #${number} closed: ${summary}`);
    }
    return { number, ...verdict };
  } catch (error) {
    if (check) {
      await github.rest.checks.update({ ...repoContext, check_run_id: check.id, status: 'completed', conclusion: 'failure',
        output: { title: 'Issue claim policy could not be verified', summary: 'GitHub API verification failed. No PR is closed merely because verification is unavailable.\n\n' + error.message } });
    }
    throw error;
  }
}

/**
 * 批量重验的**逐条隔离**执行器（二审 F03）。
 *
 * 旧写法在循环里直接 `await`，一条 PR 的 API 故障（限流 / 5xx / 超时）会让整个循环抛出，
 * 队列里其余 PR 全部没有重验、旧判定原样留在 Checks 上（P11 实证：两条关联 PR、第一条
 * pulls.get 注入 503 ⇒ 实际只访问了 [1]，PR #2 没有被尝试）。现在每条独立捕获并继续：
 *   · 失败即时 `core.warning` —— Actions 页面可见，未验证对象按号可追踪；
 *   · 循环结束后统一抛错 —— 本次批量 run 因此**不是 success**（"批次最终不是 success"），
 *     但已验证的 PR 保留本次结果，故障 PR 不自动关闭（验证不可用 ≠ 判定不合格）；
 *   · 不在 catch 里盲目补 `checks.create`：早失败可能还没有可靠的 head SHA，
 *     也可能正是 Checks API 本身在故障（enforcePullRequest 内部已对"check 已建"的
 *     情形把该 check 判 failure）。
 */
async function enforceEach({ github, context, core, pulls, hasWrite, dryRun }) {
  const results = [];
  const failed = [];
  for (const pull of pulls) {
    try {
      results.push(await enforcePullRequest({ github, context, core, number: pull.number, hasWrite, dryRun }));
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      failed.push({ number: pull.number, message });
      core.warning(`PR #${pull.number} could not be verified and keeps its previous check result: ${message}`);
    }
  }
  if (failed.length) {
    throw new Error(`issue-claim-policy: ${failed.length} PR(s) could not be verified`
      + ' (they keep their previous check result; re-run the workflow to retry) — this batch is NOT a success. '
      + 'Failed: ' + failed.map((f) => `#${f.number} (${f.message})`).join('; '));
  }
  return results;
}

async function recheckIssue({ github, context, core, number, dryRun = false }) {
  const pulls = await github.paginate(github.rest.pulls.list, { ...context.repo, state: 'open', per_page: 100 });
  const hasWrite = permissionChecker(github, context.repo);
  const related = pulls.filter((pull) => parseIssueReferences(pull.body, context.repo).numbers.includes(number));
  return enforceEach({ github, context, core, pulls: related, hasWrite, dryRun });
}

async function run({ github, context, core, dryRun = false }) {
  const hasWrite = permissionChecker(github, context.repo);
  if (context.payload.pull_request) {
    return [await enforcePullRequest({ github, context, core, number: context.payload.pull_request.number, hasWrite, dryRun })];
  }
  if (context.payload.issue) {
    if (context.payload.issue.pull_request) return [];
    return recheckIssue({ github, context, core, number: context.payload.issue.number, dryRun });
  }
  const input = String(context.payload.inputs?.pull_number || '').trim();
  if (input && !/^[1-9]\d*$/.test(input)) throw new Error('pull_number must be a positive integer or empty.');
  const pulls = input ? [{ number: Number(input) }]
    : await github.paginate(github.rest.pulls.list, { ...context.repo, state: 'open', per_page: 100 });
  return enforceEach({ github, context, core, pulls, hasWrite, dryRun });
}

module.exports = { CHECK_NAME, COMMENT_MARKER, parseCommand, permissionChecker, parseIssueReferences, findClaimRequest,
  evaluatePullRequest, enforcePullRequest, recheckIssue, run };
