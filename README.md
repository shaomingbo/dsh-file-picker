# DSH File Picker

A portable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI bundle that lets you search for and select files or directories anywhere on the **local DSH host**, then makes the chosen paths available to the active conversation.

It is designed for paths outside the current workspace: Downloads, Desktop, another project, or any other readable host directory. Search is a non-recursive, case-insensitive name filter within the currently open directory.

## Install

Install the versioned GitHub release into the default `web` DSH profile:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.0
```

For a different profile:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.0 --profile web
```

Restart DSH and refresh the existing Web GUI. The installer adds the package dependency and its Cordis bundle row to `~/.dsh/profiles/<profile>/package.json` and runs `pnpm install`.

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

Run the installer for the desired release tag:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.2.0
```

Then restart DSH and refresh the Web GUI.

## Uninstall

Remove `dsh-file-picker` from both `dependencies` and `dsh.profile.bundles` in your profile's `package.json`, run `pnpm install` from that profile directory, then restart DSH.

## Development

```sh
npm run check
```

The tests exercise the host filesystem/RPC and prompt-context behavior using a temporary directory. The browser bundle is syntax-checked as part of the same command.

## License

[MIT](./LICENSE)
