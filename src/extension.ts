import * as vscode from 'vscode';
import { getApiKey, setApiKey, reviewCode } from './reviewer';
import { collectFile, collectCurrentPackage, collectWorkspace } from './collector';
import { showReport } from './webview';
import { SYSTEM_PROMPT } from './prompt';

type ReviewMode = 'file' | 'package' | 'workspace';

export function activate(context: vscode.ExtensionContext) {
  const register = (id: string, mode: ReviewMode) => {
    context.subscriptions.push(
      // uri 参数来自资源管理器右键，普通编辑器右键时为 undefined
      vscode.commands.registerCommand(id, async (uri?: vscode.Uri) => {
        await run(context, mode, uri);
      })
    );
  };

  register('ai-reviewer.reviewFile', 'file');
  register('ai-reviewer.reviewPackage', 'package');
  register('ai-reviewer.reviewWorkspace', 'workspace');

  context.subscriptions.push(
    vscode.commands.registerCommand('ai-reviewer.setApiKey', async () => {
      const input = await vscode.window.showInputBox({
        prompt: '输入 DeepSeek API Key',
        password: true,
        placeHolder: 'sk-...'
      });
      if (input) {
        await setApiKey(context, input.trim());
        vscode.window.showInformationMessage('API Key 已保存');
      }
    })
  );
}

async function run(ctx: vscode.ExtensionContext, mode: ReviewMode, uri?: vscode.Uri) {
  let key = await getApiKey(ctx);
  if (!key) {
    const input = await vscode.window.showInputBox({
      prompt: '首次使用，请输入 DeepSeek API Key',
      password: true
    });
    if (!input) { return; }
    key = input.trim();
    await setApiKey(ctx, key);
  }

  // 资源管理器里右键文件夹时，uri 指向那个文件夹
  const targetDir = uri && uri.scheme === 'file' ? uri.fsPath : undefined;

  let code: string | null = null;
  if (mode === 'file') { code = await collectFile(); }
  else if (mode === 'package') { code = await collectCurrentPackage(targetDir); }
  else { code = await collectWorkspace(targetDir); }

  if (!code) {
    vscode.window.showWarningMessage('没有可审查的代码');
    return;
  }

  const lang =
    mode === 'file'
      ? vscode.window.activeTextEditor?.document.languageId ?? 'unknown'
      : '前端/后端混合项目（TS/JS/Vue/React 等）';

  const scopeName =
    mode === 'file' ? '当前文件' : mode === 'package' ? '当前包' : '整个项目';

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `AI 逻辑审查中（${scopeName}）...` },
    async () => {
      try {
        const report = await reviewCode(
          key!,
          SYSTEM_PROMPT,
          `语言：${lang}\n审查范围：${scopeName}\n\n${code}`
        );
        showReport(ctx, report);
      } catch (e: any) {
        vscode.window.showErrorMessage(`审查失败：${e.message}`);
      }
    }
  );
}

export function deactivate() {}