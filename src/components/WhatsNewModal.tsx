import { ReactNode } from 'react'
import { Aperture, Package, Send, Sparkles, Wand2 } from 'lucide-react'
import './WhatsNewModal.scss'

interface WhatsNewModalProps {
  onClose: () => void
  version: string
  releaseBody?: string
  releaseNotes?: string
}

type UpdateItem = {
  icon: ReactNode
  title: string
  desc: string
}

function inferTitle(text: string): string {
  if (/[修复|稳定|兼容|解决]/.test(text)) return '修复'
  if (/[优化|提升|改进|性能]/.test(text)) return '优化'
  if (/[新增|支持|加入|开放]/.test(text)) return '新增'
  return '更新'
}

function inferIcon(text: string): ReactNode {
  if (/[界面|动画|视觉|样式|体验]/.test(text)) return <Aperture size={20} />
  if (/[新增|支持|加入|开放]/.test(text)) return <Sparkles size={20} />
  if (/[优化|提升|改进|性能]/.test(text)) return <Wand2 size={20} />
  return <Package size={20} />
}

function parseAnnouncementText(content?: string): UpdateItem[] {
  if (!content?.trim()) return []

  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^#+\s*/.test(line) && !/^\d+\.\s*$/.test(line))
    .map(line => line.replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .slice(0, 5)

  return lines.map((line) => ({
    icon: inferIcon(line),
    title: inferTitle(line),
    desc: line
  }))
}

function buildFallbackUpdates(version: string): UpdateItem[] {
  return [
    {
      icon: <Sparkles size={20} />,
      title: '版本上线',
      desc: `已切换到 ${version}，界面与功能会自动按当前版本展示最新内容。`
    },
    {
      icon: <Wand2 size={20} />,
      title: '体验优化',
      desc: '我们会持续打磨性能、细节和稳定性，无需再为这条欢迎信息手动改文案。'
    },
    {
      icon: <Package size={20} />,
      title: '自动适配',
      desc: '如果发布说明存在，这里会优先自动展示本次更新要点。'
    }
  ]
}

function buildHeadline(version: string, updates: UpdateItem[]) {
  if (updates.length > 0) {
    return {
      title: `密语 ${version} 已就绪`,
      subtitle: '以下是这次版本自动整理出的更新重点'
    }
  }

  return {
    title: `欢迎使用密语 ${version}`,
    subtitle: '当前版本已安装完成，以下内容会根据版本自动展示'
  }
}

function WhatsNewModal({ onClose, version, releaseBody, releaseNotes }: WhatsNewModalProps) {
  const notesUpdates = parseAnnouncementText(releaseNotes)
  const bodyUpdates = parseAnnouncementText(releaseBody)
  const parsedUpdates = notesUpdates.length > 0 ? notesUpdates : bodyUpdates
  const items = parsedUpdates.length > 0 ? parsedUpdates : buildFallbackUpdates(version)
  const headline = buildHeadline(version, parsedUpdates)

  const handleTelegram = () => {
    window.electronAPI?.shell?.openExternal?.('https://t.me/+p7YzmRMBm-gzNzJl')
  }

  return (
    <div className="whats-new-overlay">
      <div className="whats-new-modal">
        <div className="modal-header">
          <span className="version-tag">新版本 {version}</span>
          <h2>{headline.title}</h2>
          <p>{headline.subtitle}</p>
        </div>

        <div className="modal-content">
          <div className="update-list">
            {items.map((item, index) => (
              <div className="update-item" key={`${item.title}-${index}`}>
                <div className="item-icon">
                  {item.icon}
                </div>
                <div className="item-info">
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="telegram-btn" onClick={handleTelegram}>
            <Send size={16} />
            加入 Telegram 频道
          </button>
          <button className="start-btn" onClick={onClose}>
            开始使用
          </button>
        </div>
      </div>
    </div>
  )
}

export default WhatsNewModal
