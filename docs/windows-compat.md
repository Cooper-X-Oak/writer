# Windows compatibility — paths, ConPTY, atomic writes, key storage

Concrete handling for the Windows 11 (best-effort) target. Each section gives the failure mode
and the chosen mitigation. Related: [`../PLAN.md`](../PLAN.md) §3 risk table.

---

## 4.1 ENAMETOOLONG (paths)

**Failure mode.** Win32's legacy path limit is 260 chars. The `\\?\` extended-length prefix
lifts it to ~32,767 (each component still ≤255; the path must be absolute and backslash-only).
Node's `fs` auto-prepends the prefix via `path.toNamespacedPath()` **only for absolute,
drive-qualified paths** — long *relative* paths still throw `ENAMETOOLONG`.

**Mitigation.**
- **Always `path.resolve` to absolute** before fs calls on deep trees; for fs-heavy work on
  user trees, call `path.toNamespacedPath()` explicitly.
- **Do NOT rely on `LongPathsEnabled` / `longPathAware`.** The shipped `node.exe` / Electron
  binaries are not long-path-aware and end users may not have the registry key set, so it is not
  a dependable mitigation for a redistributable app.
- **Primary mitigation = short hashed workspace dirs.** Root workspaces under a short base
  (`%LOCALAPPDATA%\<app>\ws\`); name each project by a short hash (first 8–12 hex of a SHA-256
  of the project identity), e.g. `…\ws\a1b2c3d4\`. Keep a `hash → friendly title` map in SQLite.
  This caps the path *prefix budget* so agent/user-generated nested files stay under 260 even
  without `LongPathsEnabled`. If any toolchain is bundled, prefer a flat (pnpm-style)
  `node_modules`.

---

## 4.2 spawn ENAMETOOLONG = command-line length, not path

**Failure mode.** `spawn ENAMETOOLONG` on Windows is the **command-line length limit**:
`CreateProcess` caps the full command line at 32K, `cmd.exe` at 8K. It is triggered by huge
`args` arrays or env blocks, not by long paths.

**Mitigation.**
- Spawn with `shell: false` (uses the 32K `CreateProcess` limit, not the 8K `cmd.exe` one).
- Keep argv small; **pass prompt and context via stdin + files + MCP, never argv.** This is
  already the design — the prompt goes over stdin as `stream-json`, and provenance is read via
  files/MCP. The `maxPromptArgBytes` guard (→ `RuntimePromptBudgetError`) enforces it; see
  [`agent-layer.md`](./agent-layer.md#claude-code-def-pseudocode).

---

## 4.3 ConPTY — optional / deferred (agent runner uses pipes)

Because agent CLIs run over **piped child processes** (decision: pipes primary), ConPTY is
**not on the core path**. It is needed only **if** we later add an embedded interactive terminal,
or adopt a CLI that demands a TTY.

If/when used:
- `node-pty@1.1.0` is **ConPTY-only** (winpty removed) and requires Windows 10 ≥ 1809
  (build 18309).
- `asarUnpack` the native `conpty.node`; rebuild for the Electron ABI via `@electron/rebuild`
  (build a separate arm64 binary for Windows-on-ARM).
- **Drain remaining `data` after the `exit` event** — the ConPTY flush race (child exits before
  output is fully flushed) is the #1 correctness bug.
- Throttle `resize`; parse VT through xterm.js (don't hand-parse escape sequences).

Keeping ConPTY out of the MVP removes the highest-churn Windows native dependency from the
critical path.

---

## 4.4 chokidar atomic writes

**Failure mode.** Editors/agents save atomically (write temp → rename over target). To a watcher
this surfaces as `unlink` + `add` (or a burst), and naive readers see partial/empty files. On
Windows, `rename` over a file another handle holds (preview reader, indexer, **antivirus
mid-scan**) throws `EPERM`/`EBUSY`.

**Mitigation (watcher config — the verified open-design settings):**

```ts
chokidar.watch(dir, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  atomic: 300,            // coalesce unlink+add (default 100); 300 gives AV headroom
  followSymlinks: false,
  persistent: true,
});
```

Watchers are refcounted in a `Map<dir, WatcherEntry>` (first subscriber creates, last closes),
bursts are coalesced, and emitted paths use forward slashes.

**Writer side** (our exports and any artifact-writing helper): write the temp file **in the same
directory** → `fsync` → `rename`, wrapped in a **bounded retry on `EPERM`/`EBUSY`** (e.g. 5 tries,
50 → 500 ms backoff) to ride out AV/indexer locks; prefer `ReplaceFile` semantics where possible.

**Reader side:** gate reads on `awaitWriteFinish` stabilization; retry on `EBUSY`. Set
`ignorePermissionErrors: true` so transient AV locks don't kill the watcher. Recommend users add
the workspace dir to AV exclusions.

> Note: chokidar v4/v5 dropped built-in glob support — pin v3 or migrate to the `ignored`
> function-filter API.

---

## 4.5 fal.ai key storage (BYOK)

Use **Electron `safeStorage`** (DPAPI-backed on Windows; no native dependency). Store only the
`encryptString` blob (base64) in SQLite; decrypt **in the main process at call time**; never
expose the raw key to the renderer. Guard with `isEncryptionAvailable()` (returns true only after
the app `ready` event on Windows). Avoid `keytar` (unmaintained).

Submit via the fal queue API: header `Authorization: Key <KEY>`; submit → poll status → fetch
result. `images[].url` is a **temporary** CDN URL — **download the bytes and persist into the
project's `assets/` immediately** rather than relying on the CDN link.
