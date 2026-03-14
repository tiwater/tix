#!/usr/bin/env node
/**
 * Browser Automation Skill using Playwright.
 * A lightweight version of OpenClaw's browser tool.
 */

import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const options = {
  action: { type: 'string', default: 'snapshot' },
  url: { type: 'string' },
  path: { type: 'string' },
  selector: { type: 'string' },
  width: { type: 'string', default: '1280' },
  height: { type: 'string', default: '800' },
};

const { values } = parseArgs({ options, strict: false });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: parseInt(values.width), height: parseInt(values.height) },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    if (!values.url) throw new Error('URL is required');

    await page.goto(values.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    switch (values.action) {
      case 'screenshot':
        const outputPath = values.path || 'screenshot.png';
        await page.screenshot({ path: outputPath, fullPage: true });
        console.log(`Screenshot saved to: ${outputPath}`);
        break;

      case 'snapshot':
        // Get generic visibility text (simplified markdown-like)
        const text = await page.evaluate(() => document.body.innerText);
        console.log(text);
        break;

      case 'click':
        if (!values.selector) throw new Error('Selector required for click');
        await page.click(values.selector);
        console.log(`Clicked: ${values.selector}`);
        break;

      default:
        console.log('Action not supported');
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
