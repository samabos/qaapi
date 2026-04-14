import * as vscode from 'vscode';
import { QAAPIController } from './extension/QAAPIController';
import { PanelManager } from './extension/PanelManager';

let controller: QAAPIController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  controller = new QAAPIController(context);
  const panelManager = new PanelManager(context, controller);

  context.subscriptions.push(
    vscode.commands.registerCommand('qaapi.openPanel', () => {
      panelManager.show();
    }),
    vscode.commands.registerCommand('qaapi.generateTests', () => {
      controller?.generateTests();
    }),
    vscode.commands.registerCommand('qaapi.runTests', () => {
      controller?.runTests();
    })
  );
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
