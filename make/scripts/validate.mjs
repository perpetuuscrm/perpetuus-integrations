#!/usr/bin/env node
// Local validation of the Perpetuus CRM custom app for Make (make/app).
//
// IML only runs inside Make, so this script checks what can be checked offline:
//   1. makecomapp.json and every code file parse, every listed file exists and no file is orphaned;
//   2. component IDs, connection/RPC/group references and the module type rules of the Make
//      app review (limit, pagination, epoch, trigger order, universal module, sanitization, errors);
//   3. input and output field names match docs/v1-contract.md (interface = output = samples);
//   4. IML expressions are balanced and only read declared parameters;
//   5. no secrets in make/;
//   6. with Ajv 8 installed (npm ci in make/), every file against Make's official editor schemas
//      (make/schemas, copied from integromat/vscode-apps-sdk).
//
// Usage: node scripts/validate.mjs [--require-schemas] [--quiet]
// Exit code: 0 = ok, 1 = problems found, 2 = could not run.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAKE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(MAKE_DIR, 'app');
const SCHEMA_DIR = join(MAKE_DIR, 'schemas');
const CONTRACT = join(MAKE_DIR, '..', 'docs', 'v1-contract.md');
const args = new Set(process.argv.slice(2));

const errors = [];
const notes = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Removes // and block comments outside strings (IMLJSON files may be JSONC). */
function stripComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[i + 1] ?? ''; i += 1; } else if (ch === '"') inString = false;
    } else if (ch === '"') { inString = true; out += ch; }
    else if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; }
    else if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 1; }
    else out += ch;
  }
  return out;
}

const parsed = new Map();
function readJson(rel) {
  if (parsed.has(rel)) return parsed.get(rel);
  const file = join(APP_DIR, rel);
  let value;
  try {
    value = JSON.parse(stripComments(readFileSync(file, 'utf8')));
  } catch (error) {
    fail(rel, `invalid JSON (${error.message})`);
    value = undefined;
  }
  parsed.set(rel, value);
  return value;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const kebab = (id) => id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const strings = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, out));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) { out.push(key); strings(entry, out); }
  }
  return out;
};
const names = (params) => (Array.isArray(params) ? params.filter((p) => p && typeof p === 'object').map((p) => p.name) : []);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const diff = (a, b) => a.filter((x) => !b.includes(x));

/** Parameter names declared at any depth (nested options, collection specs). */
function allParamNames(params, out = new Set()) {
  if (!Array.isArray(params)) return out;
  for (const p of params) {
    if (!p || typeof p !== 'object') continue;
    if (p.name) out.add(p.name);
    if (p.options && typeof p.options === 'object' && Array.isArray(p.options.nested)) allParamNames(p.options.nested, out);
    if (Array.isArray(p.nested)) allParamNames(p.nested, out);
  }
  return out;
}

/** RPC URLs referenced anywhere in a parameter tree. */
const rpcRefs = (value) => [...new Set(strings(value).flatMap((s) => [...s.matchAll(/rpc:\/\/([A-Za-z0-9]+)/g)].map((m) => m[1])))];

/** Checks that each {{ … }} expression is closed and has balanced quotes and brackets. */
function checkIml(where, value) {
  for (const text of strings(value)) {
    const opens = (text.match(/\{\{/g) || []).length;
    const closes = (text.match(/\}\}/g) || []).length;
    if (opens !== closes) { fail(where, `unbalanced {{ }} in "${text.slice(0, 80)}"`); continue; }
    for (const [, expr] of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const stack = [];
      let quote = null;
      let regex = false;
      for (let i = 0; i < expr.length; i += 1) {
        const ch = expr[i];
        if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue; }
        if (regex) { if (ch === '\\') i += 1; else if (ch === '/') regex = false; continue; }
        if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if (ch === '/' && /[(,]\s*$/.test(expr.slice(0, i))) regex = true;
        else if ('([{'.includes(ch)) stack.push(ch);
        else if (')]}'.includes(ch)) {
          const open = stack.pop();
          if (!open || '([{'.indexOf(open) !== ')]}'.indexOf(ch)) { fail(where, `unbalanced brackets in {{${expr.slice(0, 80)}}}`); break; }
        }
      }
      if (quote || regex) fail(where, `unclosed quote in {{${expr.slice(0, 80)}}}`);
      else if (stack.length) fail(where, `unclosed bracket in {{${expr.slice(0, 80)}}}`);
    }
  }
}

