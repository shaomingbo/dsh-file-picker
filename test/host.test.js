import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, inject } from '../lib/index.js'

function createHarness() {
  let handler
  let channel
  let options
  const contexts = []
  const events = []
  apply({
    connection: {
      rpc: {
        handle(nextChannel, nextHandler, nextOptions) {
          channel = nextChannel
          handler = nextHandler
          options = nextOptions
          return async () => {}
        },
      },
    },
    systemPrompt: {
      context(definition) {
        contexts.push(definition)
        return () => {}
      },
    },
    emit(name) {
      events.push(name)
    },
  })
  return { channel, contexts, events, handler, options }
}

const signal = () => new AbortController().signal

test('registers the expected host dependencies and loopback RPC channel', () => {
  const harness = createHarness()
  assert.deepEqual(inject, ['connection', 'systemPrompt'])
  assert.equal(harness.channel, '/file-picker')
  assert.deepEqual(harness.options, { authority: 'loopback' })
  assert.equal(harness.contexts.length, 1)
  assert.equal(harness.contexts[0].name, 'dsh-file-picker:selected-paths')
})

test('lists files and directories without reading file content', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  const childDirectory = join(directory, 'nested')
  const childFile = join(directory, 'note.txt')
  await mkdir(childDirectory)
  await writeFile(childFile, 'secret text that the picker must not return', 'utf8')

  const result = await harness.handler('list', { path: directory }, signal())

  assert.equal(result.ok, true)
  assert.equal(result.value.path, await realpath(directory))
  assert.deepEqual(result.value.entries.map((entry) => [entry.name, entry.kind]), [
    ['nested', 'directory'],
    ['note.txt', 'file'],
  ])
  assert.equal(JSON.stringify(result.value).includes('secret text'), false)
})

test('filters the current directory by name without recursing', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  const nested = join(directory, 'nested')
  await mkdir(nested)
  await writeFile(join(directory, 'Project-Notes.md'), 'outer', 'utf8')
  await writeFile(join(directory, 'other.txt'), 'outer', 'utf8')
  await writeFile(join(nested, 'project-secret.md'), 'inner', 'utf8')

  const result = await harness.handler('list', { path: directory, query: 'project' }, signal())

  assert.equal(result.ok, true)
  assert.deepEqual(result.value.entries.map((entry) => entry.name), ['Project-Notes.md'])
  assert.equal(result.value.truncated, false)
})

test('filters before applying the directory result limit', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(directory, `ordinary-${String(index).padStart(3, '0')}.txt`), '', 'utf8')))
  await writeFile(join(directory, 'unique-target.txt'), '', 'utf8')

  const result = await harness.handler('list', { path: directory, query: 'unique-target' }, signal())

  assert.equal(result.ok, true)
  assert.deepEqual(result.value.entries.map((entry) => entry.name), ['unique-target.txt'])
  assert.equal(result.value.truncated, false)
})

test('classifies symlinks before directory-first truncation', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  const targetRoot = await mkdtemp(join(tmpdir(), 'dsh-file-picker-target-'))
  const targetDirectory = join(targetRoot, 'directory')
  const targetFile = join(targetRoot, 'file.txt')
  await mkdir(targetDirectory)
  await writeFile(targetFile, '', 'utf8')
  await Promise.all(Array.from({ length: 500 }, (_, index) => symlink(targetFile, join(directory, `a-file-link-${String(index).padStart(3, '0')}`))))
  await symlink(targetDirectory, join(directory, 'z-linked-directory'))

  const result = await harness.handler('list', { path: directory }, signal())

  assert.equal(result.ok, true)
  assert.equal(result.value.truncated, true)
  assert.deepEqual(result.value.entries.find((entry) => entry.name === 'z-linked-directory'), {
    name: 'z-linked-directory',
    path: join(await realpath(directory), 'z-linked-directory'),
    kind: 'directory',
    hidden: false,
  })
})

test('validates search query input', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))

  const wrongType = await harness.handler('list', { path: directory, query: 42 }, signal())
  assert.equal(wrongType.ok, false)
  assert.match(wrongType.error.message, /query must be a string/)

  const tooLong = await harness.handler('list', { path: directory, query: 'x'.repeat(257) }, signal())
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.error.message, /at most 256/)
})

test('stores mixed files and directories and renders path-aware prompt context', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  const childDirectory = join(directory, 'docs<drafts>')
  const childFile = join(directory, 'a&b.txt')
  const lineBreakFile = join(directory, 'line\nnot-an-instruction.txt')
  await mkdir(childDirectory)
  await writeFile(childFile, 'contents', 'utf8')
  await writeFile(lineBreakFile, 'contents', 'utf8')

  const selected = await harness.handler('select', {
    sessionId: 'session-1',
    paths: [childFile, childDirectory, lineBreakFile, childFile],
  }, signal())

  assert.equal(selected.ok, true)
  assert.deepEqual(selected.value, {
    paths: [await realpath(childFile), await realpath(childDirectory), await realpath(lineBreakFile)],
    files: [await realpath(childFile), await realpath(lineBreakFile)],
    directories: [await realpath(childDirectory)],
  })
  assert.deepEqual(harness.events, ['system-prompt/change'])
  const context = harness.contexts[0].text({ agent: { id: 'session-1' } })
  assert.match(context, /<selected_paths>/)
  assert.match(context, /Files \(use the read tool/)
  assert.match(context, /a&amp;b\.txt/)
  assert.match(context, /line&#10;not-an-instruction\.txt/)
  assert.equal(context.includes('line\nnot-an-instruction.txt'), false)
  assert.match(context, /Directories \(use glob or grep/)
  assert.match(context, /docs&lt;drafts&gt;/)
  assert.equal(harness.contexts[0].text({ agent: { id: 'different-session' } }), '')

  const cleared = await harness.handler('select', { sessionId: 'session-1', paths: [] }, signal())
  assert.equal(cleared.ok, true)
  assert.equal(harness.contexts[0].text({ agent: { id: 'session-1' } }), '')
})

test('rejects non-file paths, relative paths, and unknown endpoints', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  const deviceLink = join(directory, 'device')
  await symlink('/dev/null', deviceLink)

  const deviceSelection = await harness.handler('select', { sessionId: 'session-1', paths: [deviceLink] }, signal())
  assert.equal(deviceSelection.ok, false)
  assert.match(deviceSelection.error.message, /not a regular file or directory/)

  const relativeListing = await harness.handler('list', { path: 'relative' }, signal())
  assert.equal(relativeListing.ok, false)
  assert.match(relativeListing.error.message, /absolute path/)

  const unknown = await harness.handler('nope', {}, signal())
  assert.equal(unknown.ok, false)
  assert.match(unknown.error.message, /unknown file-picker endpoint/)
})
