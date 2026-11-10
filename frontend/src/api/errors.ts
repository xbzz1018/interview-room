/** Show backend guidance instead of a raw JSON blob or an HTML proxy page. */
export async function responseErrorText(response: Response): Promise<string> {
  const fallback = response.status >= 500
    ? '服务暂时不可用，请稍后重试；若持续失败，请检查模型配置或本地后端日志。'
    : `请求失败（${response.status}），请检查输入后重试。`;
  const text = await response.text();
  try {
    const value = JSON.parse(text);
    if (typeof value.detail === 'string' && value.detail !== 'Internal Server Error') return value.detail;
    if (Array.isArray(value.detail)) {
      const messages = value.detail.map((item: { msg?: unknown }) => typeof item.msg === 'string' ? item.msg : '').filter(Boolean);
      if (messages.length) return `输入有误：${messages.join('；')}`;
    }
    if (typeof value.error === 'string') return value.error;
  } catch { /* Non-JSON error pages use the status fallback. */ }
  return fallback;
}
