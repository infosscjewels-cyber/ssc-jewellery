import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, '..');
const outputDir = path.join(clientRoot, 'src', 'generated');
const outputFile = path.join(outputDir, 'buildInfo.js');

const formatBuildVersion = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);
    const get = (type) => parts.find((entry) => entry.type === type)?.value || '';
    return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
};

const formatBuildLabel = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).formatToParts(date);
    const get = (type) => parts.find((entry) => entry.type === type)?.value || '';
    return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()} IST`;
};

const now = new Date();
const buildVersion = process.env.BUILD_VERSION || formatBuildVersion(now);
const buildLabel = process.env.BUILD_LABEL || formatBuildLabel(now);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
    outputFile,
    `export const BUILD_VERSION = ${JSON.stringify(buildVersion)};\nexport const BUILD_LABEL = ${JSON.stringify(buildLabel)};\n`,
    'utf8'
);

console.log(`Build info generated: ${buildVersion}`);
