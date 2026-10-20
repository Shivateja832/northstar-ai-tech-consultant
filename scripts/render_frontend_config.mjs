import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const names = {
  knowledge: 'KNOWLEDGE_API_URL',
  inbox: 'INBOX_API_URL',
  meeting: 'MEETING_API_URL',
};

const api = Object.fromEntries(
  Object.entries(names).map(([service, variable]) => {
    const value = process.env[variable]?.trim();
    if (!value) throw new Error(`${variable} must be set to the deployed HTTPS service URL.`);
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error(`${variable} must use HTTPS.`);
    return [service, url.origin];
  }),
);

const output = `window.APP_CONFIG = ${JSON.stringify({ hosted: true, api })};\n`;
const defaultOutput = resolve(dirname(fileURLToPath(import.meta.url)), '../services/frontend/config.js');
await writeFile(process.env.FRONTEND_CONFIG_OUTPUT || defaultOutput, output, 'utf8');
console.log('Generated hosted frontend API configuration.');
