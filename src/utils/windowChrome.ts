export type WindowPlatform = 'win32' | 'darwin' | 'linux'

type WindowChromeMetrics = {
  controlsLeftSafe: string
  controlsRightSafe: string
  toolbarGap: string
}

const DEFAULT_PLATFORM: WindowPlatform = 'win32'
const WINDOW_CHROME_HEIGHT = '40px'

const WINDOW_CHROME_METRICS: Record<WindowPlatform, WindowChromeMetrics> = {
  win32: {
    controlsLeftSafe: '16px',
    controlsRightSafe: '144px',
    toolbarGap: '10px'
  },
  darwin: {
    controlsLeftSafe: '84px',
    controlsRightSafe: '16px',
    toolbarGap: '8px'
  },
  linux: {
    controlsLeftSafe: '16px',
    controlsRightSafe: '144px',
    toolbarGap: '10px'
  }
}

export function normalizeWindowPlatform(platform?: string | null): WindowPlatform {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
    return platform
  }
  return DEFAULT_PLATFORM
}

export function getWindowChromeMetrics(platform?: string | null) {
  const normalizedPlatform = normalizeWindowPlatform(platform)
  return {
    platform: normalizedPlatform,
    chromeHeight: WINDOW_CHROME_HEIGHT,
    ...WINDOW_CHROME_METRICS[normalizedPlatform]
  }
}

export function applyWindowChromeToDocument(platform?: string | null, root: HTMLElement = document.documentElement) {
  const metrics = getWindowChromeMetrics(platform)

  root.dataset.windowPlatform = metrics.platform
  root.style.setProperty('--window-chrome-height', metrics.chromeHeight)
  root.style.setProperty('--window-controls-left-safe', metrics.controlsLeftSafe)
  root.style.setProperty('--window-controls-right-safe', metrics.controlsRightSafe)
  root.style.setProperty('--window-toolbar-gap', metrics.toolbarGap)
}
