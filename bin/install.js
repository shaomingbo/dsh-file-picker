#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-file-picker'
const DEFAULT_SOURCE = 'github:shaomingbo/dsh-file-picker#v0.2.0'

function parseArgs(argv) {
  const result = { profile: 'web', source: process.env.DSH_FILE_PICKER_SOURCE || DEFAULT_SOURCE }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile') result.profile = argv[++index]
    else if (arg === '--source') result.source = argv[++index]
    else if (arg === '--help' || arg === '-h') result.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!result.profile || !result.source) throw new Error('--profile and --source require values')
  return result
}

function runInstall(profileDir) {
  const attempts = [
    ['pnpm', ['install', '--ignore-scripts']],
    ['corepack', ['pnpm', 'install', '--ignore-scripts']],
  ]
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { cwd: profileDir, stdio: 'inherit' })
    if (!result.error && result.status === 0) return
    if (result.error?.code !== 'ENOENT') {
      throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
    }
  }
  throw new Error('pnpm is unavailable; install pnpm or enable it with corepack')
}

async function atomicWrite(path, content) {
  const temp = `${path}.dsh-file-picker.tmp`
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(`Usage: ${PACKAGE_NAME} [--profile web] [--source github:shaomingbo/dsh-file-picker#v0.2.0]\n\nInstalls the file-picker bundle into a DSH profile.`)
    return
  }

  const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  const profileDir = join(dshHome, 'profiles', options.profile)
  const packagePath = join(profileDir, 'package.json')
  const original = await readFile(packagePath, 'utf8')
  const pkg = JSON.parse(original)
  pkg.dependencies ||= {}
  pkg.dependencies[PACKAGE_NAME] = options.source
  pkg.dsh ||= {}
  pkg.dsh.profile ||= {}
  pkg.dsh.profile.bundles ||= []
  if (!pkg.dsh.profile.bundles.includes(PACKAGE_NAME)) {
    pkg.dsh.profile.bundles.push(PACKAGE_NAME)
  }

  await atomicWrite(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
  try {
    runInstall(profileDir)
  } catch (error) {
    await atomicWrite(packagePath, original)
    throw error
  }

  console.log(`\nInstalled ${PACKAGE_NAME} into ${profileDir}`)
  console.log('Restart DSH, then refresh the Web GUI to load the new bundle.')
}

main().catch((error) => {
  const script = fileURLToPath(import.meta.url)
  console.error(`${script}: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
