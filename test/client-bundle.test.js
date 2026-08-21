import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))

test('browser bundle uses the DSH client-module handoff and required slots', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load/)
  assert.match(source, /id: 'dsh-file-picker'/)
  assert.match(source, /conversation\.input\.left/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /connection\.rpc\.call/)
})

test('browser bundle exposes search and mixed file-directory selection controls', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /type: 'search'/)
  assert.match(source, /payload\.query = target\.query/)
  assert.match(source, /SEARCH_DELAY_MS/)
  assert.match(source, /latestRequest/)
  assert.match(source, /Select this folder/)
  assert.match(source, /const isSelectable = isDirectory \|\| isFile/)
  assert.match(source, /result\.value\.paths\.length/)
  assert.match(source, /inputActions\?\.notify\?\.\(/)
  assert.match(source, /MAX_SELECTION = 32/)
})
