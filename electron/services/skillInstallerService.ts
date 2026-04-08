import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'

type SkillSource = {
  name: string
  relativePaths: string[]
}

type SkillMeta = {
  name: string
  version: string
  description?: string
}

const MANAGED_SKILLS: Record<string, SkillSource> = {
  'ct-mcp-copilot': {
    name: 'ct-mcp-copilot',
    relativePaths: [
      'ct-mcp-copilot',
      join('skills', 'ct-mcp-copilot'),
      join('sikll', 'ct-mcp-copilot')
    ]
  }
}

export class SkillInstallerService {
  private listSkillSourceCandidates(skillName: string): string[] {
    const source = MANAGED_SKILLS[skillName]
    if (!source) return []

    const roots = [
      join(process.resourcesPath, 'builtin-skills'),
      app.getAppPath(),
      join(process.resourcesPath, 'app.asar'),
      join(process.resourcesPath, 'app.asar.unpacked'),
      process.resourcesPath,
      process.cwd()
    ]

    const seen = new Set<string>()
    const candidates: string[] = []

    for (const root of roots) {
      for (const relativePath of source.relativePaths) {
        const candidate = join(root, relativePath)
        const normalized = candidate.toLowerCase()
        if (seen.has(normalized)) continue
        seen.add(normalized)
        candidates.push(candidate)
      }
    }

    return candidates
  }

  private getSkillSourcePath(skillName: string): string | null {
    for (const candidate of this.listSkillSourceCandidates(skillName)) {
      if (existsSync(join(candidate, 'SKILL.md'))) return candidate
    }
    return null
  }

  private readSkillMeta(skillDir: string): SkillMeta | null {
    try {
      const metaPath = join(skillDir, '.skill-meta.json')
      if (!existsSync(metaPath)) return null
      return JSON.parse(readFileSync(metaPath, 'utf8')) as SkillMeta
    } catch {
      return null
    }
  }

  exportSkillZip(skillName: string): { success: boolean; outputPath?: string; fileName?: string; version?: string; error?: string } {
    const sourcePath = this.getSkillSourcePath(skillName)
    if (!sourcePath) {
      const tried = this.listSkillSourceCandidates(skillName)
      return { success: false, error: `Skill source not found for ${skillName}. Tried: ${tried.join(' | ')}` }
    }

    try {
      const downloadsDir = app.getPath('downloads')
      const version = this.readSkillMeta(sourcePath)?.version || '0.0.0'
      const fileName = `${skillName}-v${version}.zip`
      const outputPath = join(downloadsDir, fileName)
      const zip = new AdmZip()
      zip.addLocalFolder(sourcePath, skillName)
      zip.writeZip(outputPath)
      return { success: true, outputPath, fileName, version }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

export const skillInstallerService = new SkillInstallerService()
