import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const policy = require('../.github/scripts/issue-claim-policy.cjs');
const claim = require('../.github/scripts/issue-claim.cjs');
const repoContext = { owner: 'owner', repo: 'wallpaper' };
const stamp = (second) => `2026-10-21T00:00:${String(second).padStart(2, '0')}Z`;
const comment = (id, login, body, second) => ({ id, user: { login }, body, created_at: stamp(second), updated_at: stamp(second) });
const event = (kind, second, actor, extra = {}) => ({ event: kind, created_at: stamp(second), actor: { login: actor }, ...extra });
const labelEvent = (kind, second, actor = 'maintainer') => event(kind, second, actor, { label: { name: 'status:accepted' } });
const assignEvent = (kind, second, actor = 'github-actions[bot]', login = 'alice') => event(kind, second, actor, { assignee: { login } });

function fixture() {
  const issue = { number: 12, state: 'open', labels: [{ name: 'status:accepted' }], assignees: [{ login: 'alice' }] };
  const pull = { number: 30, state: 'open', created_at: stamp(30), body: 'Fixes #12', user: { login: 'alice' }, head: { sha: 'abc123' } };
  const state = { issue, pull, events: [labelEvent('labeled', 1), assignEvent('assigned', 6)],
    comments: [comment(1, 'alice', '/assign', 2), comment(2, 'maintainer', '/approve @alice', 5)], prComments: [],
    writes: [], calls: [], permissions: { maintainer: 'write', writer: 'write', admin: 'admin', manager: 'maintain', reader: 'read', triager: 'triage' } };
  const fn = (name, run) => async (params) => {
    state.calls.push([name, params]);
    return run(params);
  };
  const write = (name, params) => state.writes.push([name, params]);
  const issues = {
    get: fn('issue.get', (params) => ({ data: state.issues?.[params.issue_number] || state.issue })),
    listEventsForTimeline: fn('events', () => state.events),
    listComments: fn('comments', (params) => params.issue_number === pull.number ? state.prComments : state.comments),
    createComment: fn('comment.create', (params) => { write('comment', params); return { data: { id: 99 } }; }),
    updateComment: fn('comment.update', (params) => { write('comment.update', params); return { data: {} }; }),
    addAssignees: fn('assign', (params) => {
      write('assign', params);
      if (!state.ignoreAssignment) issue.assignees = params.assignees.map((login) => ({ login }));
      return { data: issue };
    }),
    removeAssignees: fn('unassign', (params) => {
      write('unassign', params);
      if (!state.ignoreAssignment) issue.assignees = issue.assignees.filter((a) => !params.assignees.includes(a.login));
      return { data: issue };
    }),
  };
  const github = { rest: { issues, repos: {
    getCollaboratorPermissionLevel: fn('permission', ({ username }) => {
      if (state.permissionError) throw state.permissionError;
      return { data: { permission: state.permissions[username] || 'read' } };
    }),
  }, pulls: {
    get: fn('pull.get', () => ({ data: state.pull })),
    list: fn('pull.list', () => [state.pull]),
    update: fn('pull.update', (params) => { write('close', params); return { data: {} }; }),
  }, checks: {
    create: fn('check.create', (params) => { write('check.create', params); return { data: { id: 100 } }; }),
    update: fn('check.update', (params) => { write('check.update', params); return { data: {} }; }),
  } }, paginate: async (method, params) => method(params) };
  const context = { repo: repoContext, eventName: 'pull_request_target', payload: { pull_request: pull,
    repository: { default_branch: 'main' }, action: 'opened' } };
  const core = { warning: () => {}, info: () => {} };
  return { state, github, context, core };
}

const evaluate = (f) => policy.evaluatePullRequest({ github: f.github, repoContext, pull: f.state.pull });
const enforce = (f, extra = {}) => policy.enforcePullRequest({ github: f.github, context: f.context, core: f.core, number: 30, ...extra });
const bot = (f, login, body, second = 10) => {
  f.context.payload.issue = f.state.issue;
  f.context.payload.comment = comment(20, login, body, second);
  f.context.payload.action = 'created';
  return claim.run({ github: f.github, context: f.context, core: f.core });
};

