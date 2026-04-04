import { useEffect, useState } from 'react'
import './SplashPage.scss'

const loadingMessages = [
  '正在校验本地环境',
  '正在连接数据库',
  '正在整理聊天索引'
]

function SplashPage() {
  const [fadeOut, setFadeOut] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const readyTimer = setTimeout(() => {
      try {
        // @ts-ignore - splashReady 方法在运行时可用
        window.electronAPI?.window?.splashReady?.()
      } catch (e) {
        console.error('通知启动屏就绪失败:', e)
      }
    }, 1000)

    const messageTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % loadingMessages.length)
    }, 1600)

    const cleanup = window.electronAPI?.window?.onSplashFadeOut?.(() => {
      setFadeOut(true)
    })

    return () => {
      clearTimeout(readyTimer)
      clearInterval(messageTimer)
      cleanup?.()
    }
  }, [])

  return (
    <div className={`splash-page ${fadeOut ? 'fade-out' : ''}`}>
      <div className="splash-orb splash-orb-left" />
      <div className="splash-orb splash-orb-right" />

      <div className="splash-content">
        <div className="splash-brand">
          <div className="splash-logo-shell">
            <div className="splash-logo-glow" />
            <img
              className="splash-logo-image"
              src="./logo.png"
              alt="密语"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                const textEl = e.currentTarget.nextElementSibling as HTMLElement | null
                if (textEl) textEl.style.display = 'grid'
              }}
            />
            <div className="splash-logo-fallback" style={{ display: 'none' }}>密语</div>
          </div>

          <div className="splash-copy">
            <span className="splash-eyebrow">CipherTalk</span>
            <h1>密语</h1>
            <p>本地聊天记录分析工作台</p>
          </div>
        </div>

        <div className="splash-status">
          <div className="splash-status-row">
            <span className="splash-status-dot" />
            <span key={loadingMessages[messageIndex]} className="splash-status-text">
              {loadingMessages[messageIndex]}
            </span>
          </div>

          <div className="splash-progress-track" aria-hidden="true">
            <div className="splash-progress-bar" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SplashPage
