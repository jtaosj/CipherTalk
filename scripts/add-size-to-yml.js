const fs = require('fs')
const path = require('path')

const releaseDir = path.join(__dirname, '../release')
const ymlPath = path.join(releaseDir, 'latest.yml')

if (!fs.existsSync(ymlPath)) {
  console.log('latest.yml 不存在，跳过')
  process.exit(0)
}

function getExeName(content) {
  const pathMatch = content.match(/path:\s*(.+\.exe)/)
  if (pathMatch) {
    return pathMatch[1].trim()
  }

  const urlMatch = content.match(/-\s+url:\s*(.+\.exe)/)
  if (urlMatch) {
    return urlMatch[1].trim()
  }

  return null
}

function finalizeFileItem(itemLines, size) {
  if (itemLines.length === 0) return itemLines

  const cleanedLines = itemLines.filter((line) => !line.trim().startsWith('size:'))
  const shaIndex = cleanedLines.findIndex((line) => line.trim().startsWith('sha512:'))
  const itemIndent = `${cleanedLines[0].match(/^\s*/)?.[0] || '  '}  `
  const sizeLine = `${itemIndent}size: ${size}`

  if (shaIndex >= 0) {
    cleanedLines.splice(shaIndex + 1, 0, sizeLine)
  } else {
    cleanedLines.push(sizeLine)
  }

  return cleanedLines
}

function normalizeLatestYml(content, size) {
  const lines = content.split(/\r?\n/)
  const filesIndex = lines.findIndex((line) => line.trim() === 'files:')
  if (filesIndex === -1) {
    return { changed: false, content, message: '未找到 files 块' }
  }

  let blockEnd = lines.length
  for (let i = filesIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      blockEnd = i
      break
    }
  }

  const before = lines.slice(0, filesIndex + 1)
  const fileBlock = lines.slice(filesIndex + 1, blockEnd)
  const after = lines.slice(blockEnd)

  const normalizedBlock = []
  let currentItem = []
  let handledFirstItem = false

  const flushItem = () => {
    if (currentItem.length === 0) return
    normalizedBlock.push(...(handledFirstItem ? currentItem : finalizeFileItem(currentItem, size)))
    handledFirstItem = true
    currentItem = []
  }

  for (const line of fileBlock) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) {
      flushItem()
      currentItem.push(line)
      continue
    }

    if (currentItem.length > 0) {
      currentItem.push(line)
    } else {
      normalizedBlock.push(line)
    }
  }

  flushItem()

  const nextContent = [...before, ...normalizedBlock, ...after].join('\n')
  return {
    changed: nextContent !== content,
    content: nextContent,
    message: nextContent !== content ? `已规范 latest.yml 中的 size 字段为 ${size}` : 'latest.yml 中的 size 字段已正确'
  }
}

const content = fs.readFileSync(ymlPath, 'utf-8')
const exeName = getExeName(content)

if (!exeName) {
  console.log('未找到安装包文件名')
  process.exit(0)
}

const exePath = path.join(releaseDir, exeName)
if (!fs.existsSync(exePath)) {
  console.log(`安装包不存在: ${exeName}`)
  process.exit(0)
}

const size = fs.statSync(exePath).size
const result = normalizeLatestYml(content, size)

if (result.changed) {
  fs.writeFileSync(ymlPath, result.content)
}

console.log(result.message)