for (const [body, numbers] of [
  ['Fixes #12', [12]], ['Refs #12\nFixes #13\nRefs #12', [12, 13]],
  ['fixes owner/wallpaper#12', [12]], ['Refs https://github.com/OWNER/WALLPAPER/issues/12', [12]],
  ['- Resolves #12', [12]], ['<!-- Fixes #99 -->\nFixes #12', [12]],
  ['```md\nFixes #99\n```\nFixes #12', [12]], ['~~~\nFixes #99\n~~~\nFixes #12', [12]],
]) test(`explicit issue references: ${JSON.stringify(body)}`, () => {
  const result = policy.parseIssueReferences(body, repoContext);
  assert.deepEqual(result.numbers, numbers);
  assert.deepEqual(result.reasons, []);
});

for (const body of ['', 'A random #12 reference', '<!-- Fixes #12 -->', '```\nFixes #12\n```',
  'Fixes stranger/wallpaper#12', 'Fixes https://github.com/owner/other/issues/12', 'Fixes #12, #13',
  'Fixes #12 / #13', 'Fixes #0', 'Fixes #9007199254740992', 'Refs https://github.com/owner/wallpaper/pull/12']) {
  test(`reject absent, hidden, malformed or cross-repository links: ${JSON.stringify(body)}`, () => {
    assert.ok(policy.parseIssueReferences(body, repoContext).reasons.length);
  });
}

for (const body of ['Refs #12\nThis change fixes #13', 'Refs #12\nAlso resolves owner/wallpaper#13']) {
  test(`reject hidden inline closing directives: ${body}`, () => {
    assert.ok(policy.parseIssueReferences(body, repoContext).reasons.length);
  });
}

test('manual assignment in the same second cannot prove the request came first', async () => {
  const f = fixture();
  f.state.events[1].actor.login = 'maintainer';
  f.state.events[1].created_at = stamp(2);
  assert.equal((await evaluate(f)).ok, false);
});

test('bot approval in the same second must have a later comment id than the request', async () => {
  const f = fixture();
  f.state.comments[1].created_at = stamp(2);
  f.state.comments[1].updated_at = stamp(2);
  assert.equal((await evaluate(f)).ok, true);
  f.state.comments[1].id = 0;
  assert.equal((await evaluate(f)).ok, false);
});

test('issue reference count is bounded', () => {
  assert.ok(policy.parseIssueReferences(Array.from({ length: 31 }, (_, i) => `Fixes #${i + 1}`).join('\n'), repoContext).reasons.length);
});

for (const login of ['owner', 'OWNER', 'writer', 'admin', 'manager']) test(`owner/write collaborator exemption: ${login}`, async () => {
  const f = fixture();
  f.state.pull.user.login = login;
  f.state.pull.body = '';
  const result = await evaluate(f);
  assert.equal(result.ok, true);
  assert.equal(result.exempt, true);
  assert.equal(f.state.calls.some(([name]) => name === 'issue.get'), false);
});

for (const login of ['alice', 'reader', 'triager']) test(`contributor badge or non-write permission is not an exemption: ${login}`, async () => {
  const f = fixture();
  f.state.pull.user.login = login;
  f.state.pull.author_association = 'CONTRIBUTOR';
  f.state.pull.body = '';
  assert.equal((await evaluate(f)).ok, false);
});

test('external author with prior accepted, requested and approved claim passes', async () => {
  assert.equal((await evaluate(fixture())).ok, true);
});

test('trusted manual assignment after the request also passes', async () => {
  const f = fixture();
  f.state.events[1].actor.login = 'maintainer';
  f.state.comments.pop();
  assert.equal((await evaluate(f)).ok, true);
});

