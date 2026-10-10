# docs — decisions and user documentation

> **中文**: [`../README.md`](../README.md)（与本文同源：改一处请同步另一侧）

This repository follows a **"code is the source of truth"** documentation model: rendering /
reverse-engineering / root-cause knowledge is inlined in the header comments of the implementation files
it belongs to. `docs/` keeps only **decisions** (with acceptance criteria), **specifications** and **user
documentation**; mechanisms do not live here.

## Language layout (read this before adding a document)

- **Chinese lives at the root of `docs/`, English in `docs/en/`, with identical basenames** — so "does this
  document have an English version" is a directory-level enumerable fact, and the counterpart file is
  obvious when you edit one (suffix naming — `X.en.md` — makes you guess per file and tends to drift into
  shapes like `X-en-v2.md`).
- **Every paired document starts with a language-switch link**; when you change one side, change the other
  (each header says so).
- **Deliberate exceptions (not translated)**: `adr/` (decision records; Chinese is the authoritative
  version), `ROUTE-INDEX.md` and `TOKEN-CONTRACT.md` (generated artifacts), `archive/` (history — `dev-notes-bom-and-dsh-boot.md`
  and `awesome-dsh-plugin-pr-guide.md`, previously listed separately, now live under `archive/`).
  `CHANGELOG.md` **has been split into two files** (English at
  [`CHANGELOG.md`](./CHANGELOG.md)), so it is no longer an exception.
- **Maintainer-facing documents are Chinese-only** (October 2026 documentation slim-down): the English
  mirrors of `CODE-STRUCTURE.md` / `DEV-GUIDE.md` / `FONT-SYSTEM.md` were removed — their reader is the
  maintainer, and bilanguage was pure double maintenance. User-facing docs
  (`README` / `UPGRADING` / `HOW-IT-WORKS` / `TROUBLESHOOTING` / `COEXISTENCE` / `CHANGELOG`) are still paired.
  (Precedent: `UPGRADING.md` here already said "CHANGELOG (Chinese only)".)

## Document lifecycle rules (read this before adding a document)

| Category | Where | Criterion |
|---|---|---|
| **Evergreen** — user docs / specifications / reference | the root of `docs/` | describes **current** behaviour or a long-term convention; it moves with versions, not with the end of a work item |
| **Historical** — retired / finished | `docs/archive/` | exists purely as a record; it does **not** reflect the current implementation, and must carry a status banner at the top |

**`docs/wip/` stands, and is usually empty** (October 2026 slim-down: everything that was in it had finished, so
the refactor ledger / the closing audit / the sidebar-tabs design moved **wholesale into `docs/archive/wip/`**
per the table above). The directory is **kept**: a plan for work that has **not yet become a fact** may live
there temporarily, and **on completion it moves into the archive wholesale**. What is in it at any moment is
**not** recorded here — that listing would drift; enumerate the directory itself. Do **not** create "the single
source of truth for progress" ledgers again — anything that needs watching becomes a guard (see the writing
discipline above and [`adr/0007`](../adr/0007-machine-checks-target-code-not-prose.md)); a ledger drifts by
itself, and drifting never turns anything red.

## Writing discipline (the shared floor for **comments / guards / documents**)

> This repository's written discipline is these few rules — their **home is here** (committed), and they do
> not live in any machine-local file.
>
> **Discipline runs on convention, not on guards.** A set of "machine-decided" document guards used to hang
> here; per [`adr/0006`](../adr/0006-comment-discipline-as-written-convention.md) they were removed (the
> decision is in force, and the guard files have been taken out of the chain): writing discipline judges
> "will a reader be misled", and downgrading that to regex matching only teaches the author to dodge a word
> list — and the guards themselves rot and contradict each other.
> So the third column below says only **what backs it up**, and **absence means absence** — a vacuously
> true assertion may not stand in for coverage.
>
> What was removed is **only** the document / comment / ledger-prose kind; the guards that read **code**
> (reachability, retired lines, orphan declarations, module layout) **stay** and were not relaxed by this.
> **Before adding an assertion, run it through the four questions in
> [`adr/0007`](../adr/0007-machine-checks-target-code-not-prose.md)** — especially question 4:
> a user-facing copy literal inside an assertion (`includes('some sentence')`) is itself the signal to
> change something; the way out is a translatable `weT(...)` key, or removal.

