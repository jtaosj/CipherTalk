import { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { usePlatformInfo } from '../hooks/usePlatformInfo'
import { useTitleBarStore } from '../stores/titleBarStore'
import { useUpdateStatusStore } from '../stores/updateStatusStore'
import { useThemeStore } from '../stores/themeStore'
import './TitleBar.scss'

interface TitleBarProps {
  className?: string
  rightContent?: ReactNode
  title?: string
  variant?: 'app' | 'standalone'
}

function TitleBar({ className, rightContent, title, variant = 'app' }: TitleBarProps) {
  const storeRightContent = useTitleBarStore(state => state.rightContent)
  const displayContent = rightContent ?? storeRightContent
  const isUpdating = useUpdateStatusStore(state => state.isUpdating)
  const appIcon = useThemeStore(state => state.appIcon)
  const { isMac } = usePlatformInfo()
  const titleBarClassName = ['title-bar', `variant-${variant}`, isMac ? 'is-mac' : 'is-win', className]
    .filter(Boolean)
    .join(' ')

  const updateStatusNode = isUpdating ? (
    <div className="update-status">
      <RefreshCw
        className="update-indicator"
        size={16}
        strokeWidth={2.5}
      />
      <span className="update-text">正在同步数据...</span>
    </div>
  ) : null

  const titleNode = (
    <>
      <img src={appIcon === 'xinnian' ? "./xinnian.png" : "./logo.png"} alt="密语" className="title-logo" />
      <span className="titles">{title || 'CipherTalk'}</span>
    </>
  )

  return (
    <div className={titleBarClassName}>
      <div className="title-bar-left">
        {isMac ? (
          <div className="title-bar-traffic-spacer" aria-hidden="true" />
        ) : (
          <>
            {titleNode}
            {updateStatusNode}
          </>
        )}
      </div>
      {isMac && (
        <div className="title-bar-center">
          {titleNode}
        </div>
      )}
      <div className="title-bar-right">
        {isMac && updateStatusNode}
        {displayContent}
      </div>
    </div>
  )
}

export default TitleBar