const refusals = [
  ['unaccepted', (s) => { s.issue.labels = []; }],
  ['still needs triage', (s) => { s.issue.labels.push({ name: 'status:needs-triage' }); }],
  ['declined', (s) => { s.issue.labels.push({ name: 'status:declined' }); }],
  ['closed issue', (s) => { s.issue.state = 'closed'; }],
  ['reference to a PR', (s) => { s.issue.pull_request = {}; }],
  ['unassigned author', (s) => { s.issue.assignees = []; }],
  ['assigned to somebody else', (s) => { s.issue.assignees = [{ login: 'bob' }]; }],
  ['missing request', (s) => { s.comments.shift(); }],
  ['missing assignment event', (s) => { s.events.pop(); }],
  ['missing acceptance history', (s) => { s.events.shift(); }],
  ['untrusted acceptance', (s) => { s.events[0].actor.login = 'alice'; }],
  ['self assignment', (s) => { s.events[1].actor.login = 'alice'; }],
  ['unapproved bot assignment', (s) => { s.comments.pop(); }],
  ['untrusted approval', (s) => { s.comments[1].user.login = 'alice'; }],
  ['approval for somebody else', (s) => { s.comments[1].body = '/approve @bob'; }],
  ['approval before request', (s) => { s.comments[1] = comment(2, 'maintainer', '/approve @alice', 1); }],
  ['accepted only after approval', (s) => { s.events[0].created_at = stamp(7); }],
  ['accepted only after PR', (s) => { s.events[0].created_at = stamp(31); }],
  ['assignment only after PR', (s) => { s.events[1].created_at = stamp(31); }],
  ['assignment in the same timestamp as PR', (s) => { s.events[1].created_at = stamp(30); }],
  ['request edited after PR', (s) => { s.comments[0].updated_at = stamp(31); }],
  ['approval edited after PR', (s) => { s.comments[1].updated_at = stamp(31); }],
  ['request deleted', (s) => { s.comments = s.comments.slice(1); }],
  ['approval deleted', (s) => { s.comments = s.comments.slice(0, 1); }],
  ['request edited into plain text', (s) => { s.comments[0].body = 'I would like to help'; }],
  ['claim cancellation', (s) => { s.comments.push(comment(3, 'alice', '/unassign', 8)); }],
  ['maintainer cancellation', (s) => { s.comments.push(comment(3, 'maintainer', '/unassign @alice', 8)); }],
  ['unassignment history', (s) => { s.events.push(assignEvent('unassigned', 8, 'maintainer')); }],
  ['reassignment only after PR', (s) => { s.events.push(assignEvent('unassigned', 8), assignEvent('assigned', 31)); }],
  ['label removed and reapplied after PR', (s) => { s.events.push(labelEvent('unlabeled', 8), labelEvent('labeled', 31)); }],
];
for (const [name, mutate] of refusals) test(`external PR rejects ${name}`, async () => {
  const f = fixture();
  mutate(f.state);
  const result = await evaluate(f);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.length);
});

test('a third party cannot cancel a valid claim', async () => {
  const f = fixture();
  f.state.comments.push(comment(3, 'bob', '/unassign @alice', 8));
  assert.equal((await evaluate(f)).ok, true);
});

test('a repeated /assign does not cancel an existing approved request', async () => {
  const f = fixture();
  f.state.comments.push(comment(3, 'alice', '/assign', 8));
  assert.equal((await evaluate(f)).ok, true);
});

test('every linked issue is checked, not just the first one', async () => {
  const f = fixture();
  f.state.pull.body += '\nFixes #13';
  f.state.issues = { 13: { ...f.state.issue, number: 13, assignees: [] } };
  const result = await evaluate(f);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.startsWith('#13:')));
});

test('a missing issue is a policy rejection', async () => {
  const f = fixture();
  f.github.rest.issues.get = async () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
  assert.equal((await evaluate(f)).ok, false);
});

for (const status of [403, 429, 500]) test(`permission API error ${status} fails closed without closing the PR`, async () => {
  const f = fixture();
  f.state.permissionError = Object.assign(new Error('API unavailable'), { status });
  await assert.rejects(enforce(f), /API unavailable/);
  assert.equal(f.state.writes.some(([name]) => name === 'close'), false);
  assert.ok(f.state.writes.some(([name, params]) => name === 'check.update' && params.conclusion === 'failure'));
});

test('404 permission lookup denies exemption instead of bypassing the policy', async () => {
  const f = fixture();
  f.state.permissionError = Object.assign(new Error('Not a collaborator'), { status: 404 });
  f.state.pull.body = '';
  assert.equal((await evaluate(f)).ok, false);
});

test('timeline/API failure does not auto-close a PR', async () => {
  const f = fixture();
  f.github.rest.issues.listEventsForTimeline = async () => { throw new Error('Timeline unavailable'); };
  await assert.rejects(enforce(f), /Timeline unavailable/);
  assert.equal(f.state.writes.some(([name]) => name === 'close'), false);
});

test('successful policy check is attached to the PR head, not to the base SHA', async () => {
  const f = fixture();
  const result = await enforce(f);
  assert.equal(result.ok, true);
  assert.deepEqual(f.state.writes.map(([name]) => name), ['check.create', 'check.update']);
  assert.equal(f.state.writes[0][1].head_sha, 'abc123');
  assert.equal(f.state.writes[0][1].name, 'issue-claim-policy');
  assert.equal(f.state.writes[1][1].conclusion, 'success');
});

