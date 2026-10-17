# Coexistence — running alongside the skin centre / the sidebar plugin / other UI plugins

> **Chinese**: [`../COEXISTENCE.md`](../COEXISTENCE.md) (same source: change one side, sync the other)
>
> This page answers two questions: **① you installed another UI plugin and something on screen
> looks wrong — how do you check, and what can you work around; ② can I keep the wallpaper and
> drop the glass (or vice versa) today?** Decisions and the target shape live in
> [`../adr/0010-glass-off-revisit-four-states.md`](../adr/0010-glass-off-revisit-four-states.md)
> (Chinese only); the full ledger of which host design tokens we rewrite is
> [`../TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md) (a generated artifact — `test/verify-token-contract.mjs`
> compares it byte-for-byte against the code).

## The current state in four sentences

1. **Wallpaper off, glass kept: supported today** — current-wallpaper card → 「关闭」 (close).
   The glass is unaffected (a guard pins exactly that).
2. **Glass off, wallpaper kept: no master switch yet** — glass is closed **per surface**
   (sidebar / thinking block / left sidebar each have their own master switch); the page-level
   token recipe (dialogues, panels, elevated buttons) sits on the page-glass anchor and stays —
   a single-surface switch does not govern it. The decision and its preconditions for adding
   that master switch are in [`../adr/0010-glass-off-revisit-four-states.md`](../adr/0010-glass-off-revisit-four-states.md).
3. **We yield automatically when the skin centre takes over** — once the skin centre's public
   marker (`html[data-dsh-skin]`) is detected, this plugin clears the wallpaper, removes the
   whole glass-gating family and stops rotation; it restores after the other side stays away.
   This is currently the **only** cross-plugin negotiation channel, and it is one-directional
   (we yield; nobody can make us yield).
4. **Third-party plugins that colour by the host spec "inherit" our glass** — the DSH spec tells
   plugin authors to colour with the `--dsw-alias-*` design tokens, and those tokens are
   rewritten into the glass recipe while glass is on ⇒ any spec-compliant plugin picks up the
   glass look automatically, **we cannot turn that off and the other author has no idea**.
   This is known behaviour: the ledger and the stop-loss line (the closed allowlist of ungated
   rewrites) are in [`../TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md).

## Conflict matrix: symptom → suspect mechanism → three-step self-check

| Symptom | Suspect mechanism | Three-step self-check |
|---|---|---|
| After installing a UI plugin, its panels / buttons turn glassy or translucent | **Token-layer takeover** — it reads `--dsw-alias-*` per spec and receives the glass recipe | ① Turn the wallpaper off and see if it persists (it persists ⇒ it is the token layer, unrelated to the wallpaper) ② Look the token up in [`../TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md) to see which gate it sits under ③ Turn the matching glass surface off and see whether it retreats |
| Buttons / popovers misplaced, whole blocks shifted | **Containing-block hijack** — a non-`none` `backdrop-filter` or any `transform` makes an ancestor the containing block for its `position: fixed` descendants | ① In DevTools check whether the misplaced element's containing block ancestor is one of our glass carriers ② Turn that glass surface's blur off and see if it recovers ③ Recall whether the newly installed plugin planted a fixed seat inside a card |
| Turning the skin centre on changes everything; turning it off doesn't restore it | **Yield protocol** — detecting the skin marker clears the wallpaper and removes glass gating; restoration happens only after the other side stays away for a while | ① Turn the skin centre off and wait a few seconds ② If still not restored, refresh the page ③ If it reproduces, send feedback with diagnostics |
| The settings page looks different from others (the sidebar-glass section appears and disappears) | **The config surface deforms with the installed plugin set** — that whole section renders only when `dsh-better-sidebar` is installed | ① Check whether the sidebar plugin is installed ② Install / uninstall once each to reproduce ③ This is deliberate tailoring, not a defect |
| A font set for a terminal plugin has no effect | **Cross-plugin delivery seam** — xterm reads the font exactly once at construction, so a renamed hook or moved read location fails silently | ① Restart that terminal plugin and look again ② Check the font lines in diagnostics ③ Include the plugin name and version in feedback |

> A self-diagnostics "coexistence" section and attribute-level opt-out are planned
> (D3 in [`../adr/0010-glass-off-revisit-four-states.md`](../adr/0010-glass-off-revisit-four-states.md)) —
> until they land, use the table above manually.

## The truth about "glass cannot be turned off"

- The conclusion "closing a surface yields half-glass ⇒ retire the whole layer, always wear glass"
  ([`../adr/0008-glass-config-two-state.md`](../adr/0008-glass-config-two-state.md)) is premised on
  **a batch of ungated token rewrites in the token layer**; that premise **no longer holds**
  (re-counted and revised in
  [`../adr/0010-glass-off-revisit-four-states.md`](../adr/0010-glass-off-revisit-four-states.md)):
  the ungated rewrites are down to a **closed allowlist**
  (`body[data-we-thinking-native]` — the thinking block's own switch — and `.we-layer`, the
  plugin's own element), so "the token layer can retreat as a whole" already holds —
  what is missing is a master switch and a batch of guard rewrites, not an architecture.
- So what **"closing a glass surface"** actually does today: the frost / blur this plugin paints
  directly onto that surface retreats as a family; while **the token-level recipe sits on the
  page-glass anchor** and is not governed by a single-surface switch — surfaces that read tokens
  by spec still receive the glass recipe. That is the "half-glass", and exactly the problem the
  `wallpaper-only` mode is meant to solve.

## The four coexistence modes (target shape; the last two land in batches per ADR-0010)

| Mode | Glass glaze | Wallpaper shows through the page | Today |
|---|---|---|---|
| `full` glass + wallpaper | on | on | ✅ default |
| `glass-only` wallpaper off | on | off | ✅ supported right now (just turn the wallpaper off) |
| `wallpaper-only` glass off | off | on | ❌ no master switch yet (the render layer is ready — see ADR-0010) |
| `off` yield state | off | off | ⚙️ exists internally (the skin-centre yield path), to be promoted to a declarable state |

> Want "wallpaper only, no glass" right now? Today you can only close surfaces one by one
> (the sidebar / thinking-block / left-sidebar master switches); the page-level token recipe
> cannot be switched off — that is exactly the pending `wallpaper-only` mode.

## Further reading

- [`../TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md) — which host tokens we rewrite and under which gates (generated; do not hand-edit)
- [`../adr/0008-glass-config-two-state.md`](../adr/0008-glass-config-two-state.md) & [`../adr/0010-glass-off-revisit-four-states.md`](../adr/0010-glass-off-revisit-four-states.md) — from "giving up on glass-off" to "re-adjudicated as feasible"
- [`../DSH-UI-INTERFACES.md`](../DSH-UI-INTERFACES.md) — which DSH UI interfaces we depend on (incl. the third-party private-class-name ledger)
- [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) — general troubleshooting quick table
