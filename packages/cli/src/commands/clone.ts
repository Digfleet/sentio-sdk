import { Command } from '@commander-js/extra-typings'
import { getFinalizedHost } from '../config.js'
import { ReadKey } from '../key.js'
import { getApiUrl } from '../utils.js'
import { Auth } from '../uploader.js'
import fetch from 'node-fetch'
import chalk from 'chalk'
import fs from 'fs-extra'
import path from 'path'
import JSZip from 'jszip'
import { execPackageManager } from '../execution.js'
import { CommandOptionsType } from './types.js'

export function createCloneCommand() {
  return new Command('clone')
    .description('Clone an existing Sentio project from the platform')
    .argument('<project>', 'Project to clone in the format owner/project-name')
    .option('--host <host>', '(Optional) Override Sentio Host name')
    .option('--api-key <key>', '(Optional) Manually provide API key rather than use saved credential')
    .option('-d, --directory <dir>', '(Optional) The directory to clone the project into, defaults to project name')
    .option('--version <version>', '(Optional) Specific processor version to clone, defaults to latest')
    .action(async (project, options) => {
      await runCloneInternal(project, options)
    })
}

async function runCloneInternal(project: string, options: CommandOptionsType<typeof createCloneCommand>) {
  const host = getFinalizedHost(options.host)

  // Setup auth
  const auth: Auth = {}
  let apiKey = ReadKey(host)
  if (options.apiKey) {
    apiKey = options.apiKey
  }
  if (apiKey) {
    auth['api-key'] = apiKey
  } else {
    const isProd = host === 'https://app.sentio.xyz'
    const cmd = isProd ? 'sentio login' : 'sentio login --host=' + host
    console.error(chalk.red('No Credential found for', host, '. Please run `' + cmd + '`.'))
    process.exit(1)
  }

  // Validate project format
  const parts = project.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error(chalk.red('Project must be in the format owner/project-name'))
    process.exit(1)
  }

  const [owner, slug] = parts

  // Determine destination directory
  const destDir = options.directory || slug
  const destPath = path.resolve(process.cwd(), destDir)

  if (fs.existsSync(destPath)) {
    console.error(chalk.red(`Destination directory '${destDir}' already exists`))
    process.exit(1)
  }

  console.log(chalk.blue(`Cloning project ${project}...`))

  // Build source download URL
  const versionParam = options.version ? `?version=${options.version}` : ''
  const sourceUrl = getApiUrl(`/api/v1/processors/${owner}/${slug}/source${versionParam}`, host)

  const response = await fetch(sourceUrl.href, {
    headers: { ...auth }
  })

  if (response.status === 404) {
    console.error(chalk.red(`Project '${project}' not found`))
    process.exit(1)
  }

  if (!response.ok) {
    console.error(chalk.red(`Failed to clone project: ${response.status} ${response.statusText}`))
    process.exit(1)
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer())

  // Extract ZIP into destination directory
  const zip = await JSZip.loadAsync(sourceBuffer)

  fs.mkdirSync(destPath, { recursive: true })

  for (const [filename, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    const content = await file.async('nodebuffer')
    const filePath = path.join(destPath, filename)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }

  console.log(chalk.green(`Successfully cloned '${project}' into '${destDir}'`))
  console.log(chalk.green('Running install...'))

  await execPackageManager(['install'], 'install', { cwd: destPath })
}
