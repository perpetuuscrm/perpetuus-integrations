#!/usr/bin/env node
// Offline check of this plugin against the "Submission checklist" in
// https://cursor.com/docs/reference/plugins (read 2026-11-22). Run: node scripts/validate.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); else console.log('ok  ', msg); };
const KEBAB = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const manifestPath = join(root, '.cursor-plugin/plugin.json');
ok(existsSync(manifestPath), '.cursor-plugin/plugin.json exists');
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
ok(typeof m.name === 'string' && KEBAB.test(m.name), `name "${m.name}" is lowercase kebab-case`);
ok(typeof m.description === 'string' && m.description.length >= 40, 'description explains the purpose');
ok(/^\d+\.\d+\.\d+$/.test(m.version ?? ''), 'version is semver');
ok(m.author && typeof m.author.name === 'string', 'author.name present');
for (const key of ['logo', 'rules', 'agents', 'skills', 'commands', 'hooks', 'mcpServers']) {
  const v = m[key];
  for (const p of (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])) {
    if (/^https?:\/\//.test(p)) continue;
    ok(!isAbsolute(p) && !p.split('/').includes('..'), `${key} path "${p}" is relative without ".."`);
    ok(existsSync(join(root, p)), `${key} path "${p}" exists`);
  }
}
if (m.logo && !/^https?:/.test(m.logo)) {
  const b = readFileSync(join(root, m.logo));
  ok(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'logo is a PNG');
}

const mcp = JSON.parse(readFileSync(join(root, 'mcp.json'), 'utf8'));
const servers = Object.entries(mcp.mcpServers ?? {});
ok(servers.length > 0, 'mcp.json declares at least one server');
const raw = readFileSync(join(root, 'mcp.json'), 'utf8');
const vars = [...raw.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((x) => x[1]);
for (const v of vars) ok(m.variables?.properties?.[v], `variable ${v} declared in manifest`);
ok(!/ppt_|whsec_|Bearer [A-Za-z0-9]/.test(raw), 'mcp.json holds no secret');
for (const [name, s] of servers) ok(/^https:\/\//.test(s.url ?? ''), `server "${name}" uses an https URL`);

const fm = (file) => {
  const t = readFileSync(file, 'utf8');
  const mm = t.match(/^---\n([\s\S]*?)\n---\n/);
  if (!mm) return null;
  const out = {};
  for (const line of mm[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
};
const skillsDir = join(root, 'skills');
for (const d of readdirSync(skillsDir)) {
  if (!statSync(join(skillsDir, d)).isDirectory()) continue;
  const f = join(skillsDir, d, 'SKILL.md');
  ok(existsSync(f), `skills/${d}/SKILL.md exists`);
  const meta = fm(f);
  ok(meta && KEBAB.test(meta.name ?? '') && meta.name === d, `skills/${d} frontmatter name is kebab-case and matches the folder`);
  ok(meta && (meta.description ?? '').length > 30, `skills/${d} frontmatter has a description`);
  ok(!/\bdeals?\b/i.test(readFileSync(f, 'utf8').replace(/"deals"/g, '')), `skills/${d} uses Board/Phase/Card vocabulary`);
}

ok(existsSync(join(root, 'README.md')), 'README.md exists');
const mp = join(repo, '.cursor-plugin/marketplace.json');
if (existsSync(mp)) {
  const j = JSON.parse(readFileSync(mp, 'utf8'));
  const names = j.plugins.map((p) => p.name);
  ok(KEBAB.test(j.name) && j.owner?.name, 'marketplace.json has name and owner.name');
  ok(new Set(names).size === names.length, 'marketplace plugin names are unique');
  const entry = j.plugins.find((p) => p.name === m.name);
  ok(entry && existsSync(join(repo, entry.source, '.cursor-plugin/plugin.json')), 'marketplace entry points at this plugin');
}

if (errors.length) { console.error('\nFAILED:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\nAll checks passed.');
