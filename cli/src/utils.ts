import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import yaml from 'yaml';

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const HOME_DIR = process.env.HOME || os.homedir();
export const TIX_HOME = path.join(HOME_DIR, 'tix');
export const CONFIG_PATH = path.join(TIX_HOME, 'config.yaml');

/**
 * Prompts the user for input via the command line.
 */
export function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Reads and parses the Tix configuration file.
 */
export function readConfig(): any {
  try {
    return yaml.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) || {};
} catch {
    return {};
  }
}

export const TIX_LOGO = `
 _________    ___      ___    ___ 
|\\___   ___\\ |\\  \\    |\\  \\  /  /|
\\|___ \\  \\_| \\ \\  \\   \\ \\  \\/  / /
     \\ \\  \\   \\ \\  \\   \\ \\    / / 
      \\ \\  \\   \\ \\  \\   /     \\/  
       \\ \\__\\   \\ \\__\\ /  /\\   \\  
        \\|__|    \\|__|/__/ /\\ __\\ 
                      |__|/ \\|__| 
`;
