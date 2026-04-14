import * as vscode from 'vscode';
import {
  SourceContext,
  RoleGuard,
  ValidationRule,
  ErrorCondition,
  DtoDefinition,
  RoleEnum,
} from '../types';

const SOURCE_CAP = 60_000;

export class SourceParser {
  /**
   * Parse all source files under the given paths and return extracted business
   * logic context. Total extracted text is capped at SOURCE_CAP characters.
   */
  async parse(workspaceRoot: vscode.Uri, sourcePaths: string[]): Promise<SourceContext> {
    const ctx: SourceContext = {
      roleGuards: [],
      validationRules: [],
      errorConditions: [],
      dtoDefinitions: [],
      roleEnums: [],
    };

    const files = await this.collectFiles(workspaceRoot, sourcePaths);

    for (const file of files) {
      const content = await this.readFile(file);
      if (!content) continue;

      const relativePath = vscode.workspace.asRelativePath(file);
      this.extractRoleGuards(content, relativePath, ctx.roleGuards);
      this.extractValidationRules(content, relativePath, ctx.validationRules);
      this.extractErrorConditions(content, relativePath, ctx.errorConditions);
      this.extractDtoDefinitions(content, relativePath, ctx.dtoDefinitions);
      this.extractRoleEnums(content, relativePath, ctx.roleEnums);
    }

    return ctx;
  }

  /**
   * Return raw source code text for all files under sourcePaths, capped at
   * SOURCE_CAP characters. Used as context for the AI generator.
   */
  async getRawContext(workspaceRoot: vscode.Uri, sourcePaths: string[]): Promise<string> {
    const files = await this.collectFiles(workspaceRoot, sourcePaths);
    let total = '';
    for (const file of files) {
      if (total.length >= SOURCE_CAP) break;
      const content = await this.readFile(file);
      if (!content) continue;
      const relativePath = vscode.workspace.asRelativePath(file);
      const block = `\n// --- ${relativePath} ---\n${content}\n`;
      total += block;
    }
    return total.slice(0, SOURCE_CAP);
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

  private extractRoleGuards(content: string, filePath: string, out: RoleGuard[]): void {
    const re = /@(?:Roles|RequireRoles)\(\s*([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const roles = m[1]
        .split(',')
        .map(r => r.trim().replace(/['"]/g, ''))
        .filter(Boolean);
      const line = content.slice(0, m.index).split('\n').length;
      out.push({ filePath, line, roles });
    }
  }

  private extractValidationRules(content: string, filePath: string, out: ValidationRule[]): void {
    const re = /@(IsEmail|MinLength|MaxLength|IsEnum|IsNotEmpty|IsString|IsNumber|IsOptional|IsInt|IsBoolean|IsArray|IsUrl|IsDate|Matches|Min|Max)\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split('\n').length;
      // Try to find the field name on the next line
      const afterDecorator = content.slice(m.index + m[0].length);
      const fieldMatch = afterDecorator.match(/\s+(\w+)\s*[?:]/);
      out.push({
        filePath,
        line,
        field: fieldMatch?.[1] ?? 'unknown',
        decorator: m[1],
        params: m[2] || undefined,
      });
    }
  }

  private extractErrorConditions(content: string, filePath: string, out: ErrorCondition[]): void {
    const re = /throw\s+new\s+(ForbiddenException|NotFoundException|BadRequestException|UnauthorizedException|ConflictException)\(\s*['"`]?([^'"`)\n]*)['"`]?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split('\n').length;
      out.push({
        filePath,
        line,
        exceptionType: m[1],
        message: m[2] || undefined,
      });
    }
  }

  private extractDtoDefinitions(content: string, filePath: string, out: DtoDefinition[]): void {
    const re = /class\s+(\w*(?:Dto|Input|Body))\s*\{([^}]*)\}/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const fields = m[2]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('//') && !l.startsWith('@') && l.includes(':'))
        .map(l => l.split(':')[0].replace(/[?!]/g, '').trim())
        .filter(Boolean);
      out.push({ filePath, className: m[1], fields });
    }
  }

  private extractRoleEnums(content: string, filePath: string, out: RoleEnum[]): void {
    const re = /enum\s+(\w*Role\w*)\s*\{([^}]*)\}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const values = m[2]
        .split(',')
        .map(v => v.trim().split('=')[0].trim())
        .filter(Boolean);
      out.push({ filePath, name: m[1], values });
    }

    // Also match: const Roles = { ... } style
    const constRe = /(?:const|let)\s+(\w*Role\w*)\s*=\s*\{([^}]*)\}/gi;
    while ((m = constRe.exec(content)) !== null) {
      const values = m[2]
        .split(',')
        .map(v => v.trim().split(':')[0].trim())
        .filter(Boolean);
      out.push({ filePath, name: m[1], values });
    }
  }
}
