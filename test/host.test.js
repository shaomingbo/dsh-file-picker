import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
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

test('registers the expected host dependencies and loopback RPC channel', () => {
  const harness = createHarness()
  assert.deepEqual(inject, ['connection', 'systemPrompt'])
  assert.equal(harness.channel, '/file-picker')
  assert.deepEqual(harness.options, { authority: 'loopback' })
  assert.equal(harness.contexts.length, 1)
  assert.equal(harness.contexts[0].name, 'dsh-file-picker:selected-files')
})

test('lists files and directories without reading file content', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  const childDirectory = join(directory, 'nested')
  const childFile = join(directory, 'note.txt')
  await mkdir(childDirectory)
  await writeFile(childFile, 'secret text that the picker must not return', 'utf8')

  const result = await harness.handler('list', { path: directory }, new AbortController().signal)

  assert.equal(result.ok, true)
  assert.equal(result.value.path, await realpath(directory))
  assert.deepEqual(result.value.entries.map((entry) => [entry.name, entry.kind]), [
    ['nested', 'directory'],
    ['note.txt', 'file'],
  ])
  assert.equal(JSON.stringify(result.value).includes('secret text'), false)
})

test('stores only regular files for the requested session and renders prompt context', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  const childFile = join(directory, 'a&b.txt')
  await writeFile(childFile, 'contents', 'utf8')

  const selected = await harness.handler('select', { sessionId: 'session-1', paths: [childFile, childFile] }, new AbortController().signal)

  assert.equal(selected.ok, true)
  assert.deepEqual(selected.value.files, [await realpath(childFile)])
  assert.deepEqual(harness.events, ['system-prompt/change'])
  assert.match(harness.contexts[0].text({ agent: { id: 'session-1' } }), /a&amp;b\.txt/)
  assert.equal(harness.contexts[0].text({ agent: { id: 'different-session' } }), '')

  const cleared = await harness.handler('select', { sessionId: 'session-1', paths: [] }, new AbortController().signal)
  assert.equal(cleared.ok, true)
  assert.equal(harness.contexts[0].text({ agent: { id: 'session-1' } }), '')
})

test('rejects directories, relative paths, and unknown endpoints', async () => {
  const harness = createHarness()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))

  const directorySelection = await harness.handler('select', { sessionId: 'session-1', paths: [directory] }, new AbortController().signal)
  assert.equal(directorySelection.ok, false)
  assert.match(directorySelection.error.message, /not a regular file/)

  const relativeListing = await harness.handler('list', { path: 'relative' }, new AbortController().signal)
  assert.equal(relativeListing.ok, false)
  assert.match(relativeListing.error.message, /absolute path/)

  const unknown = await harness.handler('nope', {}, new AbortController().signal)
  assert.equal(unknown.ok, false)
  assert.match(unknown.error.message, /unknown file-picker endpoint/)
})
