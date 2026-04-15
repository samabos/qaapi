import * as vscode from 'vscode';

/**
 * Minimal logger for qaapi. Writes to a dedicated VSCode Output channel so
 * users can see what's happening via View, Output, qaapi, without having
 * to pop open the Extension Host devtools.
 */
class Logger {
  private channel: vscode.OutputChannel | undefined;

  init(): void {
    this.channel ??= vscode.window.createOutputChannel('qaapi');
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string): void {
    this.write('ERROR', message);
  }

  show(): void {
    this.channel?.show(true);
  }

  private write(level: string, message: string): void {
    const line = `[${new Date().toISOString()}] ${level} ${message}`;
    this.channel?.appendLine(line);
    // Mirror to extension host console so devs still see it during F5 debugging
    // eslint-disable-next-line no-console
    (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(`[qaapi] ${message}`);
  }
}

export const log = new Logger();
