import * as vscode from 'vscode';
import { SourceContext, DtoDefinition } from '../types';

export class SourceParser {
  /**
   * Walk the configured source paths and extract DTO / request-body class
   * definitions. Used by the AI features (suggest payload, expand cases) to
   * give Claude grounded field names. Regex-based  MVP, not AST.
   */
  async parse(workspaceRoot: vscode.Uri, sourcePaths: string[]): Promise<SourceContext> {
    const ctx: SourceContext = { dtoDefinitions: [] };
    const files = await this.collectFiles(workspaceRoot, sourcePaths);

    for (const file of files) {
      const content = await this.readFile(file);
      if (!content) continue;
      const relativePath = vscode.workspace.asRelativePath(file);
      this.extractDtoDefinitions(content, relativePath, ctx.dtoDefinitions);
    }

    return ctx;
  }

  /* ---- File collection ----------------------------------------- */

  private async collectFiles(root: vscode.Uri, paths: string[]): Promise<vscode.Uri[]> {
    const uris: vscode.Uri[] = [];
    for (const p of paths) {
      const dirUri = vscode.Uri.joinPath(root, p);
      await this.walkDir(dirUri, uris);
    }
    return uris;
  }

  private async walkDir(dir: vscode.Uri, acc: vscode.Uri[]): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          await this.walkDir(child, acc);
        } else if (this.isSourceFile(name)) {
          acc.push(child);
        }
      }
    } catch {
      // directory may not exist
    }
  }

  private isSourceFile(name: string): boolean {
    return /\.(ts|js|tsx|jsx)$/.test(name) && !name.endsWith('.d.ts');
  }

  private async readFile(uri: vscode.Uri): Promise<string | null> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(raw).toString('utf-8');
    } catch {
      return null;
    }
  }

  /* ---- Regex extractors ---------------------------------------- */

  private extractDtoDefinitions(content: string, filePath: string, out: DtoDefinition[]): void {
    const re = /class\s+(\w*(?:Dto|Input|Body))\s*\{([^}]*)\}/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const fields = m[2]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('//') && !l.startsWith('@') && l.includes(':'))
        .map(l => l.split(':')[0].replaceAll(/[?!]/g, '').trim())
        .filter(Boolean);
      out.push({ filePath, className: m[1], fields });
    }
  }
}
