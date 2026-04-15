import * as vscode from 'vscode';
import { QAAPIController } from './extension/QAAPIController';
import { PanelManager } from './extension/PanelManager';
import { log } from './Logger';

let controller: QAAPIController | undefined;

/** Empty tree — the sidebar view is only there to host the activity bar icon;
 *  visibility triggers the main panel so the user never sees the empty view. */
class LauncherTreeProvider implements vscode.TreeDataProvider<never> {
  getTreeItem(): vscode.TreeItem { return new vscode.TreeItem(''); }
  getChildren(): never[] { return []; }
}

export function activate(context: vscode.ExtensionContext): void {
  log.init();
  log.info('qaapi extension activated');
  controller = new QAAPIController(context);
  const panelManager = new PanelManager(context, controller);

  const launcherView = vscode.window.createTreeView('qaapi.launcher', {
    treeDataProvider: new LauncherTreeProvider(),
  });

  // Auto-open the panel the FIRST time the user opens the sidebar view in
  // this session. After that, closing the panel keeps it closed — they can
  // reopen via the welcome link in the sidebar or the command palette.
  let autoOpened = false;

  context.subscriptions.push(
    vscode.commands.registerCommand('qaapi.openPanel', () => {
      panelManager.show();
    }),
    vscode.commands.registerCommand('qaapi.generateTests', () => {
      controller?.generateTests();
    }),
    vscode.commands.registerCommand('qaapi.runTests', () => {
      controller?.runTests();
    }),
    launcherView,
    launcherView.onDidChangeVisibility(e => {
      if (e.visible && !autoOpened) {
        autoOpened = true;
        panelManager.show();
      }
    }),
  );
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
  log.dispose();
}
