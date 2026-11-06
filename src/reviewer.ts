import * as vscode from 'vscode';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export async function getApiKey(ctx: vscode.ExtensionContext): Promise<string | null> {
  const key = await ctx.secrets.get('ai-reviewer.deepseek-key');
  return key ?? null;
}

export async function setApiKey(ctx: vscode.ExtensionContext, key: string): Promise<void> {
  await ctx.secrets.store('ai-reviewer.deepseek-key', key);
}

export async function reviewCode(apiKey: string, system: string, user: string): Promise<string> {
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
    })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`HTTP ${resp.status} ${txt}`);
  }

  const data: any = await resp.json();
  return data.choices?.[0]?.message?.content ?? '（模型返回为空）';
}