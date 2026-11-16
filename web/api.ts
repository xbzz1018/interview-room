let token = '';
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!token) {
    const response = await fetch('/api/bootstrap');
    if (!response.ok) throw new Error('本机服务尚未连接');
    token = (await response.json()).token;
  }
  const response = await fetch(`/api${path}`, { method, headers: { Authorization: `Bearer ${token}`,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) token = ''; throw new Error(result.error ?? `请求失败 ${response.status}`); }
  return result as T;
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
