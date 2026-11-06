import * as vscode from 'vscode';

export function showReport(ctx: vscode.ExtensionContext, markdown: string) {
  const panel = vscode.window.createWebviewPanel(
    'aiReviewReport',
    'AI 逻辑审查报告',
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );

  const safe = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  panel.webview.html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  body{background:#1e1e1e;color:#d4d4d4;font-family:-apple-system,"Segoe UI",sans-serif;padding:20px;line-height:1.7}
  pre{white-space:pre-wrap;word-break:break-word}
</style></head>
<body>
<h2>📋 AI 逻辑审查报告</h2>
<hr/>
<pre>${safe}</pre>
</body></html>`;
}