test('invalid PR is failed, explained and closed in order', async () => {
  const f = fixture();
  f.state.pull.body = '';
  assert.equal((await enforce(f)).ok, false);
  assert.deepEqual(f.state.writes.map(([name]) => name), ['check.create', 'check.update', 'comment', 'close']);
  assert.equal(f.state.writes[1][1].conclusion, 'failure');
  assert.equal(f.state.writes.at(-1)[1].state, 'closed');
});

test('reopening an invalid PR updates the bot explanation instead of adding spam', async () => {
  const f = fixture();
  f.state.pull.body = '';
  f.state.prComments.push(comment(50, 'github-actions[bot]', policy.COMMENT_MARKER + '\nPrevious reason', 20));
  await enforce(f);
  assert.equal(f.state.writes.some(([name]) => name === 'comment'), false);
  assert.equal(f.state.writes.some(([name, params]) => name === 'comment.update' && params.comment_id === 50), true);
});

test('external user cannot impersonate a bot explanation marker', async () => {
  const f = fixture();
  f.state.pull.body = '';
  f.state.prComments.push(comment(50, 'alice', policy.COMMENT_MARKER, 20));
  await enforce(f);
  assert.equal(f.state.writes.some(([name]) => name === 'comment.update'), false);
  assert.equal(f.state.writes.some(([name]) => name === 'comment'), true);
});

test('already closed or merged PR is untouched', async () => {
  const f = fixture();
  f.state.pull.state = 'closed';
  assert.equal((await enforce(f)).skipped, true);
  assert.deepEqual(f.state.writes, []);
});

test('dry-run evaluates actual API data without any write', async () => {
  const f = fixture();
  assert.equal((await enforce(f, { dryRun: true })).ok, true);
  assert.deepEqual(f.state.writes, []);
});

test('issue changes re-evaluate related open PRs', async () => {
  const f = fixture();
  f.state.issue.labels = [];
  const result = await policy.recheckIssue({ github: f.github, context: f.context, core: f.core, number: 12 });
  assert.equal(result[0].ok, false);
  assert.equal(f.state.writes.some(([name]) => name === 'close'), true);
});

test('issue changes leave unrelated PRs alone', async () => {
  const f = fixture();
  const result = await policy.recheckIssue({ github: f.github, context: f.context, core: f.core, number: 99 });
  assert.deepEqual(result, []);
  assert.deepEqual(f.state.writes, []);
});

// 二审 F03：批量重验必须**逐条隔离**——一条 PR 的 API 故障不再让其余关联 PR 失去重验。
// 验收口径：其余仍被尝试；批次最终不是 success（抛错）；故障不触发自动关闭；未验证可追踪。
const threePulls = (f) => {
  const p2 = { ...f.state.pull, number: 31, head: { sha: 'def456' } };
  const p3 = { ...f.state.pull, number: 32, head: { sha: 'ghi789' } };
  f.github.rest.pulls.list = async () => [f.state.pull, p2, p3];
  return p2;
};

test('one API failure does not stop re-verification of the remaining PRs (first fails)', async () => {
  const f = fixture();
  const p2 = threePulls(f);
  let getCalls = 0;
  f.github.rest.pulls.get = async (params) => {
    getCalls += 1;
    if (params.pull_number === f.state.pull.number) throw Object.assign(new Error('503 upstream'), { status: 503 });
    return { data: params.pull_number === p2.number ? p2 : { ...f.state.pull, number: 32, head: { sha: 'ghi789' } } };
  };
  const warnings = [];
  const core = { warning: (m) => warnings.push(m), info: () => {} };
  await assert.rejects(
    policy.recheckIssue({ github: f.github, context: f.context, core, number: 12 }),
    /NOT a success\. Failed: #30 \(/,
  );
  assert.equal(getCalls, 3, '三条关联 PR 都必须被尝试（故障不截断队列）');
  assert.equal(f.state.writes.some(([n, p]) => n === 'check.create' && p.head_sha === 'def456'), true, 'PR #31 仍被重验');
  assert.equal(f.state.writes.some(([n, p]) => n === 'check.create' && p.head_sha === 'ghi789'), true, 'PR #32 仍被重验');
  assert.equal(warnings.some((m) => m.includes('#30')), true, '失败 PR 按号可追踪（core.warning）');
  assert.equal(f.state.writes.some(([n]) => n === 'close'), false, 'API 故障不得自动关闭任何 PR');
});

