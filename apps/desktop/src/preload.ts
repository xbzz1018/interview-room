import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_DRAFTS_READ_CHANNEL, DESKTOP_DRAFTS_WRITE_CHANNEL, DESKTOP_APPEARANCE_READ_CHANNEL, DESKTOP_APPEARANCE_WRITE_CHANNEL, DESKTOP_BOOTSTRAP_CHANNEL, DESKTOP_RUNTIME_CHANNEL, type DesktopAppearanceTheme, type DesktopBootstrapSession, type DesktopRuntimeInfo } from './contracts.ts'

contextBridge.exposeInMainWorld('techsparDesktop', {
  getKnowledgeDrafts: (): Promise<Record<string, { base: string; content: string }>> => ipcRenderer.invoke(DESKTOP_DRAFTS_READ_CHANNEL),
  setKnowledgeDraft: (key: string, draft: { base: string; content: string } | null): Promise<void> => ipcRenderer.invoke(DESKTOP_DRAFTS_WRITE_CHANNEL, key, draft),
  getRuntimeInfo: (): Promise<DesktopRuntimeInfo> => ipcRenderer.invoke(DESKTOP_RUNTIME_CHANNEL),
  bootstrapSession: (): Promise<DesktopBootstrapSession> => ipcRenderer.invoke(DESKTOP_BOOTSTRAP_CHANNEL),
  getAppearanceTheme: (): Promise<DesktopAppearanceTheme | undefined> => ipcRenderer.invoke(DESKTOP_APPEARANCE_READ_CHANNEL),
  setAppearanceTheme: (theme: DesktopAppearanceTheme): Promise<void> => ipcRenderer.invoke(DESKTOP_APPEARANCE_WRITE_CHANNEL, theme),
})
