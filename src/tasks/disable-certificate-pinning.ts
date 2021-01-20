import * as os from 'os'
import * as path from 'path'
import * as fs from '../utils/fs'

import globby = require('globby')
import escapeStringRegexp = require('escape-string-regexp')
import { ListrTaskWrapper } from 'listr'
import observeAsync from '../utils/observe-async'

const INTERFACE_LINE = '.implements Ljavax/net/ssl/X509TrustManager;'

/** The methods that need to be patched to disable certificate pinning. */
const METHOD_SIGNATURES = [
  'checkClientTrusted([Ljava/security/cert/X509Certificate;Ljava/lang/String;)V',
  'checkServerTrusted([Ljava/security/cert/X509Certificate;Ljava/lang/String;)V',
  'getAcceptedIssuers()[Ljava/security/cert/X509Certificate;',
]

/** Patterns used to find the methods defined in `METHOD_SIGNATURES`. */
const METHOD_PATTERNS = METHOD_SIGNATURES.map(signature => {
  const escapedSignature = escapeStringRegexp(signature)
  return new RegExp(
    `(\\.method public (?:final )?${escapedSignature})\\n([^]+?)\\n(\\.end method)`,
    'g',
  )
})

/** Code inserted into `checkClientTrusted` and `checkServerTrusted`. */
const RETURN_VOID_FIX = ['.locals 0', 'return-void']

/** Code inserted into `getAcceptedIssuers`. */
const RETURN_EMPTY_ARRAY_FIX = [
  '.locals 1',
  'const/4 v0, 0x0',
  'new-array v0, v0, [Ljava/security/cert/X509Certificate;',
  'return-object v0',
]

export default async function disableCertificatePinning(
  directoryPath: string,
  task: ListrTaskWrapper,
) {
  return observeAsync(async next => {
    // Convert Windows path (using backslashes) to POSIX path (using slashes)
    const directoryPathPosix = directoryPath
      .split(path.sep)
      .join(path.posix.sep)
    const globPattern = path.posix.join(directoryPathPosix, 'smali*/**/*.smali')

    let pinningFound = false

    next('Scanning Smali files...')
    for await (const filePathChunk of globby.stream(globPattern)) {
      // Required because Node.js streams are not typed as generics
      const filePath = filePathChunk as string

      const hadPinning = await processSmaliFile(filePath)
      if (hadPinning) {
        pinningFound = true

        const relativePath = path.relative(directoryPath, filePath)
        next(`Applied patch in "${relativePath}".`)
      }
    }

    if (!pinningFound) task.skip('No certificate pinning logic found.')
  })
}

/**
 * Process the given Smali file and apply applicable patches.
 * @returns whether patches were applied
 */
async function processSmaliFile(filePath: string): Promise<boolean> {
  let originalContent = await fs.readFile(filePath, 'utf-8')

  // Don't scan classes that don't implement the interface
  if (!originalContent.includes(INTERFACE_LINE)) return false

  if (os.type() === 'Windows_NT') {
    // Replace CRLF with LF, so that patches can just use '\n'
    originalContent = originalContent.replace(/\r\n/g, '\n')
  }

  let patchedContent = originalContent

  for (const pattern of METHOD_PATTERNS) {
    patchedContent = patchedContent.replace(
      pattern,
      (_, openingLine: string, body: string, closingLine: string) => {
        const bodyLines = body
          .split('\n')
          .map(line => line.replace(/^    /, ''))

        const fixLines = openingLine.includes('getAcceptedIssuers')
          ? RETURN_EMPTY_ARRAY_FIX
          : RETURN_VOID_FIX

        const patchedBodyLines = [
          '# inserted by apk-mitm to disable certificate pinning',
          ...fixLines,
          '',
          '# commented out by apk-mitm to disable old method body',
          '# ',
          ...bodyLines.map(line => `# ${line}`),
        ]

        return [
          openingLine,
          ...patchedBodyLines.map(line => `    ${line}`),
          closingLine,
        ]
          .map(line => line.trimEnd())
          .join('\n')
      },
    )
  }

  if (originalContent !== patchedContent) {
    if (os.type() === 'Windows_NT') {
      // Replace LF with CRLF again
      patchedContent = patchedContent.replace(/\n/g, '\r\n')
    }

    await fs.writeFile(filePath, patchedContent)
    return true
  }

  return false
}
