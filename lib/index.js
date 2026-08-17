import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

const CHANNEL = '/file-picker'
const MAX_DIRECTORY_ENTRIES = 500
const MAX_SELECTION = 32
const MAX_PATH_LENGTH = 4096

function failure(message) {
  return {
    ok: false,
    error: {
      code: 'internal',
      message,
      details: {},
    },
  }
}

function success(value) {
  return { ok: true, value }
}

function requireObject(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('request payload must be an object')
  }
  return payload
}

function requireSessionId(payload) {
  if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0 || payload.sessionId.length > 256) {
    throw new Error('sessionId must be a non-empty string')
  }
  return payload.sessionId
}

function requireAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH || !isAbsolute(value)) {
    throw new Error(`${fieldName} must be an absolute path`)
  }
  return value
}

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

async function classifyEntry(path, name) {
  try {
    const details = await stat(path)
    if (details.isDirectory()) return 'directory'
    if (details.isFile()) return 'file'
  } catch {
    // A race or an unreadable symlink should be visible but not selectable.
  }
  return 'other'
}

async function listDirectory(payload, signal) {
  const input = requireObject(payload)
  if (signal.aborted) throw new Error('request cancelled')

  const requestedPath = input.path === undefined ? homedir() : requireAbsolutePath(input.path, 'path')
  const path = await realpath(requestedPath)
  const details = await stat(path)
  if (!details.isDirectory()) throw new Error('path is not a directory')

  const rawEntries = await readdir(path, { withFileTypes: true })
  if (signal.aborted) throw new Error('request cancelled')

  const limitedEntries = rawEntries.slice(0, MAX_DIRECTORY_ENTRIES)
  const entries = await Promise.all(limitedEntries.map(async (entry) => {
    const entryPath = join(path, entry.name)
    const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : await classifyEntry(entryPath, entry.name)
    return {
      name: entry.name,
      path: entryPath,
      kind,
      hidden: entry.name.startsWith('.'),
    }
  }))

  entries.sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1
    if (left.kind !== 'directory' && right.kind === 'directory') return 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })

  const parent = dirname(path)
  return {
    path,
    parent: parent === path ? null : parent,
    home: homedir(),
    entries,
    truncated: rawEntries.length > limitedEntries.length,
  }
}

async function selectFiles(payload, selectedBySession) {
  const input = requireObject(payload)
  const sessionId = requireSessionId(input)
  if (!Array.isArray(input.paths) || input.paths.length > MAX_SELECTION) {
    throw new Error(`paths must contain at most ${MAX_SELECTION} entries`)
  }

  const selected = []
  const seen = new Set()
  for (const requestedPath of input.paths) {
    const path = await realpath(requireAbsolutePath(requestedPath, 'paths[]'))
    if (seen.has(path)) continue
    const details = await stat(path)
    if (!details.isFile()) throw new Error(`selected path is not a regular file: ${path}`)
    seen.add(path)
    selected.push(path)
  }

  selectedBySession.set(sessionId, selected)
  return { files: selected }
}

function selectedFilesContext(selectedBySession, context) {
  const sessionId = context.agent?.id
  if (sessionId === undefined) return ''
  const files = selectedBySession.get(sessionId)
  if (files === undefined || files.length === 0) return ''

  return [
    '<selected_files>',
    'The user selected these files for context. Use the read tool to read them when needed:',
    ...files.map((path) => `  - ${xmlEscape(path)}`),
    '</selected_files>',
  ].join('\n')
}

export const inject = ['connection', 'systemPrompt']

export function apply(ctx) {
  const selectedBySession = new Map()

  ctx.systemPrompt.context({
    name: 'dsh-file-picker:selected-files',
    order: 200,
    text: (context) => selectedFilesContext(selectedBySession, context),
  })

  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
    try {
      if (endpoint === 'list') return success(await listDirectory(payload, signal))
      if (endpoint === 'select') {
        const result = await selectFiles(payload, selectedBySession)
        ctx.emit('system-prompt/change')
        return success(result)
      }
      return failure(`unknown file-picker endpoint: ${endpoint}`)
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'file-picker request failed')
    }
  }, { authority: 'loopback' })
}
