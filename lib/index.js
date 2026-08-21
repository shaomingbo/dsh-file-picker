import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

const CHANNEL = '/file-picker'
const MAX_DIRECTORY_ENTRIES = 500
const MAX_SELECTION = 32
const MAX_PATH_LENGTH = 4096
const MAX_QUERY_LENGTH = 256

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

function requireQuery(value) {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) {
    throw new Error(`query must be a string of at most ${MAX_QUERY_LENGTH} characters`)
  }
  return value.trim().toLocaleLowerCase()
}

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;')
    .replaceAll('\u2028', '&#8232;')
    .replaceAll('\u2029', '&#8233;')
}

async function classifyEntry(path) {
  try {
    const details = await stat(path)
    if (details.isDirectory()) return 'directory'
    if (details.isFile()) return 'file'
  } catch {
    // A race or an unreadable symlink should be visible but not selectable.
  }
  return 'other'
}

function compareNames(left, right) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

async function listDirectory(payload, signal) {
  const input = requireObject(payload)
  const query = requireQuery(input.query)
  if (signal.aborted) throw new Error('request cancelled')

  const requestedPath = input.path === undefined ? homedir() : requireAbsolutePath(input.path, 'path')
  const path = await realpath(requestedPath)
  const details = await stat(path)
  if (!details.isDirectory()) throw new Error('path is not a directory')

  const rawEntries = await readdir(path, { withFileTypes: true })
  if (signal.aborted) throw new Error('request cancelled')

  const matchingEntries = query.length === 0
    ? rawEntries
    : rawEntries.filter((entry) => entry.name.toLocaleLowerCase().includes(query))
  const classifiedEntries = new Array(matchingEntries.length)
  let nextIndex = 0
  const classifyWorker = async () => {
    while (nextIndex < matchingEntries.length) {
      if (signal.aborted) throw new Error('request cancelled')
      const index = nextIndex
      nextIndex += 1
      const entry = matchingEntries[index]
      const entryPath = join(path, entry.name)
      const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : await classifyEntry(entryPath)
      classifiedEntries[index] = {
        name: entry.name,
        path: entryPath,
        kind,
        hidden: entry.name.startsWith('.'),
      }
    }
  }
  const workerCount = Math.min(32, matchingEntries.length)
  await Promise.all(Array.from({ length: workerCount }, classifyWorker))
  if (signal.aborted) throw new Error('request cancelled')

  classifiedEntries.sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1
    if (left.kind !== 'directory' && right.kind === 'directory') return 1
    return compareNames(left, right)
  })
  const entries = classifiedEntries.slice(0, MAX_DIRECTORY_ENTRIES)

  const parent = dirname(path)
  return {
    path,
    parent: parent === path ? null : parent,
    home: homedir(),
    entries,
    truncated: classifiedEntries.length > entries.length,
  }
}

async function selectPaths(payload, selectedBySession) {
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
    const kind = details.isFile() ? 'file' : details.isDirectory() ? 'directory' : null
    if (kind === null) throw new Error(`selected path is not a regular file or directory: ${path}`)
    seen.add(path)
    selected.push({ path, kind })
  }

  selectedBySession.set(sessionId, selected)
  return {
    paths: selected.map((entry) => entry.path),
    files: selected.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
    directories: selected.filter((entry) => entry.kind === 'directory').map((entry) => entry.path),
  }
}

function selectedPathsContext(selectedBySession, context) {
  const sessionId = context.agent?.id
  if (sessionId === undefined) return ''
  const selected = selectedBySession.get(sessionId)
  if (selected === undefined || selected.length === 0) return ''

  const files = selected.filter((entry) => entry.kind === 'file')
  const directories = selected.filter((entry) => entry.kind === 'directory')
  const lines = [
    '<selected_paths>',
    'The user selected these local filesystem paths for context.',
  ]
  if (files.length > 0) {
    lines.push('Files (use the read tool to read them when needed):')
    lines.push(...files.map((entry) => `  - ${xmlEscape(entry.path)}`))
  }
  if (directories.length > 0) {
    lines.push('Directories (use glob or grep to inspect their contents when needed):')
    lines.push(...directories.map((entry) => `  - ${xmlEscape(entry.path)}`))
  }
  lines.push('</selected_paths>')
  return lines.join('\n')
}

export const inject = ['connection', 'systemPrompt']

export function apply(ctx) {
  const selectedBySession = new Map()

  ctx.systemPrompt.context({
    name: 'dsh-file-picker:selected-paths',
    order: 200,
    text: (context) => selectedPathsContext(selectedBySession, context),
  })

  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
    try {
      if (endpoint === 'list') return success(await listDirectory(payload, signal))
      if (endpoint === 'select') {
        const result = await selectPaths(payload, selectedBySession)
        ctx.emit('system-prompt/change')
        return success(result)
      }
      return failure(`unknown file-picker endpoint: ${endpoint}`)
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'file-picker request failed')
    }
  }, { authority: 'loopback' })
}
