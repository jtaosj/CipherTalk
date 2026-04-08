const pkg = require('../package.json')

const target = process.env.CIPHERTALK_BUILD_TARGET
const base = pkg.build || {}

function appendUnique(items = [], extras = []) {
  return [...new Set([...(items || []), ...extras])]
}

function withoutItems(items = [], values = []) {
  const blacklist = new Set(values)
  return (items || []).filter(item => !blacklist.has(item))
}

function getExtraResources(buildTarget) {
  const common = [
    {
      from: 'electron/assets/',
      to: 'assets/',
      filter: ['**/*']
    },
    {
      from: '.tmp/release-announcement.json',
      to: 'release-announcement.json'
    }
  ]

  if (buildTarget === 'mac') {
    return [
      {
        from: 'resources/macos/',
        to: 'resources/macos/',
        filter: ['**/*']
      },
      ...common
    ]
  }

  if (buildTarget === 'win') {
    return [
      {
        from: 'resources/',
        to: 'resources/',
        filter: ['*.dll']
      },
      ...common,
      {
        from: 'public/icon.ico',
        to: 'icon.ico'
      },
      {
        from: 'public/xinnian.ico',
        to: 'xinnian.ico'
      }
    ]
  }

  return base.extraResources || []
}

function getExtraFiles(buildTarget) {
  if (buildTarget === 'win') {
    return base.extraFiles || []
  }

  if (buildTarget === 'mac') {
    return [
      {
        from: 'scripts/ciphertalk-mcp',
        to: 'MacOS/ciphertalk-mcp'
      },
      {
        from: 'scripts/ciphertalk-mcp-bootstrap.cjs',
        to: 'MacOS/ciphertalk-mcp-bootstrap.cjs'
      }
    ]
  }

  return []
}

function getFiles(buildTarget) {
  const baseFiles = Array.isArray(base.files) ? [...base.files] : []
  const commonFiles = [
    '!node_modules/.vite/**/*'
  ]

  if (buildTarget === 'win') {
    return appendUnique(
      withoutItems(baseFiles, ['node_modules/koffi/build/**/*']),
      [
        ...commonFiles,
        '!node_modules/onnxruntime-node/bin/**/win32/arm64/**/*',
        'node_modules/koffi/build/koffi/win32_x64/**/*'
      ]
    )
  }

  return appendUnique(baseFiles, commonFiles)
}

function getAsarUnpack(buildTarget) {
  const baseAsarUnpack = Array.isArray(base.asarUnpack) ? [...base.asarUnpack] : []

  if (buildTarget === 'win') {
    return appendUnique(
      withoutItems(baseAsarUnpack, ['node_modules/koffi/**/*']),
      ['node_modules/koffi/build/koffi/win32_x64/**/*']
    )
  }

  return baseAsarUnpack
}

module.exports = {
  ...base,
  files: getFiles(target),
  asarUnpack: getAsarUnpack(target),
  extraResources: getExtraResources(target),
  extraFiles: getExtraFiles(target)
}
