type TechSparDesktopRuntimeInfo = {
  appVersion: string
  platform: string
  arch: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

type TechSparDesktopBootstrapSession = {
  token: string
  user: { id: string; email: string; name: string; is_admin: boolean }
}

interface Window {
  techsparDesktop?: {
    getKnowledgeDrafts?(): Promise<Record<string, { base: string; content: string }>>
    setKnowledgeDraft?(key: string, draft: { base: string; content: string } | null): Promise<void>
    getRuntimeInfo(): Promise<TechSparDesktopRuntimeInfo>
    bootstrapSession(): Promise<TechSparDesktopBootstrapSession>
    getAppearanceTheme?(): Promise<'navy' | 'teal' | 'wine' | undefined>
    setAppearanceTheme?(theme: 'navy' | 'teal' | 'wine'): Promise<void>
  }
}
