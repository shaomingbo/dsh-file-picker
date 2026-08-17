# DSH File Picker

A portable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI bundle that lets you select regular files anywhere on the **local DSH host**, then makes the chosen paths available to the active conversation.

It is designed for the case where the file is outside the current workspace: Downloads, Desktop, another project, or any other readable host directory.

## Install

Install the versioned GitHub release into the default `web` DSH profile:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.1.1
```

For a different profile:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.1.1 --profile web
```

Restart DSH and refresh the existing Web GUI. The installer adds the package dependency and its Cordis bundle row to `~/.dsh/profiles/<profile>/package.json` and runs `pnpm install`.

## Use

1. Open a normal DSH Web conversation.
2. Click **📁** in the composer tool row.
3. Browse the host filesystem, select one or more files, then click **Apply**.
4. Send your next prompt. The model receives the selected paths in a `<selected_files>` context block and can use DSH's `read` tool when appropriate.

Applying a new selection replaces the selection for that conversation. **Clear** removes it. The selection is kept only in the running DSH process; restart DSH to discard it.

## Security and privacy

- The picker returns paths and file kinds only; it never reads or uploads file contents.
- The selected paths are sent only to the model as conversation context after you apply them.
- Its private browser-to-host RPC is limited to `localhost`/loopback browsers. This intentionally prevents filesystem browsing from a remote Web GUI authority.
- It accepts only regular files for selection; directories, devices, and sockets cannot enter the selected-file context.

## Compatibility

This bundle targets the current DSH Web profile architecture (`dsh.client`, `connection.rpc`, `systemPrompt.context`, and the `conversation.input.left` / `shell.overlay` slots). It has been checked against DSH `0.1.0-rc.6`.

## Update

Install a later tag with an explicit source:

```sh
npx --yes github:shaomingbo/dsh-file-picker#v0.1.1 -- --source github:shaomingbo/dsh-file-picker#v0.1.0
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