/** `parameters.x` read by IML in a value. */
const paramReads = (value) => [...new Set(strings(value).flatMap((s) => [...s.matchAll(/\bparameters\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])))];

// ─── Contract (docs/v1-contract.md) ──────────────────────────────────────────

const contractText = readFileSync(CONTRACT, 'utf8');
function section(num) {
  const start = contractText.search(new RegExp(`^#{2,3} ${num.replace('.', '\\.')}[ .]`, 'm'));
  if (start === -1) throw new Error(`Section ${num} not found in docs/v1-contract.md`);
  const rest = contractText.slice(start + 4);
  const end = rest.search(/^#{2,3} /m);
  return end === -1 ? rest : rest.slice(0, end);
}
/** First-column keys of the field tables of a section (rows like "| `email` | …"). */
const tableKeys = (num) => [...section(num).matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((m) => m[1]);
/** Identifiers in backticks on the "| Entrada |" row of a section. */
function entradaKeys(num, ignore = []) {
  const row = section(num).split('\n').find((line) => line.startsWith('| Entrada |'));
  if (!row) throw new Error(`No "Entrada" row in section ${num}`);
  return [...new Set([...row.matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1]))].filter((k) => !ignore.includes(k));
}

const OUT = {
  contact: tableKeys('4.1'),
  card: tableKeys('4.2'),
  task: tableKeys('4.3'),
  event: tableKeys('4.4'),
  upsert: ['created', 'matchedBy', 'otherMatchIds'],
};
for (const key of OUT.upsert) {
  if (!section('4.1').includes(`\`${key}\``)) fail('docs/v1-contract.md', `§4.1 does not define \`${key}\``);
}
for (const [kind, keys] of Object.entries(OUT)) {
  if (!keys.length) fail('docs/v1-contract.md', `no output fields parsed for ${kind}`);
}

// Values of select inputs and n8n-only inputs that appear in backticks on the Entrada rows.
const IGNORE_7 = ['email', 'phone', 'text', 'returnAll'];
const OPS = {
  watchNewCards: { op: 'newCard', type: 'trigger', inputs: entradaKeys('5.2'), output: [...OUT.card, ...OUT.event], makeOnly: ['limit'] },
  watchCardsEnteredPhase: { op: 'cardEnteredPhase', type: 'trigger', inputs: entradaKeys('5.3'), output: [...OUT.card, ...OUT.event], makeOnly: ['limit'] },
  watchNewContacts: { op: 'newContact', type: 'trigger', inputs: [], output: [...OUT.contact, ...OUT.event], makeOnly: ['limit'] },
  watchCompletedTasks: { op: 'taskCompleted', type: 'trigger', inputs: entradaKeys('5.5'), output: [...OUT.task, ...OUT.event], makeOnly: ['limit'] },
  upsertContact: { op: 'upsertContact', type: 'action', inputs: tableKeys('6.1'), output: [...OUT.contact, ...OUT.upsert] },
  createCard: { op: 'createCard', type: 'action', inputs: tableKeys('6.2'), output: OUT.card },
  moveCard: { op: 'moveCard', type: 'action', inputs: entradaKeys('6.3'), output: OUT.card },
  addCardTags: { op: 'addCardTags', type: 'action', inputs: entradaKeys('6.4'), output: OUT.card },
  createTask: { op: 'createTask', type: 'action', inputs: tableKeys('6.5'), output: OUT.task },
  searchContacts: { op: 'findContact', type: 'search', inputs: entradaKeys('7.1', IGNORE_7), output: OUT.contact },
  searchCards: { op: 'findCard', type: 'search', inputs: entradaKeys('7.2', IGNORE_7), output: OUT.card },
};
if (OPS.watchNewContacts.inputs.length === 0 && !/\| Entrada \| nenhuma \|/.test(section('5.4'))) {
  fail('docs/v1-contract.md', '§5.4 New Contact is expected to have no input');
}

// ─── makecomapp.json ─────────────────────────────────────────────────────────

const ID_RULES = {
  module: /^[a-zA-Z][0-9a-zA-Z]{2,47}$/,
  rpc: /^[a-zA-Z][0-9a-zA-Z]{2,47}$/,
  function: /^[a-zA-Z][0-9a-zA-Z]{1,94}[0-9a-zA-Z]$/,
  connection: /^[a-zA-Z][0-9a-zA-Z-]{1,33}[0-9a-zA-Z]$/,
  webhook: /^[a-zA-Z][0-9a-zA-Z-]{1,33}[0-9a-zA-Z]$/,
};
const JS_RESERVED = new Set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield let static enum await implements package protected interface private public null true false'.split(' '));
const CODE_SUFFIX = {
  communication: 'communication', params: 'params', common: 'common', epoch: 'epoch',
  staticParams: 'static-params', mappableParams: 'mappable-params', interface: 'interface', samples: 'samples', scope: 'scope',
};

if (!existsSync(join(APP_DIR, 'makecomapp.json'))) {
  console.error('make/app/makecomapp.json not found');
  process.exit(2);
}
const app = readJson('makecomapp.json');
if (!app) { console.error(errors.join('\n')); process.exit(1); }

const listed = new Set(['makecomapp.json']);
function listFile(where, rel, expectedSuffix) {
  if (rel === null) return;
  if (typeof rel !== 'string') { fail(where, 'code file path must be a string or null'); return; }
  listed.add(rel);
  if (!existsSync(join(APP_DIR, rel))) { fail(where, `listed file ${rel} does not exist`); return; }
  if (expectedSuffix && !new RegExp(`\\.${expectedSuffix}\\.(iml\\.jsonc?|json)$`).test(rel)) {
    fail(where, `${rel} does not follow the <component>.${expectedSuffix}.iml.json naming of the Make Apps Editor`);
  }
  if (/\.(json|jsonc)$/.test(rel)) readJson(rel);
}

for (const [code, rel] of Object.entries(app.generalCodeFiles ?? {})) listFile(`general.${code}`, rel);
if (app.generalCodeFiles?.common !== null) notes.push('general common data is included; keep secrets out of it');

const components = app.components ?? {};
for (const type of ['connection', 'module', 'rpc', 'function', 'webhook', 'endpoint']) {
  if (!components[type] || typeof components[type] !== 'object') fail('makecomapp.json', `components.${type} missing`);
}
for (const [type, entries] of Object.entries(components)) {
  for (const [id, meta] of Object.entries(entries ?? {})) {
    const where = `${type} ${id}`;
    if (ID_RULES[type] && !ID_RULES[type].test(id)) fail(where, `invalid component ID for Make (${ID_RULES[type]})`);
    if (JS_RESERVED.has(id)) fail(where, 'component ID is a JavaScript reserved word');
    if (!meta) { fail(where, 'component is reserved (null) but not implemented'); continue; }
    for (const [code, rel] of Object.entries(meta.codeFiles ?? {})) {
      if (rel !== null && !rel.startsWith(`${type}s/${kebab(id)}/${kebab(id)}.`)) fail(where, `${rel} should live in ${type}s/${kebab(id)}/`);
      listFile(where, rel, CODE_SUFFIX[code]);
    }
    if (type !== 'connection' && meta.connection && !components.connection?.[meta.connection]) {
      fail(where, `connection "${meta.connection}" is not defined`);
    }
  }
}
for (const origin of app.origins ?? []) {
  if ('apikey' in origin) fail('makecomapp.json', 'an origin contains an inline apikey; use apikeyFile under .secrets/');
}

const onDisk = walk(APP_DIR).map((file) => relative(APP_DIR, file).split(sep).join('/'));
for (const rel of onDisk) if (!listed.has(rel)) fail(rel, 'file is not referenced by makecomapp.json (orphan)');

// ─── Base and connection ─────────────────────────────────────────────────────

const base = readJson(app.generalCodeFiles.base) ?? {};
const sanitizes = (api) => (api?.log?.sanitize ?? []).map((s) => s.toLowerCase());
if (!sanitizes(base).includes('request.headers.authorization')) fail('base', 'log.sanitize must hide request.headers.authorization');
if (!/Bearer \{\{connection\.apiKey\}\}/.test(base.headers?.Authorization ?? '')) fail('base', 'Authorization header must be "Bearer {{connection.apiKey}}"');
if (!/^\{\{ifempty\(connection\.baseUrl, 'https:\/\/api\.perpetuus\.com\.br\/api'\)\}\}$/.test(base.baseUrl ?? '')) {
  fail('base', 'baseUrl must come from the connection with the production default');
}
const baseError = base.response?.error ?? {};
if (baseError.type) fail('base', 'a top-level response.error.type would replace the 429 and 5xx defaults');
for (const code of ['400', '401', '402', '403', '404', '429']) {
  if (!baseError[code]?.message) fail('base', `response.error.${code}.message missing`);
}
if (baseError['429'] && baseError['429'].type && baseError['429'].type !== 'RateLimitError') fail('base', '429 must stay a RateLimitError');
const contract33 = section('3.3');
const canonical = {
  401: 'Invalid or expired Perpetuus API key.',
  402: 'Your Perpetuus plan contact limit was reached:',
  403: 'is missing the "',
  404: 'Not found in Perpetuus:',
  429: 'Perpetuus rate limit reached (120 requests/min per key). Try again in',
  400: 'Perpetuus rejected the request:',
};
for (const [code, text] of Object.entries(canonical)) {
  if (!contract33.includes(text)) fail('docs/v1-contract.md', `§3.3 no longer contains "${text}"`);
  if (!(baseError[code]?.message ?? '').includes(text)) fail('base', `error ${code} must use the contract message ("${text}")`);
}
if (!(baseError.message ?? '').includes('Perpetuus server error (HTTP')) fail('base', 'generic error message must cover 5xx with the contract text');
checkIml('base', base);

const connections = Object.entries(components.connection ?? {});
if (connections.length !== 1) fail('makecomapp.json', 'exactly one connection is expected');
const connectionParamNames = new Set();
for (const [id, meta] of connections) {
  const comm = readJson(meta.codeFiles.communication) ?? {};
  const params = readJson(meta.codeFiles.params) ?? [];
  names(params).forEach((n) => connectionParamNames.add(n));
  const where = `connection ${id}`;
  if (meta.connectionType !== 'basic') fail(where, 'connectionType must be basic (API key)');
  const apiKey = params.find((p) => p.name === 'apiKey');
  if (!apiKey || apiKey.type !== 'password' || !apiKey.required) fail(where, 'apiKey must be a required password parameter');
  const baseUrl = params.find((p) => p.name === 'baseUrl');
  if (!baseUrl || baseUrl.required || baseUrl.default !== 'https://api.perpetuus.com.br/api') fail(where, 'baseUrl must be optional with the production default');
  if (!/\/auth\/token-info$/.test(comm.url ?? '')) fail(where, 'connection must be validated on /auth/token-info');
  if (!sanitizes(comm).includes('request.headers.authorization')) fail(where, 'log.sanitize must hide request.headers.authorization');
  if (!comm.response?.error?.message) fail(where, 'response.error.message missing');
  const label = comm.response?.metadata?.value ?? '';
  if (!label.includes('organization.name') || !label.includes('user.email')) fail(where, 'metadata must show the organization and the email');
  for (const read of paramReads(comm)) if (!connectionParamNames.has(read)) fail(where, `reads undeclared parameters.${read}`);
  checkIml(where, comm);
}
for (const read of strings(base).flatMap((s) => [...s.matchAll(/\bconnection\.([A-Za-z_]\w*)/g)].map((m) => m[1]))) {
  if (!connectionParamNames.has(read)) fail('base', `reads undeclared connection.${read}`);
}

// ─── RPCs ────────────────────────────────────────────────────────────────────

const rpcs = components.rpc ?? {};
const rpcReads = {};
for (const [id, meta] of Object.entries(rpcs)) {
  const where = `rpc ${id}`;
  const comm = readJson(meta.codeFiles.communication) ?? {};
  if (!meta.connection) fail(where, 'RPCs must use the module connection');
  rpcReads[id] = paramReads(comm);
  checkIml(where, comm);
  const response = comm.response ?? {};
  if (response.iterate && typeof response.output === 'object' && 'value' in response.output) {
    if (!response.limit) fail(where, 'option RPCs need a response.limit (review requirement)');
    if (comm.pagination === undefined && /\/(boards|contacts)$|\/cards$/.test(comm.url ?? '')) fail(where, 'paginated list RPC without pagination');
  }
}

// ─── Modules ─────────────────────────────────────────────────────────────────

const modules = components.module ?? {};
const groups = readJson(app.generalCodeFiles.groups) ?? [];
const grouped = groups.flatMap((g) => g.modules ?? []);
for (const id of grouped) if (!modules[id]) fail('groups.json', `module ${id} does not exist`);
for (const id of Object.keys(modules)) if (!grouped.includes(id)) fail('groups.json', `module ${id} is not in any group`);

const universal = Object.entries(modules).filter(([, m]) => m.moduleType === 'universal');
if (universal.length !== 1 || universal[0][1].label !== 'Make an API call') fail('modules', 'one universal module labelled "Make an API call" is required');

for (const id of Object.keys(OPS)) if (!modules[id]) fail('modules', `module ${id} (${OPS[id].op}) is missing`);

const lastRequest = (comm) => (Array.isArray(comm) ? comm[comm.length - 1] : comm);

for (const [id, meta] of Object.entries(modules)) {
  const where = `module ${id}`;
  const files = meta.codeFiles ?? {};
  const comm = readJson(files.communication);
  const staticParams = readJson(files.staticParams) ?? [];
  const mappableParams = readJson(files.mappableParams) ?? [];
  const iface = readJson(files.interface) ?? [];
  const samples = readJson(files.samples) ?? {};
  const params = [...staticParams, ...mappableParams];
  const declared = new Set([...allParamNames(staticParams), ...allParamNames(mappableParams)]);
  [comm, staticParams, mappableParams, iface].forEach((v) => checkIml(where, v));

  if (!meta.label || !meta.description) fail(where, 'label and description are required');
  else if (meta.label !== meta.label[0].toUpperCase() + meta.label.slice(1).replace(/\b(?!API\b)([A-Z])(?=[a-z])/g, (c) => c.toLowerCase())) {
    fail(where, `label "${meta.label}" must be sentence case`);
  }
  if (meta.connection !== 'perpetuus') fail(where, 'module must use the perpetuus connection');

  // Parameter reads, RPC references and RPC dependencies.
  const dynamicFields = rpcRefs(params).includes('listCardFields');
  for (const read of paramReads(comm)) {
    if (!declared.has(read)) fail(where, `communication reads undeclared parameters.${read}`);
  }
  for (const ref of rpcRefs(params)) {
    if (!rpcs[ref]) { fail(where, `references missing rpc://${ref}`); continue; }
    for (const read of rpcReads[ref]) if (!declared.has(read)) fail(where, `rpc://${ref} reads parameters.${read}, which this module does not declare`);
  }
  for (const p of params) {
    if (p.type === 'select' && typeof p.options === 'string' && ['cardId', 'contactId'].includes(p.name) && p.mode !== 'edit') {
      fail(where, `${p.name} select should open in mode "edit" so IDs can be mapped`);
    }
  }

  // Interface, output and samples.
  const ifaceNames = names(iface);
  const output = lastRequest(comm)?.response?.output;
  if (meta.moduleType !== 'universal') {
    if (!output || typeof output !== 'object') fail(where, 'response.output must project the canonical object');
    else if (!sameSet(Object.keys(output), ifaceNames)) {
      fail(where, `output keys and interface differ (output only: ${diff(Object.keys(output), ifaceNames)}; interface only: ${diff(ifaceNames, Object.keys(output))})`);
    }
  }
  if (!sameSet(Object.keys(samples), ifaceNames)) fail(where, `samples and interface differ (${diff(Object.keys(samples), ifaceNames)} / ${diff(ifaceNames, Object.keys(samples))})`);
  for (const field of iface) {
    if (/At$|^dueDate$/.test(field.name) && field.type !== 'date') fail(where, `interface ${field.name} must be type date`);
    if (field.label && field.label !== field.label[0].toUpperCase() + field.label.slice(1).replace(/\b(?!ID|IDs|CPF|CNPJ\b)([A-Z])(?=[a-z])/g, (c) => c.toLowerCase())) {
      fail(where, `interface label "${field.label}" must be sentence case`);
    }
  }

  // Module type rules.
  const requests = Array.isArray(comm) ? comm : [comm];
  const limitParam = params.find((p) => p.name === 'limit');
  if (meta.moduleType === 'trigger') {
    if (!files.epoch) fail(where, 'trigger needs an epoch (Choose where to start)');
    else if (!readJson(files.epoch)?.response?.limit) fail(where, 'epoch needs a response.limit');
    if (mappableParams.length) fail(where, 'triggers only take static parameters');
    if (!limitParam?.required) fail(where, 'trigger needs a required limit parameter');
    const trigger = comm?.response?.trigger ?? {};
    if (trigger.type !== 'date' || trigger.order !== 'desc' || !trigger.id || !trigger.date) fail(where, 'response.trigger must be { type: date, order: desc, id, date }');
    if (output && (trigger.id !== output.eventId || trigger.date !== output.eventAt)) fail(where, 'trigger.id/date must be the eventId/eventAt of the output (contract §4.4)');
    if (!/:desc$/.test(comm?.qs?.sort ?? '')) fail(where, 'trigger must request newest first (sort …:desc) to match order desc');
    if (!strings(comm?.qs ?? {}).some((s) => s.includes('data.lastDate'))) fail(where, 'trigger must filter from data.lastDate');
    if (!comm?.pagination) fail(where, 'trigger needs pagination');
    if (comm?.response?.limit !== '{{parameters.limit}}') fail(where, 'trigger response.limit must be {{parameters.limit}}');
  } else if (meta.moduleType === 'search') {
    if (!limitParam || limitParam.required || limitParam.advanced) fail(where, 'search needs an optional, non-advanced limit parameter');
    if (!comm?.pagination) fail(where, 'search needs pagination');
    if (!/parameters\.limit/.test(comm?.response?.limit ?? '')) fail(where, 'search response.limit must use parameters.limit');
  }
  for (const r of requests) {
    if (r?.response?.error && r.response.error.message !== baseError.message) {
      fail(where, 'a module response.error replaces the generic message of the base; repeat the base message');
    }
  }
  if (meta.moduleType === 'action') {
    if (requests.some((r) => r.pagination || r.response?.iterate)) fail(where, 'actions must not paginate or iterate');
    for (const r of requests.filter((x) => ['POST', 'PUT', 'PATCH'].includes(x.method))) {
      for (const code of ['500', '502', '503', '504']) {
        if (r.response?.error?.[code]?.type !== 'RuntimeError') fail(where, `${r.method} ${r.url} must turn ${code} into RuntimeError (no automatic retry, contract §3.2)`);
      }
    }
  }

  // Board-dependent dropdowns must be nested under the Board select: Make only passes the
  // selected board to RPCs of nested parameters (top-level siblings call /boards//… → 404).
  {
    const BOARD_RPCS = ['listPhases', 'listTags', 'listCards', 'listMembers', 'listCardFields'];
    const board = Array.isArray(params) ? params.find((p) => p && p.name === 'boardId') : undefined;
    for (const p of Array.isArray(params) ? params : []) {
      if (!p || typeof p !== 'object' || p === board) continue;
      const refs = rpcRefs(p.options ?? []);
      for (const ref of refs.filter((r) => BOARD_RPCS.includes(r))) {
        fail(where, `"${p.name}" uses rpc://${ref} (reads the board) but is not nested under boardId.options.nested`);
      }
    }
  }

  // Contract field names.
  const spec = OPS[id];
  if (spec) {
    if (spec.type !== meta.moduleType) fail(where, `module type must be ${spec.type}`);
    const allowed = [...spec.inputs, ...(spec.makeOnly ?? [])];
    const paramNames = [...allParamNames(params)];
    for (const n of paramNames) if (!allowed.includes(n)) fail(where, `input "${n}" is not in the contract for ${spec.op}`);
    for (const n of spec.inputs) if (!paramNames.includes(n)) fail(where, `contract input "${n}" of ${spec.op} is missing`);
    if (!sameSet(ifaceNames, spec.output)) {
      fail(where, `interface must be the contract output of ${spec.op} (missing: ${diff(spec.output, ifaceNames)}; extra: ${diff(ifaceNames, spec.output)})`);
    }
    if (dynamicFields && id !== 'createCard') fail(where, 'only Create a card loads custom fields dynamically');
  }
}

// ─── Secrets ─────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  [/ppt_[A-Za-z0-9_-]{8,}/, 'Perpetuus API key'],
  [/Bearer\s+(?!\{\{)[A-Za-z0-9._~+/-]{16,}/, 'bearer token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/"(?:api[_-]?key|apikey|secret|token|password)"\s*:\s*"[A-Za-z0-9._-]{16,}"/i, 'credential value'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/, 'API secret'],
];
for (const file of walk(MAKE_DIR)) {
  const rel = relative(MAKE_DIR, file).split(sep).join('/');
  if (rel.startsWith('schemas/') || rel === 'package-lock.json' || rel === 'scripts/validate.mjs') continue;
  if (rel.split('/').includes('.secrets')) { fail(rel, '.secrets must never be committed'); continue; }
  const text = readFileSync(file, 'utf8');
  for (const [pattern, what] of SECRET_PATTERNS) if (pattern.test(text)) fail(rel, `looks like a ${what}`);
}

// ─── Official editor schemas (optional, needs Ajv 8) ─────────────────────────

const SCHEMA_FOR = {
  communication: 'api.json', params: 'parameters.json', staticParams: 'parameters.json', mappableParams: 'parameters.json',
  interface: 'parameters.json', samples: 'samples.json', epoch: 'epoch.json', scope: 'scope.json', common: 'common.json',
};
let Ajv;
try {
  const require = createRequire(join(MAKE_DIR, 'package.json'));
  const mod = require('ajv');
  Ajv = mod.default ?? mod;
} catch {
  Ajv = undefined;
}
let schemaChecked = 0;
if (Ajv) {
  const ajv = new Ajv({ strict: false, unicodeRegExp: false, allErrors: true, validateFormats: false });
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')), file);
  }
  const check = (rel, schemaName) => {
    const data = readJson(rel);
    if (data === undefined) return;
    const validate = ajv.getSchema(schemaName);
    schemaChecked += 1;
    if (!validate(data)) {
      for (const e of validate.errors.slice(0, 5)) fail(rel, `${schemaName} ${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
    }
  };
  check('makecomapp.json', 'makecomapp.schema.json');
  check(app.generalCodeFiles.base, 'base.json');
  check(app.generalCodeFiles.groups, 'groups.json');
  for (const entries of Object.values(components)) {
    for (const meta of Object.values(entries ?? {})) {
      for (const [code, rel] of Object.entries(meta?.codeFiles ?? {})) {
        if (rel === null || !SCHEMA_FOR[code]) continue;
        const data = readJson(rel);
        // A request array is validated request by request.
        if (code === 'communication' && Array.isArray(data)) {
          const validate = ajv.getSchema('api.json');
          data.forEach((request, index) => {
            schemaChecked += 1;
            if (!validate(request)) for (const e of validate.errors.slice(0, 5)) fail(`${rel}[${index}]`, `api.json ${e.instancePath || '/'} ${e.message}`);
          });
        } else check(rel, SCHEMA_FOR[code]);
      }
    }
  }
} else if (args.has('--require-schemas')) {
  fail('schemas', 'Ajv 8 is not installed; run npm ci in make/');
} else {
  notes.push('Ajv not installed: editor schema validation skipped (run npm ci in make/ to enable it)');
}

// ─── Report ──────────────────────────────────────────────────────────────────

const counts = Object.fromEntries(Object.entries(components).map(([k, v]) => [k, Object.keys(v ?? {}).length]));
if (!args.has('--quiet')) {
  console.log(`Perpetuus CRM Make app: ${counts.module} modules, ${counts.rpc} RPCs, ${counts.connection} connection, ${listed.size} files`);
  console.log(`Contract fields checked for ${Object.keys(OPS).length} operations; editor schemas: ${Ajv ? `${schemaChecked} files/requests` : 'skipped'}`);
  for (const note of notes) console.log(`note: ${note}`);
}
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log('OK');
