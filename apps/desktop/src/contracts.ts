export type DesktopRuntimeInfo = {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

export const DESKTOP_DRAFTS_READ_CHANNEL = 'interview-room:drafts-read'
export const DESKTOP_DRAFTS_WRITE_CHANNEL = 'interview-room:drafts-write'

export const DESKTOP_RUNTIME_CHANNEL = 'techspar:runtime-info'
export type DesktopAppearanceTheme = 'navy' | 'teal' | 'wine'
export const DESKTOP_APPEARANCE_READ_CHANNEL = 'techspar:appearance-read'
export const DESKTOP_APPEARANCE_WRITE_CHANNEL = 'techspar:appearance-write'

export type DesktopBootstrapSession = {
  token: string
  user: { id: string; email: string; name: string; is_admin: boolean }
}

export const DESKTOP_BOOTSTRAP_CHANNEL = 'techspar:bootstrap-session'
