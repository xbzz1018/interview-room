import type { Session } from 'electron'

export function sameOrigin(candidate: string, expected: string): boolean {
  try { return new URL(candidate).origin === new URL(expected).origin } catch { return false }
}

/** Text interviews never acquire microphone, camera or screen streams. */
export function configureInterviewPermissions(session: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler' | 'setDisplayMediaRequestHandler'>): void {
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
}
