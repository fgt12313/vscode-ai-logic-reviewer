import * as vscode from 'vscode';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export async function getApiKey(ctx: vscode.ExtensionContext): Promise<string | null> {
  const key = await ctx.secrets.get('ai-reviewer.deepseek-key');
  return key ?? null;
}

export async function setApiKey(ctx: vscode.ExtensionContext, key: string): Promise<void> {
  await ctx.secrets.store('ai-reviewer.deepseek-key', key);
}

const REQUEST_TIMEOUT_MS = 120_000; // 2 分钟超时

export async function reviewCode(apiKey: string, system: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.3
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`HTTP ${resp.status} ${txt}`);
    }

    const data: any = await resp.json();
    return data.choices?.[0]?.message?.content ?? '（模型返回为空）';
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}