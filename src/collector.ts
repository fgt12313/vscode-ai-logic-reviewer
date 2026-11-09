import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 只扫描这些扩展名的文件，避免把图片/二进制塞给模型
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.html', '.css', '.scss', '.less',
  '.json', '.java', '.kt', '.py', '.go', '.rs',
  '.sql', '.yml', '.yaml', '.xml'
]);

// 跳过这些目录
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage',
  '.git', '.svn', '.idea', '.vscode',
  '.next', '.nuxt', 'target', 'vendor', '__pycache__'
]);

// 扫描预算：防止一次把整个仓库塞进 prompt 导致超 token
const MAX_FILES = 300;            // 最多扫多少个文件
const MAX_TOTAL_CHARS = 200_000;  // 累计字符上限
const MAX_SINGLE_FILE_CHARS = 60_000; // 单文件字符上限，超出截断
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 只跳过超大文件，其余统一按字符截断

interface Budget {
  files: number;
  chars: number;
  truncated: boolean;
}

function newBudget(): Budget {
  return { files: 0, chars: 0, truncated: false };
}

/** 绝对路径 → 相对路径（统一用 / 分隔），避免把磁盘路径发给模型 */
function toRelativePath(baseDir: string, fullPath: string): string {
  return path.relative(baseDir, fullPath).split(path.sep).join('/');
}

/** 找到包含该文件的 workspace 根目录，找不到就退回其父目录 */
function workspaceRootFor(fsPath: string): string {
  const roots = vscode.workspace.workspaceFolders ?? [];
  const root = roots.find(
    (f) => f.uri.scheme === 'file' && fsPath.startsWith(f.uri.fsPath + path.sep)
  );
  return root?.uri.fsPath ?? path.dirname(fsPath);
}

/** 递归扫描一个目录，把符合白名单的源码拼成一段带文件头的文本 */
function scanDirectory(rootDir: string, budget: Budget): string[] {
  const parts: string[] = [];

  const walk = (dir: string): void => {
    if (budget.truncated) { return; }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 无权限目录直接跳过
    }

    for (const entry of entries) {
      if (budget.truncated) { return; }

      const fullPath = path.join(dir, entry.name);

      // 符号链接跳过，防止循环递归
      if (entry.isSymbolicLink()) { continue; }

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) { continue; }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) { continue; }

      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) { continue; }

      if (budget.files >= MAX_FILES) {
        budget.truncated = true;
        return;
      }

      try {
        const stat = fs.statSync(fullPath);
        // 只跳过超大文件，避免把几 MB 的产物读进内存；其余统一按字符截断
        if (stat.size > MAX_FILE_BYTES) { continue; }

        let text = fs.readFileSync(fullPath, 'utf-8');
        if (text.length > MAX_SINGLE_FILE_CHARS) {
          text = text.slice(0, MAX_SINGLE_FILE_CHARS) + '\n// ...(文件过长，已截断)';
        }

        const chunk = `// 文件: ${toRelativePath(rootDir, fullPath)}\n${text}`;
        if (budget.chars + chunk.length > MAX_TOTAL_CHARS) {
          budget.truncated = true;
          return;
        }

        parts.push(chunk);
        budget.chars += chunk.length;
        budget.files++;
      } catch {
        continue; // 读不了的文件跳过
      }
    }
  };

  walk(rootDir);
  return parts;
}

function buildResult(parts: string[], budget: Budget, scopeLabel: string): string | null {
  if (parts.length === 0) { return null; }
  const head =
    `// 审查范围: ${scopeLabel}\n` +
    `// 文件数量: ${budget.files}` +
    (budget.truncated ? `（已达上限，后续文件被截断）` : '') +
    `\n\n`;
  return head + parts.join('\n\n');
}

/** 1. 当前文件 */
export async function collectFile(): Promise<string | null> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) { return null; }

  let text = ed.document.getText();
  if (text.length > MAX_SINGLE_FILE_CHARS) {
    text = text.slice(0, MAX_SINGLE_FILE_CHARS) + '\n// ...(文件过长，已截断)';
  }
  const uri = ed.document.uri;
  const fileName =
    uri.scheme === 'file'
      ? toRelativePath(workspaceRootFor(uri.fsPath), uri.fsPath)
      : uri.toString();
  return `// 文件: ${fileName}\n${text}`;
}

/** 2. 当前包：当前文件所在目录（递归子目录）；没有打开文件时用工作区根目录 */
export async function collectCurrentPackage(dirOverride?: string): Promise<string | null> {
  let dir = dirOverride;

  if (!dir) {
    const ed = vscode.window.activeTextEditor;
    if (ed && ed.document.uri.scheme === 'file') {
      dir = path.dirname(ed.document.uri.fsPath);
    }
  }
  if (!dir) {
    dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
  if (!dir || !fs.existsSync(dir)) { return null; }

  const budget = newBudget();
  const parts = scanDirectory(dir, budget);
  return buildResult(parts, budget, `当前包（目录）${path.basename(dir)}`);
}

/** 3. 当前项目：整个工作区（所有 workspace 文件夹） */
export async function collectWorkspace(dirOverride?: string): Promise<string | null> {
  const roots: string[] = [];

  if (dirOverride) {
    roots.push(dirOverride);
  } else {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme === 'file') { roots.push(folder.uri.fsPath); }
    }
  }
  if (roots.length === 0) { return null; }

  const budget = newBudget();
  const parts: string[] = [];
  for (const root of roots) {
    if (budget.truncated) { break; }
    parts.push(...scanDirectory(root, budget));
  }
  return buildResult(parts, budget, `整个项目 ${roots.map((r) => path.basename(r)).join(', ')}`);
}