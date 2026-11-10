import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_APPEARANCE_READ_CHANNEL, DESKTOP_APPEARANCE_WRITE_CHANNEL, DESKTOP_BOOTSTRAP_CHANNEL, DESKTOP_RUNTIME_CHANNEL, type DesktopAppearanceTheme, type DesktopBootstrapSession, type DesktopRuntimeInfo } from './contracts.ts'

contextBridge.exposeInMainWorld('techsparDesktop', {
  getRuntimeInfo: (): Promise<DesktopRuntimeInfo> => ipcRenderer.invoke(DESKTOP_RUNTIME_CHANNEL),
  bootstrapSession: (): Promise<DesktopBootstrapSession> => ipcRenderer.invoke(DESKTOP_BOOTSTRAP_CHANNEL),
  getAppearanceTheme: (): Promise<DesktopAppearanceTheme | undefined> => ipcRenderer.invoke(DESKTOP_APPEARANCE_READ_CHANNEL),
  setAppearanceTheme: (theme: DesktopAppearanceTheme): Promise<void> => ipcRenderer.invoke(DESKTOP_APPEARANCE_WRITE_CHANNEL, theme),
})