test('one API failure does not stop re-verification of the remaining PRs (second fails)', async () => {
  const f = fixture();
  const p2 = threePulls(f);
  let getCalls = 0;
  f.github.rest.pulls.get = async (params) => {
    getCalls += 1;
    if (params.pull_number === p2.number) throw new Error('boom');
    return { data: params.pull_number === f.state.pull.number ? f.state.pull : { ...f.state.pull, number: 32, head: { sha: 'ghi789' } } };
  };
  const warnings = [];
  const core = { warning: (m) => warnings.push(m), info: () => {} };
  await assert.rejects(
    policy.recheckIssue({ github: f.github, context: f.context, core, number: 12 }),
    /NOT a success\. Failed: #31 \(/,
  );
  assert.equal(getCalls, 3, '第 2 条故障后第 3 条仍被尝试');
  assert.equal(f.state.writes.some(([n, p]) => n === 'check.create' && p.head_sha === 'abc123'), true, 'PR #30 在故障前已被重验');
  assert.equal(f.state.writes.some(([n, p]) => n === 'check.create' && p.head_sha === 'ghi789'), true, 'PR #32 仍被重验');
  assert.equal(warnings.some((m) => m.includes('#31')), true);
  assert.equal(f.state.writes.some(([n]) => n === 'close'), false, 'API 故障不得自动关闭任何 PR');
});

test('a batch without API failures keeps returning plain results', async () => {
  const f = fixture();
  threePulls(f);
  const warnings = [];
  const core = { warning: (m) => warnings.push(m), info: () => {} };
  const result = await policy.recheckIssue({ github: f.github, context: f.context, core, number: 12 });
  assert.deepEqual(warnings, []);
  assert.equal(result.length, 3);
  assert.equal(result.every((r) => r.ok), true);
});

for (const [body, result] of [['/assign', { name: 'assign', target: null }], ['/APPROVE @alice', { name: 'approve', target: 'alice' }],
  ['/unassign bob', { name: 'unassign', target: 'bob' }], ['Please /assign', null], ['/assign\n/approve @alice', null], ['/approve @alice extra', null]]) {
  test(`strict command parser: ${JSON.stringify(body)}`, () => assert.deepEqual(policy.parseCommand(body), result));
}

test('external /assign records a request but does not self-approve', async () => {
  const f = fixture();
  f.state.issue.assignees = [];
  await bot(f, 'alice', '/assign');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
  assert.match(f.state.writes.at(-1)[1].body, /not approval/);
});

test('an external contributor may request an untriaged issue but must wait', async () => {
  const f = fixture();
  f.state.issue.labels = [];
  f.state.issue.assignees = [];
  await bot(f, 'alice', '/assign');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
  assert.match(f.state.writes.at(-1)[1].body, /wait/);
});

test('external users cannot approve themselves', async () => {
  const f = fixture();
  f.state.issue.assignees = [];
  await bot(f, 'alice', '/approve @alice');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
});

test('maintainer can approve an earlier request', async () => {
  const f = fixture();
  f.state.issue.assignees = [];
  await bot(f, 'maintainer', '/approve @alice');
  assert.ok(f.state.writes.some(([name, params]) => name === 'assign' && params.assignees[0] === 'alice'));
});

test('approval without a previous request is rejected', async () => {
  const f = fixture();
  f.state.issue.assignees = [];
  f.state.comments = [];
  await bot(f, 'maintainer', '/approve @alice');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
});

test('a cancelled request cannot be approved', async () => {
  const f = fixture();
  f.state.issue.assignees = [];
  f.state.comments.push(comment(3, 'alice', '/unassign', 8));
  await bot(f, 'maintainer', '/approve @alice');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
});

test('an issue must be accepted before approval', async () => {
  const f = fixture();
  f.state.issue.labels = [{ name: 'status:needs-triage' }];
  f.state.issue.assignees = [];
  await bot(f, 'maintainer', '/approve @alice');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
});

test('a closed issue cannot be approved', async () => {
  const f = fixture();
  f.state.issue.state = 'closed';
  f.state.issue.assignees = [];
  await bot(f, 'maintainer', '/approve @alice');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
});

test('an existing other assignee cannot be overwritten', async () => {
  const f = fixture();
  f.state.issue.assignees = [{ login: 'bob' }];
  await bot(f, 'maintainer', '/approve @alice');
  assert.equal(f.state.writes.some(([name]) => name === 'assign'), false);
});

