/// <reference path="c:/Users/School vice Director/.vscode/extensions/nur.script-0.2.1/@types/api.global.d.ts" />
/// <reference path="c:/Users/School vice Director/.vscode/extensions/nur.script-0.2.1/@types/vscode.global.d.ts" />
//  @ts-check
//  API: https://code.visualstudio.com/api/references/vscode-api

const vscode = require('vscode');

/** @param {import('vscode').ExtensionContext} context */
function activate(context) {
   vscode.window.showInformationMessage('Hello, World!');
}

function deactivate() {}

module.exports = { activate, deactivate };
