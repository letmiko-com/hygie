// Shared readers for Apple Health exports: line streaming of export.xml
// straight out of export.zip (never extracted), attribute and entity parsing,
// the export's timestamp format, and file access for the side files of the
// archive (GPX routes, ECG CSVs). Used by import-xml.mjs and import-series.mjs.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
    if (ENTITIES[m] !== undefined) return ENTITIES[m];
    return String.fromCodePoint(m[2] === 'x' || m[2] === 'X' ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10));
  });
}

export function attr(line, name) {
  const probe = ` ${name}="`;
  const i = line.indexOf(probe);
  if (i < 0) return null;
  const start = i + probe.length;
  const end = line.indexOf('"', start);
  return end < 0 ? null : line.slice(start, end);
}

// "2024-01-15 07:30:00 +0200" -> minutes; null when unparsable.
export function tzOffsetMin(date) {
  if (!date || date.length < 5) return null;
  const off = date.slice(-5);
  const sign = off[0] === '-' ? -1 : off[0] === '+' ? 1 : null;
  if (sign === null) return null;
  const h = Number(off.slice(1, 3));
  const m = Number(off.slice(3, 5));
  return Number.isFinite(h) && Number.isFinite(m) ? sign * (h * 60 + m) : null;
}

export function parseTs(date) {
  // "YYYY-MM-DD HH:MM:SS ±HHMM" (same string Postgres accepts as timestamptz input)
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/.exec(date ?? '');
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}`) : NaN;
}

// U+00A0 -> space, control whitespace -> space, trim (same rule as the HAE adapter).
export const normSource = (name) => decodeEntities(name).replace(/ /g, ' ').replace(/[\t\n\r]/g, ' ').trim();

export async function* lines(stream) {
  let rest = '';
  for await (const chunk of stream) {
    const data = rest + chunk;
    let start = 0;
    let i;
    while ((i = data.indexOf('\n', start)) >= 0) {
      yield data.slice(start, i);
      start = i + 1;
    }
    rest = data.slice(start);
  }
  if (rest) yield rest;
}

export function openXmlStream(path) {
  if (!path.endsWith('.zip')) {
    const s = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
    return { stream: s, wait: new Promise((res, rej) => { s.on('end', res); s.on('error', rej); }) };
  }
  // Apple's zip contains apple_health_export/export.xml; stream it without extracting.
  const child = spawn('unzip', ['-p', path, '*export.xml'], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  const wait = new Promise((res, rej) => {
    child.on('error', (e) => rej(e.code === 'ENOENT' ? new Error('unzip binary not found; extract the archive manually') : e));
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`unzip exited with code ${code}`))));
  });
  return { stream: child.stdout, wait };
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path, { highWaterMark: 1 << 20 })
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest()))
      .on('error', reject);
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

/**
 * The side files of an export (workout-routes/*.gpx, electrocardiograms/*.csv),
 * whether the input is the zip or an export.xml sitting next to those folders.
 * `list(folder)` returns archive-relative paths, `read(path)` the file's text.
 */
export async function exportFiles(input) {
  if (input.endsWith('.zip')) {
    const listing = (await run('unzip', ['-Z1', input])).toString('utf8').split('\n').filter(Boolean);
    return {
      list: (folder) => listing.filter((p) => p.includes(`/${folder}/`) && !p.endsWith('/')),
      read: async (path) => (await run('unzip', ['-p', input, path])).toString('utf8'),
      resolve: (ref) => listing.find((p) => p.endsWith(ref.replace(/^\//, ''))) ?? null,
    };
  }
  const base = dirname(input);
  return {
    list: async (folder) => {
      const dir = join(base, folder);
      try {
        if (!(await stat(dir)).isDirectory()) return [];
      } catch {
        return [];
      }
      return (await readdir(dir)).map((f) => join(dir, f));
    },
    read: (path) => readFile(path, 'utf8'),
    resolve: (ref) => join(base, ref.replace(/^\//, '')),
  };
}