test('GitHub silently omitting an assignee is an error, not success', async () => {
  const f = fixture();
  f.state.issue.assignees = [];
  f.state.ignoreAssignment = true;
  await assert.rejects(bot(f, 'maintainer', '/approve @alice'), /did not assign/);
  assert.equal(f.state.writes.some(([name, params]) => name === 'comment' && /approved and assigned/.test(params.body)), false);
});

test('maintainer /unassign removes the actual assignee, not the maintainer', async () => {
  const f = fixture();
  await bot(f, 'maintainer', '/unassign');
  assert.deepEqual(f.state.writes.find(([name]) => name === 'unassign')[1].assignees, ['alice']);
  assert.deepEqual(f.state.issue.assignees, []);
});

test('maintainer /unassign @alice releases only the named assignee', async () => {
  const f = fixture();
  f.state.issue.assignees.push({ login: 'bob' });
  await bot(f, 'maintainer', '/unassign @alice');
  assert.deepEqual(f.state.issue.assignees, [{ login: 'bob' }]);
});

test('a third party cannot release another contributor', async () => {
  const f = fixture();
  await bot(f, 'bob', '/unassign @alice');
  assert.equal(f.state.writes.some(([name]) => name === 'unassign'), false);
});

test('claim commands under a PR are ignored', async () => {
  const f = fixture();
  f.state.issue.pull_request = {};
  await bot(f, 'alice', '/assign');
  assert.deepEqual(f.state.writes, []);
});

function workflowScript(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const script = / {10}script: \|\n([\s\S]*)/.exec(source)?.[1];
  assert.ok(script, 'workflow must execute a github-script entry point');
  return { source, script: script.split('\n').map((line) => line.replace(/^ {12}/, '')).join('\n') };
}

test('policy workflow uses trusted default-branch checkout and never PR-controlled code', () => {
  const { source } = workflowScript('../.github/workflows/issue-claim-policy.yml');
  assert.match(source, /pull_request_target:/);
  for (const action of ['opened', 'reopened', 'edited', 'synchronize', 'converted_to_draft']) assert.ok(source.includes(action));
  assert.match(source, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(source, /persist-credentials: false/);
  assert.doesNotMatch(source, /head\.sha|head\.ref|head\.repo|pull_request\.body|npm (?:ci|install)|continue-on-error/);
  assert.match(source, /checks: write/);
  assert.match(source, /pull-requests: write/);
});

test('issue workflow covers acceptance, assignment and comment mutation events', () => {
  const { source } = workflowScript('../.github/workflows/issue-claim.yml');
  for (const action of ['labeled', 'unlabeled', 'assigned', 'unassigned', 'closed', 'reopened', 'created', 'edited', 'deleted']) {
    assert.ok(source.includes(action), action + ' must refresh the policy');
  }
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
});

test('bot mutation followed by reply failure still refreshes the policy in the actual workflow', async () => {
  const { script } = workflowScript('../.github/workflows/issue-claim.yml');
  const calls = [];
  const mockRequire = (path) => path.endsWith('issue-claim-policy.cjs')
    ? { recheckIssue: async () => { calls.push('recheck'); } }
    : { run: async () => { calls.push('mutation'); throw new Error('reply failed'); } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await assert.rejects(new AsyncFunction('require', 'github', 'context', 'core', script)(mockRequire, {},
    { eventName: 'issue_comment', payload: { action: 'created', issue: { number: 12 } } }, {}), /reply failed/);
  assert.deepEqual(calls, ['mutation', 'recheck']);
});

for (const [eventName, action, expectedClaims] of [['issues', 'unlabeled', 0], ['issues', 'unassigned', 0],
  ['issue_comment', 'edited', 0], ['issue_comment', 'deleted', 0], ['issue_comment', 'created', 1]]) {
  test(`actual workflow entry point refreshes ${eventName}.${action} without replaying edits`, async () => {
    const { script } = workflowScript('../.github/workflows/issue-claim.yml');
    const calls = [];
    const mockRequire = (path) => path.endsWith('issue-claim-policy.cjs')
      ? { recheckIssue: async () => { calls.push('recheck'); } }
      : { run: async () => { calls.push('claim'); } };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('require', 'github', 'context', 'core', script)(mockRequire, {},
      { eventName, payload: { action, issue: { number: 12 } } }, {});
    assert.equal(calls.filter((name) => name === 'claim').length, expectedClaims);
    assert.equal(calls.filter((name) => name === 'recheck').length, 1);
    assert.equal(calls.at(-1), 'recheck');
  });
}
