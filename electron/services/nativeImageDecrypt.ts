import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const CURRENT_ADDON_NAME = 'ciphertalk-image-native'

type NativeDecryptResult = {
  data: Buffer
  ext: string
  isWxgf?: boolean
  is_wxgf?: boolean
}

type NativeAddon = {
  decryptDatNative: (inputPath: string, xorKey: number, aesKey?: string) => NativeDecryptResult
}

type NativeAddonMetadata = {
  name?: string
  version?: string
  vendor?: string
  source?: string
  platforms?: string[]
}

let cachedAddon: NativeAddon | null | undefined
let cachedMetadata: NativeAddonMetadata | null | undefined

function shouldEnableNative(): boolean {
  return process.env.CIPHERTALK_IMAGE_NATIVE !== '0'
}

function expandAsarCandidates(filePath: string): string[] {
  if (!filePath.includes('app.asar') || filePath.includes('app.asar.unpacked')) {
    return [filePath]
  }
  return [filePath.replace('app.asar', 'app.asar.unpacked'), filePath]
}

function getPlatformDir(): string {
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'linux') return 'linux'
  return process.platform
}

function getArchDir(): string {
  if (process.arch === 'x64') return 'x64'
  if (process.arch === 'arm64') return 'arm64'
  return process.arch
}

function getAddonCandidates(): string[] {
  const platformDir = getPlatformDir()
  const archDir = getArchDir()
  const cwd = process.cwd()
  const fileName = `${CURRENT_ADDON_NAME}-${platformDir}-${archDir}.node`
  const roots = [
    join(cwd, 'resources', 'wedecrypt'),
    ...(process.resourcesPath
      ? [
          join(process.resourcesPath, 'resources', 'wedecrypt'),
          join(process.resourcesPath, 'wedecrypt')
        ]
      : [])
  ]
  const candidates = roots.map((root) => join(root, fileName))
  return Array.from(new Set(candidates.flatMap(expandAsarCandidates)))
}

function loadAddon(): NativeAddon | null {
  if (!shouldEnableNative()) return null
  if (cachedAddon !== undefined) return cachedAddon

  for (const candidate of getAddonCandidates()) {
    if (!existsSync(candidate)) continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const addon = require(candidate) as NativeAddon
      if (addon && typeof addon.decryptDatNative === 'function') {
        cachedAddon = addon
        return addon
      }
    } catch {
      // try next candidate
    }
  }

  cachedAddon = null
  return null
}

function getMetadataCandidates(): string[] {
  const cwd = process.cwd()
  const candidates = [
    join(cwd, 'resources', 'wedecrypt', 'manifest.json'),
    ...(process.resourcesPath
      ? [
          join(process.resourcesPath, 'resources', 'wedecrypt', 'manifest.json'),
          join(process.resourcesPath, 'wedecrypt', 'manifest.json')
        ]
      : [])
  ]
  return Array.from(new Set(candidates.flatMap(expandAsarCandidates)))
}

export function nativeAddonMetadata(): NativeAddonMetadata | null {
  if (cachedMetadata !== undefined) return cachedMetadata

  for (const candidate of getMetadataCandidates()) {
    if (!existsSync(candidate)) continue
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as NativeAddonMetadata
      cachedMetadata = parsed
      return parsed
    } catch {
      // try next candidate
    }
  }

  cachedMetadata = null
  return null
}

export function nativeAddonLocation(): string | null {
  for (const candidate of getAddonCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function nativeDecryptEnabled(): boolean {
  return shouldEnableNative()
}

export function decryptDatViaNative(
  inputPath: string,
  xorKey: number,
  aesKey?: string
): { data: Buffer; ext: string; isWxgf: boolean } | null {
  const addon = loadAddon()
  if (!addon) return null

  try {
    const result = addon.decryptDatNative(inputPath, xorKey, aesKey)
    const isWxgf = Boolean(result?.isWxgf ?? result?.is_wxgf)
    if (!result || !Buffer.isBuffer(result.data)) return null
    const rawExt = typeof result.ext === 'string' && result.ext.trim()
      ? result.ext.trim().toLowerCase()
      : ''
    const ext = rawExt ? (rawExt.startsWith('.') ? rawExt : `.${rawExt}`) : ''
    return { data: result.data, ext, isWxgf }
  } catch {
    return null
  }
}
