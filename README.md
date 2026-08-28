# DSH File Picker

A portable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI bundle that lets you search for and select files or directories anywhere on the **local DSH host**, then makes the chosen paths available to the active conversation.

It is designed for paths outside the current workspace: Downloads, Desktop, another project, or any other readable host directory. Search is a non-recursive, case-insensitive name filter within the currently open directory.

## Install

Preferred — install the fixed release tag with the package's own no-argument installer:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.1
```

No subcommand is the same as `install`. The installer only edits `dependencies.dsh-file-picker` and `dsh.profile.bundles` in the target profile's `package.json` (default profile `web`), writes the manifest atomically, then runs `pnpm install --ignore-scripts` in that profile directory. It never stops or restarts DSH.

For a different profile, or from a local checkout with `link:`:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.1 --profile lab
npx --yes github:shaomingbo/dsh-file-picker#v0.2.1 --source link:/path/to/dsh-file-picker
```

The default source is pinned to the current SemVer tag; `--source` (or the `DSH_FILE_PICKER_SOURCE` environment variable) can override it. Every command also accepts `-h`/`--help`.

## Status

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.1 status
```

Reports whether both the dependency and the bundle entry are present.

## Uninstall

Idempotent — running it twice is safe, and the original manifest is restored if dependency installation fails:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.1 uninstall
```

This removes `dsh-file-picker` from both `dependencies` and `dsh.profile.bundles`, runs `pnpm install --ignore-scripts`, and prints a reminder to restart DSH.

After installing or uninstalling: restart DSH manually and refresh the existing Web GUI.

Manual fallback — edit `~/.dsh/profiles/web/package.json` yourself, adding `"dsh-file-picker"` to `dependencies` (with the tag source) and to `dsh.profile.bundles`, then run `pnpm install --ignore-scripts` in that profile directory and restart DSH.

## Use

1. Open a normal DSH Web conversation.
2. Click **📁** in the composer tool row.
3. Browse the host filesystem or filter the current directory with the search field.
4. Select files and directories with their checkboxes. Clicking a directory name opens it; **Select this folder** selects the directory currently shown in the path bar.
5. Click **Apply**, then send your next prompt. The model receives the selected paths in a `<selected_paths>` context block. It can use `read` for files and `glob` or `grep` to inspect directories when appropriate.

Files and directories can be mixed in one selection, up to 32 paths. Applying a new selection replaces the selection for that conversation. **Clear** removes it. The selection is kept only in the running DSH process; restart DSH to discard it.

## Security and privacy

- The picker returns paths and entry kinds only; it never reads or uploads file contents and never recursively scans a selected directory.
- Search filters names in the current directory only; it does not traverse subdirectories.
- The selected paths are sent only to the model as conversation context after you apply them.
- Its private browser-to-host RPC is limited to `localhost`/loopback browsers. This intentionally prevents filesystem browsing from a remote Web GUI authority.
- It accepts only regular files and directories for selection; devices and sockets cannot enter the selected-path context.

## Compatibility

This bundle targets the current DSH Web profile architecture (`dsh.client`, `connection.rpc`, `systemPrompt.context`, and the `conversation.input.left` / `shell.overlay` slots). It has been checked against DSH `0.1.0-rc.6`.

## Update

Re-run the installer for the desired release tag (idempotent — it refreshes the pinned dependency source and keeps a single bundle entry):

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.1
```

Then restart DSH and refresh the Web GUI.

## Development

```sh
npm run check
```

The tests cover the host filesystem/RPC and prompt-context behavior plus the installer: first install, repeat install, status, uninstall, malformed manifests, bad arguments, and rollback when dependency installation fails, all inside a temporary `DSH_HOME`. The browser bundle is syntax-checked as part of the same command.

## License

[MIT](./LICENSE)