| # | Rule | Backed by |
|---|---|---|
| 1 | **Comments state invariants, not chronicles** — dates, "used to / the old implementation" framing, measured symptoms and war stories never go into code comments | no guard (a writing convention). Content with historical value goes into `CHANGELOG.md` or git history |
| 2 | **"measured X ≈ Y" is provenance, not a chronicle** — a sentence that gives the provenance of an empirical value or a browser behaviour must stay, or the reader cannot tell "measured" from "guessed" | no guard (a writing convention). Keep the provenance **near where it was measured**; do not move it into evergreen prose |
| 3 | **A rule that can sit next to the code is not written up as a document** — mechanisms / invariants / contracts go into the **file header**; documents keep only decisions, orderings, acceptance criteria and evidence anchors | no guard (a writing convention); landing-spot rules in [`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md) |
| 4 | **Evergreen documents carry no drifting numbers** — defaults / ranges / enum lists / counts / line counts / sizes / timeout thresholds become **symbol references** or **recompute commands**. Sources of truth: settings → `lib/settings-schema.js`, routes → `docs/ROUTE-INDEX.md` (Chinese only) | no guard (a writing convention, see ADR-0006). **Exception**: `CHANGELOG.md` and `docs/archive/**` are ledgers — their numbers **stay as they are**; changing them would be forging a record |
| 5 | **A retired line may only shrink** — a reverse probe precedes any deletion; the baseline may only tighten, and emptying it out is "zero residue" | `test/verify-retired-lines.mjs` |
| 6 | **A guard's assertion targets code, not prose** — strip comments before asserting "X no longer appears in the source" | [`DEV-GUIDE.md`](../DEV-GUIDE.md) §4.7 |
| 7 | **A skip must not look like a pass** — a missing prerequisite either goes red or requires an explicit `--allow-skip`; a silent skip quietly loses coverage | `test/verify-media-bridge.mjs` (`--provision` / `--allow-skip`) |
| 8 | **Decisions go to ADRs, mechanisms go to file headers** — a trade-off with alternatives, where someone paid a price, is written up in [`adr/`](../adr/); "how it is implemented" goes into the header comment of the implementation file | no guard (a writing convention); format in [`adr/README.md`](../adr/README.md) |

**A committed document may not reference a machine-local untracked path** — do not point at something the
reader cannot open. The only exemption is `docs/archive/` (a historical record whose banner already says it
does not reflect the current implementation) and its evidence trails.

## User documentation

| Document | Contents |
|---|---|
| [`UPGRADING.md`](./UPGRADING.md) | **Upgrading** — prerequisites, the compatibility matrix, the correct update order, and how to recover if you did it backwards |
| [`CHANGELOG.md`](./CHANGELOG.md) | **Per-version changes** — features and fixes, newest first (its Chinese counterpart is [`../CHANGELOG.md`](../CHANGELOG.md), same basename) |
| [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md) | **How it works** — the out-figure chain (live render → embedded MP4 → live capture → custom frame → empty state), the host/client split, **the font-set channels**, occlusion pause and client-error traces, the HTTP route table |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | **Troubleshooting** — install-failure diagnosis and a "symptom → where to look first" quick table |
| [`COEXISTENCE.md`](./COEXISTENCE.md) | **Coexistence** — the conflict matrix for running alongside the skin centre / sidebar plugin / other UI plugins (symptom → suspect mechanism → three-step self-check), the truth about "glass cannot be turned off", and the four-mode target shape |

**Layering convention**: the facade `README.md` / `README.en.md` carries only facts that **do not change
with versions and that a new visitor needs in order to decide**; anything with a version number, an issue
number, a performance figure, troubleshooting steps or implementation detail goes into the tables above or
into `CHANGELOG.md` (the reason: the front page once carried a batch of `localStorage` claims that **all
went false together** after a persistence rework — that is exactly where §writing discipline 4 comes from).

## Specifications and reference (evergreen, Chinese)

| Document | Contents |
|---|---|
| [`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md) | **Code structure and boundaries** — the merge of two earlier documents (the former `MODULE-LAYOUT.md` ⊕ `ARCHITECTURE.md`): the `lib/` vs `src/` division of labour, directory conventions and admission thresholds, the two halves and the route families, build-time inlining, startup/shutdown lifecycle, data flow, the **state source-of-truth list**, the inter-layer boundary table, and the registered guards |
| [`DEV-GUIDE.md`](../DEV-GUIDE.md) | **Developer guide** — "how to add an X" recipes (a route / a setting / browser-side code); **§4 is verification and testing** (the former `TEST-LAYOUT.md`, merged in): the three layers, the two tiers, the run matrix, coverage, the `test/tools/` inventory, the eight conventions for writing assertions |
| [`FONT-SYSTEM.md`](../FONT-SYSTEM.md) | The font system's channel split, invariants, extension steps and the constraints on entering the browser bundle |
| `ROUTE-INDEX.md` (Chinese) | The host route table — a **generated index** (recomputed and byte-compared by `test/tools/host-route-index.mjs`; hand-writing always rots) |
| `GUARD-MAP.md` (Chinese) | The **two-way guard ↔ module map** ("which guards to run after touching module X"): guard→module and module→guard tables, derived from the guards' **own code** by `test/tools/guard-targets.mjs` (`--write` recomputes it and it is byte-compared; generated, never hand-edited) |
| `TOKEN-CONTRACT.md` (Chinese) | The **generated index of `--dsw-*` token rewrites** (which host design tokens we rewrite, under which gates, and the closed allowlist of ungated rewrites) — recomputed and byte-compared by `test/tools/token-contract.mjs` (`test/verify-token-contract.mjs` guards it; generated, never hand-edited) — the ledger of the coexistence coupling surface, see [`COEXISTENCE.md`](./COEXISTENCE.md) |

> **The English mirrors of the table above were removed** (maintainer-facing documents are Chinese-only; see
> §Language layout above — `ROUTE-INDEX.md` / `GUARD-MAP.md` are generated and Chinese-only too). User-facing documents are still paired.

> Two documents that used to sit here have moved into `archive/`:
> `dev-notes-bom-and-dsh-boot.md` (a process record of one local investigation, carrying that machine's
> absolute paths) and `awesome-dsh-plugin-pr-guide.md` (a one-off publishing guide, a snapshot of that
> submission). **Neither describes the current implementation** — see the new *Other archived documents*
> subsection under "Archived" below.

## Decision records (`adr/`, Chinese)

**Trade-offs only**: a decision that had alternatives, where someone paid a price, and that a later reader
might want to overturn. Mechanisms and invariants **do not go here** — they live in the header comments of
the files they belong to (this repo's discipline: a rule that can sit next to the code is not written up as
a document).

Read [`adr/README.md`](../adr/README.md) before writing a new ADR: it says what to write and what not to,
the header format, and **why not to write drifting numbers** (the same convention as §writing discipline here).

| ADR | Decision |
|---|---|
| [0001](../adr/0001-webwallgl-in-tree-live-renderer.md) | Scene wallpapers use the in-tree WebWallGL **live renderer**, rather than offline frame rendering / transcoding / requiring WE to run resident |
| [0002](../adr/0002-settings-schema-single-source.md) | The **single source of truth** for settings lives in one shared file, and both host and client derive from it |
| [0003](../adr/0003-build-time-module-inlining.md) | The browser half is split via **build-time inlining**, with no runtime modules |
| [0004](../adr/0004-two-tier-guard-verification.md) | Guards are split into hard / soft tiers by **what a failure means** |
| [0005](../adr/0005-media-loopback-origin.md) | Wallpaper media is served from a **dedicated loopback origin** the host opens itself |
| [0006](../adr/0006-comment-discipline-as-written-convention.md) | Comment and document discipline became a **pure writing convention**, and the document-class machine guards were removed |
| [0007](../adr/0007-machine-checks-target-code-not-prose.md) | Machine checks target **code and disk, not prose** (a four-question test plus keep/remove lists) |
| [0008](../adr/0008-glass-config-two-state.md) | Glass config collapses into **two states** (the whole "do we want glass?" layer is retired; one "independent configuration" per surface = `inherit` / `custom`) plus a **gating policy**: always-on attributes act as the CSS-side certificate, and the **simple vs advanced** split is decided by `ctx.surface` (D4) |
| [0009](../adr/0009-system-fonts-from-the-os.md) | The installed-font list is **enumerated by the host asking the OS** (plus caching; the browser side is only a reader) rather than parsing font files in-process or enumerating from the browser; with no authoritative source it honestly reports `approximate` |
| [0010](../adr/0010-glass-off-revisit-four-states.md) | **Amends ADR-0008's "giving up on glass-off"**: the precondition that the token layer can retreat as a whole now holds (ledger [`TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md) + the closed-allowlist guard); the target shape is **one mode key, four states** (full / glass-only / wallpaper-only / off), landing in three batches with the master switch last (Chinese only) |

## In progress (`wip/`)

**Usually empty; kept for plans that are not yet a fact.** The process records that used to be here had all
finished, so they moved wholesale into [`archive/wip/`](../archive/wip/) per the lifecycle table above: the
refactor ledger (`OPEN-ITEMS.md`), the closing audit (`POST-REFACTOR-AUDIT.md`) and the sidebar-tabs design
(`SIDEBAR-TABS-DESIGN.md`). **What is in the directory right now is not listed here** (that listing would
drift) — enumerate it. See *Finished audits…* below; the Chinese index
([`../README.md`](../README.md)) carries the full descriptions.

## Archived (`archive/`, a record only)

### Retired rendering routes

**Why archived**: this **early, abandoned** route (rendering scenes offline to a PNG) is maintained in a
separate repository — [`YV3507/we-static-frame`](https://github.com/YV3507/we-static-frame). This repository
**keeps only the historical record**: the documents below **do not reflect the current implementation** and
are no longer maintained.
(**The static-frame branch — `archive/static-frame/**`, evidence scripts included — has been deleted
wholesale**, as the v1.1.0 section already scheduled: once that line moved to its own repository, the long
tail belongs to git history.)

> ⚠️ **Do not confuse this with the current implementation**: Scene / web wallpapers use the **in-tree, in-use**
> **WebWallGL** live renderer (`lib/webwallgl/`, from
> [`oneincase/webwallgl`](https://github.com/oneincase/webwallgl)). It is not an archived artifact: its
> division of labour is in [`../CODE-STRUCTURE.md`](../CODE-STRUCTURE.md) and its behaviour in
> [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md).

| Document | Contents |
|---|---|
| `scene-animation/SCENE-ANIMATION-HANDOFF.md` | Scene-animation handover notes (`/scene-anim` was removed wholesale) |

### Finished audits, real-machine records and work-item plans

| Document | Contents |
|---|---|
| `wip/OPEN-ITEMS.md` | **The refactor ledger (active part closed out; archived wholesale)** — §2 the current baseline (an upper-bound ratchet), §3.1–§3.3 current anchors, §5 the status column, §7 the trigger lines, §9.1 the token-layer constraints. What was still alive moved out on archival: **behaviour gaps → [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md)**, **token-layer constraints → guards** (`verify-readability` / `verify-glass-compositing`). ⚠️ **The status column never had machine backing** (the ledger guard went away with [`adr/0006`](../adr/0006-comment-discipline-as-written-convention.md)), so read it as an **unverified record** |
| `wip/POST-REFACTOR-AUDIT.md` | **Post-close-out audit (a process record)** — a read-only review after the refactor's active phase closed, **collecting engineering debt only**: the host's request-body limits / encoding correctness / unbounded state / interruption leaks / concurrent artifact deletion, the client boot chain and teardown, comment and document inaccuracy, and **assertion gaps** (why a fully green chain missed all of it). The items it opened (the ledger's P4 series) **have all been closed out** |
| `wip/SIDEBAR-TABS-DESIGN.md` | **The sidebar-tabs + "images" type-filter UI design** — shipped in v1.1.0 → v1.2.0 (which added the 「壁纸属性」 entry and its in-page drill-down on the same sidebar). Carries the requirement wording, the implementation trade-offs and the landing criteria in its final section |
| `REFACTOR-ASSESSMENT.md` | **The refactor and design-implementation ledger (historical half)** — a complete assessment of one refactor and design rollout: decisions (§1), four groups of maintainability metrics (§3), a risk list (§4), the shape after the static-frame line was removed (§6), the measurement method and how to reproduce (§8), the F-track design points and the `V1–V10` token-layer measurements (§9). **Does not reflect the current implementation** |
| `audits/ROBUSTNESS-AUDIT.md` | A robustness audit (closed out) — its conclusions were folded into ledger P3-1 … P3-22 |
| `audits/F0-THEME-SERVICE-CHECKLIST.md` | F0 real-machine confirmation (closed) — conclusions (the `V1–V10` constraints) are in ledger §9.1; the raw evidence is in a local untracked directory |
| `audits/P3-11-PLAN.md` | A process record of splitting `WallpaperPicker` (**finished**: model / modal / properties panel, all three moved out) — the pre-work fact-check, the prerequisite assertion list and the teeth proof at close-out; the conclusion is the ledger's `P3-11` row, and the criteria are the guard itself |
| `audits/LOGGING-PLAN.md` | A process record of log levels and the notice channel (**finished**: G0 + P1–P5) — three levels `error` / `warn` / `info` (default `warn`) plus an independent success-notice channel. **Mechanisms and invariants stayed in the headers of `lib/log.js` / `lib/notice.js` / `lib/routes/diag.js`**, with criteria in `test/verify-logging.mjs` |
| `audits/F3-PLAN.md` | A process record of making font sets file-based (**finished**: stages 0–4) — shipped presets · two-layer storage · manual switching · import/export. **Mechanisms and invariants stayed in the headers of `lib/routes/fontsets.js` / `src/fontset-store.js` / `src/fontset-editor.js` / `lib/settings-schema.js`**, with criteria in `test/verify-fontset.mjs` + `test/fontset-load-smoke.mjs` |
| `audits/TEST-ANTIPATTERN-AUDIT.md` | **An anti-pattern audit of the test framework (per-item current state)** — all 72 `.mjs` files under `test/` (57 at the top level + 15 in `test/tools/`) plus 2 fixtures were read against three families: A1–A4 (result-oriented programming) / B1–B4 (meaningless tests) / C1–C6 (self-deception). Each item records what it guards, its **teeth** (`yes` / `no` / `partial`, i.e. whether it goes red when the product really regresses in the way it claims to guard) and its current `file:line`. **All 106 findings are settled** (R 47 / H 33 / D 20 / keep-or-declare 5 / withdrawn 2), none pending |
| `audits/TEST-ANTIPATTERN-FIX-PLAN.md` | The **open items and risks** from the same round (rewritten at close-out as "what is still a problem") — only what remains unsolved or cannot be proven on this machine (the F4/F5 manual tools, the harness / e2e coverage holes, M16 down to a positive assertion only, the settings fixture being a drift ratchet, the probes in `%TEMP%` that cannot be deleted) plus the decisions still needed and the re-check commands. The per-item state lives in the audit, not here |

### Other archived documents

| Document | Contents |
|---|---|
| `dev-notes-bom-and-dsh-boot.md` | **A process record of one local investigation into BOM and DSH hot-mounting** (carries a `status-banner` at the top) — it contains **the absolute paths of the machine it was written on** (unopenable for a reader; kept purely as an evidence trail). Its two conclusions that still hold **have left this document**: BOM is now covered by `verify-package-files` P8 and `DEV-GUIDE` §4.7 convention 7; the hot-mount / restart semantics are in `CONTRIBUTING.md` and `CODE-STRUCTURE.md` §1.1 |
| `awesome-dsh-plugin-pr-guide.md` | A **one-off publishing guide** for submitting to the awesome-dsh-plugin directory (a snapshot of that submission, including the commit count and repo state at the time). **Kept verbatim at the author's request — do not edit** |

## Other

- Status / progress: **there is no living ledger** (October 2026 slim-down: the `docs/wip/` ledger archived
  wholesale) — anything that needs watching is a guard (entry points:
  [`DEV-GUIDE.md`](../DEV-GUIDE.md) §4 and §writing discipline in this document); the historical
  assessments are `archive/REFACTOR-ASSESSMENT.md` and `archive/wip/OPEN-ITEMS.md` (**neither reflects the
  current implementation**).
  **Machine-local temporary to-dos are not committed**, and no committed document references them — do not
  point at what the reader cannot open.
- Development / publishing: `CONTRIBUTING.md` at the repository root (including "what `lib/client.js`
  actually is"); the user-facing facade: `README.md` / `README.en.md` / `README.beginner.md` (Chinese/English
  at the root; the beginner guide is Chinese only).
- `images/`: screenshots referenced by the README.
- **Documents already dissolved into code** (conclusions into comments): `RENDERER-OFFICIAL-STRUCTURE.md`,
  `RENDER-ISSUES-ANALYSIS.md`, `REFACTOR-ROUND-2026-08-28.md`, `REFACTOR-STATIC-FRAME.md`; abandoned
  directions (`HOOK-PROGRESS` / `V6-DUMP-ANALYSIS` / `EYE-PREDICTION` / `FIX-PLAN-AMYA` /
  `AMYA-CAMERA-ANALYSIS` / `RENDER-ISSUES-PROGRESS`) were deleted.
