'use strict';

/**
 * Validates adapter responses against Pluga's official OpenAPI file (test/spec/pluga-developers.yml)
 * plus the rules Pluga only states in prose. Relaxation: the YAML combines field shapes with
 * `oneOf`, but its shapes overlap (a dropdown field also matches defaultField), so `oneOf` is
 * checked as `anyOf` and the field kind is checked separately in `checkFieldRules`.
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

const spec = YAML.parse(fs.readFileSync(path.join(__dirname, 'spec/pluga-developers.yml'), 'utf8'));

function deref(node, seen = new Set()) {
  if (Array.isArray(node)) return node.map((n) => deref(n, seen));
  if (!node || typeof node !== 'object') return node;
  if (node.$ref) {
    const target = node.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], spec);
    return deref(target, seen);
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k === 'oneOf' ? 'anyOf' : k] = deref(v, seen);
  return out;
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

function operationFor(method, specPath) {
  const op = spec.paths[specPath] && spec.paths[specPath][method.toLowerCase()];
  if (!op) throw new Error(`No operation ${method} ${specPath} in Pluga spec`);
  return op;
}

/** Throws with the Ajv errors when `body` does not match the documented response. */
function validateResponse(method, specPath, status, body) {
  const op = operationFor(method, specPath);
  const response = deref(op.responses[String(status)]);
  if (!response) throw new Error(`Status ${status} is not documented for ${method} ${specPath}`);
  const schema = response.content && response.content['application/json'] && response.content['application/json'].schema;
  if (!schema) return true;
  const validate = ajv.compile(schema);
  if (!validate(body)) {
    throw new Error(`${method} ${specPath} ${status} does not match Pluga spec: ${ajv.errorsText(validate.errors)}`);
  }
  return true;
}

const FIELD_TYPES = ['integer', 'decimal', 'string', 'datetime', 'textarea', 'dropdown', 'dropdown_multiple'];

/** Prose rules from the spec descriptions. */
function checkFieldRules(fields, { config = false } = {}) {
  for (const f of fields) {
    if (!f.key || !f.name || !f.name.pt_BR || !f.name.en) throw new Error(`Field without key/localized name: ${JSON.stringify(f)}`);
    if (config) {
      if (f.type && !['dropdown', 'dropdown_multiple'].includes(f.type)) throw new Error(`Config field ${f.key} must be a dropdown`);
      if (!f.options && !f.helper_id) throw new Error(`Config field ${f.key} needs options or helper_id`);
    } else if (!FIELD_TYPES.includes(f.type)) {
      throw new Error(`Field ${f.key} has unsupported type ${f.type}`);
    }
    if (f.type && f.type.startsWith('dropdown') && !f.options && !f.helper_id) throw new Error(`Dropdown ${f.key} needs options or helper_id`);
    if (f.options) for (const o of f.options) if (!o.label || !o.label.pt_BR || !o.label.en || typeof o.value !== 'string') throw new Error(`Bad option in ${f.key}`);
    if (typeof f.required !== 'boolean') throw new Error(`Field ${f.key} must say if it is required`);
  }
}

module.exports = { spec, validateResponse, checkFieldRules, FIELD_TYPES };
