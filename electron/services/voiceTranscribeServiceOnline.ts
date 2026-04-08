import { ConfigService } from './config'

type OnlineProvider = 'openai-compatible' | 'aliyun-qwen-asr' | 'custom'

export interface OnlineTranscribeConfig {
  provider: OnlineProvider
  apiKey: string
  baseURL: string
  model: string
  language: string
  timeoutMs: number
}

type OnlineTranscribeOverrides = Partial<OnlineTranscribeConfig>

export class VoiceTranscribeServiceOnline {
  private configService = new ConfigService()

  private extractAliyunTextFromContent(content: any): string {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item
          return item?.text || item?.transcript || item?.content || ''
        })
        .join('')
    }
    return String(content?.text || content?.transcript || content?.content || '')
  }

  private async transcribeWithAliyun(
    wavData: Buffer,
    config: OnlineTranscribeConfig,
    signal: AbortSignal,
    onPartial?: (text: string) => void
  ): Promise<{ success: boolean; transcript?: string; error?: string }> {
    const dataUrl = `data:audio/wav;base64,${wavData.toString('base64')}`
    const response = await fetch(this.resolveRequestUrl(config), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: dataUrl,
                  format: 'wav'
                }
              }
            ]
          }
        ]
      }),
      signal
    })

    if (!response.ok) {
      let payload: any = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: '阿里云在线转写认证失败，请检查 API Key' }
      }
      if (response.status === 429) {
        return { success: false, error: '阿里云在线转写请求过于频繁或额度不足，请稍后重试' }
      }
      const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`
      return { success: false, error: `阿里云在线转写失败: ${message}` }
    }

    if (!response.body) {
      return { success: false, error: '阿里云在线转写未返回可读取的数据流' }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let transcript = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''

      for (const event of events) {
        const dataLines = event
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'))

        for (const line of dataLines) {
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue

          try {
            const chunk = JSON.parse(data)
            const delta = chunk?.choices?.[0]?.delta
            const text = this.extractAliyunTextFromContent(delta?.content)
            if (text) {
              transcript += text
              onPartial?.(transcript)
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    }

    transcript = transcript.trim()
    if (!transcript) {
      return { success: false, error: '阿里云接口返回成功，但未提取到识别文本' }
    }

    return { success: true, transcript }
  }

  private resolveTranscriptionUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim().replace(/\/+$/, '')
    if (!trimmed) return ''

    try {
      const url = new URL(trimmed)
      if (url.pathname.endsWith('/audio/transcriptions')) {
        return url.toString()
      }
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/audio/transcriptions`
      return url.toString()
    } catch {
      return trimmed
    }
  }

  private resolveModelsUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim().replace(/\/+$/, '')
    if (!trimmed) return ''

    try {
      const url = new URL(trimmed)
      if (url.pathname.endsWith('/audio/transcriptions')) {
        url.pathname = url.pathname.replace(/\/audio\/transcriptions$/, '/models')
      } else {
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
      }
      return url.toString()
    } catch {
      return trimmed
    }
  }

  private resolveAliyunChatUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim().replace(/\/+$/, '')
    if (!trimmed) return ''

    try {
      const url = new URL(trimmed)
      if (url.pathname.endsWith('/chat/completions')) {
        return url.toString()
      }
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
      return url.toString()
    } catch {
      return trimmed
    }
  }

  getConfig(): OnlineTranscribeConfig {
    return {
      provider: (this.configService.get('sttOnlineProvider') as OnlineProvider) || 'openai-compatible',
      apiKey: String(this.configService.get('sttOnlineApiKey') || '').trim(),
      baseURL: String(this.configService.get('sttOnlineBaseURL') || '').trim(),
      model: String(this.configService.get('sttOnlineModel') || '').trim(),
      language: String(this.configService.get('sttOnlineLanguage') || 'auto').trim() || 'auto',
      timeoutMs: Number(this.configService.get('sttOnlineTimeoutMs') || 60000) || 60000
    }
  }

  validateConfig(config = this.getConfig()): { valid: boolean; error?: string } {
    if (!config.baseURL) {
      return { valid: false, error: '请先配置在线转写接口 URL' }
    }
    try {
      new URL(config.baseURL)
    } catch {
      return { valid: false, error: '在线转写接口 URL 格式无效' }
    }
    if (!config.apiKey) {
      return { valid: false, error: '请先配置在线转写 API Key' }
    }
    if (!config.model) {
      return { valid: false, error: '请先配置在线转写模型名称' }
    }
    if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 5000) {
      return { valid: false, error: '在线转写超时时间配置无效' }
    }
    return { valid: true }
  }

  private resolveRequestUrl(config: OnlineTranscribeConfig): string {
    if (config.provider === 'aliyun-qwen-asr') {
      return this.resolveAliyunChatUrl(config.baseURL)
    }
    return config.provider === 'custom'
      ? config.baseURL.trim()
      : this.resolveTranscriptionUrl(config.baseURL)
  }

  private resolveTestUrl(config: OnlineTranscribeConfig): string {
    if (config.provider === 'aliyun-qwen-asr') {
      return this.resolveModelsUrl(config.baseURL)
    }
    return config.provider === 'custom'
      ? config.baseURL.trim()
      : this.resolveModelsUrl(config.baseURL)
  }

  async testConfig(overrides?: OnlineTranscribeOverrides): Promise<{ success: boolean; error?: string }> {
    const config = { ...this.getConfig(), ...overrides }
    const validation = this.validateConfig(config)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const response = await fetch(this.resolveTestUrl(config), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.apiKey}`
        },
        signal: controller.signal
      })

      if (response.ok) {
        return { success: true }
      }

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: '在线转写认证失败，请检查 API Key' }
      }

      if (config.provider === 'custom' && [400, 405, 415].includes(response.status)) {
        return { success: true }
      }

      if (response.status === 404) {
        return {
          success: false,
          error:
            config.provider === 'custom'
              ? '自定义接口 URL 不可用，请确认你填写的是完整接口地址'
              : config.provider === 'aliyun-qwen-asr'
                ? '阿里云接口 URL 不可用，请确认是否为 DashScope 兼容入口地址'
                : '接口 URL 不可用，请确认它是否为 OpenAI 兼容接口或对应的 /v1 地址'
        }
      }

      return { success: false, error: `在线转写配置测试失败: HTTP ${response.status}` }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { success: false, error: '在线转写配置测试超时，请检查网络或缩短接口链路' }
      }
      return { success: false, error: `在线转写配置测试失败: ${String(e)}` }
    } finally {
      clearTimeout(timeout)
    }
  }

  async transcribeWavBuffer(
    wavData: Buffer,
    onPartial?: (text: string) => void
  ): Promise<{ success: boolean; transcript?: string; error?: string }> {
    const config = this.getConfig()
    const validation = this.validateConfig(config)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      if (config.provider === 'aliyun-qwen-asr') {
        return await this.transcribeWithAliyun(wavData, config, controller.signal, onPartial)
      }

      const form = new FormData()
      const file = new Blob([new Uint8Array(wavData)], { type: 'audio/wav' })
      form.append('file', file, 'voice.wav')
      form.append('model', config.model)
      if (config.language && config.language !== 'auto') {
        form.append('language', config.language)
      }
      form.append('response_format', 'json')

      const response = await fetch(this.resolveRequestUrl(config), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`
        },
        body: form,
        signal: controller.signal
      })

      let payload: any = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { success: false, error: '在线转写认证失败，请检查 API Key' }
        }
        if (response.status === 429) {
          return { success: false, error: '在线转写请求过于频繁或额度不足，请稍后重试' }
        }
        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`
        return { success: false, error: `在线转写失败: ${message}` }
      }

      const transcript = String(payload?.text || payload?.transcript || '').trim()
      if (!transcript) {
        return { success: false, error: '在线转写成功但未返回文本结果' }
      }

      return { success: true, transcript }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return { success: false, error: '在线转写请求超时，请稍后重试' }
      }
      return { success: false, error: `在线转写失败: ${String(e)}` }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export const voiceTranscribeServiceOnline = new VoiceTranscribeServiceOnline()
