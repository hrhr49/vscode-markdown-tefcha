import path from 'path';
import MarkdownIt from 'markdown-it';
import opentype from 'opentype.js'

import {Renderer} from './renderer';
import {
  blueConfig,
} from './themes';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

const FONT_FILE = 'NotoSansCJKjp-Regular.otf';
const DEFAULT_FONT_PATH = path.resolve(`${__dirname}/../fonts/Noto`, FONT_FILE);

// vscode.window.showInformationMessage('start');

let font: opentype.Font | null = null;

const createTefchaTag = (src: string): string => {
  try {
    if (!font) {
      font = opentype.loadSync(DEFAULT_FONT_PATH);
    }

    const buf: Buffer = new Renderer({src, config: blueConfig, font: font}).renderSvgSync();
    const svg = buf.toString();
    return svg;
  } catch (e) {
    return `<pre><code>${e}${e}</code></pre>`;
  }
}

const tefchaPlugin = (md: MarkdownIt, _options: any) => {
  try {
    // もともとのフェンスレンダリング処理を取得(thisキーワードへの対策のためbindを使用する)
    const defautFenceFunction = md?.renderer?.rules?.fence?.bind(md.renderer.rules);

    if (!defautFenceFunction) {
      // eslint-disable-next-line no-throw-literal
      throw 'default fence rule of markdown-it is not found';
    }

    md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
      const token = tokens[idx];
      if (token.info === 'tefcha') {
        return createTefchaTag(token.content.trim())
      }

      // デフォルトの処理を行う
      return defautFenceFunction(tokens, idx, options, env, slf);
    }
  } catch (e) {
    vscode.window.showErrorMessage(String(e));
  }

}
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "vscode-markdown-tefcha" is now active!');
  // vscode.window.showInformationMessage('activated');

  return {
    extendMarkdownIt(md: MarkdownIt) {
      return md.use(tefchaPlugin);
    },
  };
}

// this method is called when your extension is deactivated
export function deactivate() {}
