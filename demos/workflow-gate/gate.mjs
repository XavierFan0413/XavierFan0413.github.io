/* Original synthetic workflow exercise. No model, network, or real authority. */
export const POLICY = 'gate-v1';
const fail = (reason, checks) => ({decision: 'deny', reason, checks});
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const keys = (x, names) => plain(x) && Object.keys(x).sort().join('|') === [...names].sort().join('|');
const str = (x, max = 100) => typeof x === 'string' && x.length > 0 && x.length <= max;
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw new TypeError('Only JSON values are supported');
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function requestHash(request, context) {
  return digest({request, actor: context.actor.id, policy: context.policy});
}
function inspect(request, context) {
  const checks = [];
  const passed = label => checks.push(label);
  if (!keys(request, ['id', 'tenant', 'tool', 'args']) || !str(request.id) || !str(request.tenant) || !str(request.tool)) return fail('invalid_request', checks);
  const read = request.tool === 'read_invoice';
  if (!read && request.tool !== 'send_reminder') return fail('unknown_tool', checks);
  const args = request.args;
  const fields = read ? ['invoiceId', 'version'] : ['invoiceId', 'version', 'recipient', 'message'];
  if (!keys(args, fields) || !str(args.invoiceId) || !Number.isInteger(args.version) || args.version < 1 || (!read && (!str(args.recipient, 254) || !str(args.message, 500)))) return fail('invalid_arguments', checks);
  passed('Schema and tool allowlist');
  const actor = context.actor;
  if (!actor || !str(actor.id) || !str(actor.tenant) || !Array.isArray(actor.roles) || request.tenant !== actor.tenant) return fail('tenant_mismatch', checks);
  const record = context.records.find(r => r.id === args.invoiceId && r.tenant === actor.tenant);
  if (!record) return fail('record_not_accessible', checks);
  passed('Actor and record tenant');
  if (!actor.roles.includes(read ? 'viewer' : 'billing')) return fail('role_denied', checks);
  if (args.version !== record.version) return fail('stale_record', checks);
  if (!read && args.recipient !== record.recipient) return fail('recipient_not_on_record', checks);
  if (!read && record.status !== 'overdue') return fail('record_not_overdue', checks);
  passed('Role, record version and destination');
  if (!str(context.policy) || !Number.isFinite(context.now)) return fail('invalid_context', checks);
  return {checks, read};
}
async function prepare(request, context) {
  let snapshot;
  try { canonical(request); snapshot = structuredClone(request); }
  catch { return {error:fail('invalid_request', [])}; }
  const initial = inspect(snapshot, context);
  if (initial.decision) return {error:initial};
  const binding = {actorId:context.actor.id, policy:context.policy};
  const hash = await requestHash(snapshot, context);
  return {request:snapshot, binding, hash};
}
function evaluatePrepared(prepared, context) {
  if (prepared.error) return prepared.error;
  const {request, binding, hash} = prepared;
  const current = inspect(request, context);
  if (current.decision) return current;
  const {checks, read} = current;
  const actor = context.actor;
  if (binding.actorId !== actor.id || binding.policy !== context.policy) return fail('context_changed', checks);
  const passed = label => checks.push(label);
  const prior = context.ledger.find(e => e.key === actor.tenant + ':' + request.id);
  if (prior) return prior.hash === hash ? {decision:'replay', reason:'already_executed', hash, checks, prior} : fail('idempotency_conflict', checks);
  passed('Idempotency key');
  if (read) return {decision:'allow', reason:'read_only', hash, checks};
  const approval = context.approvals.find(a => a.hash === hash && a.actorId === actor.id && a.tenant === actor.tenant && a.policy === context.policy);
  if (!approval) return {decision:'approval_required', reason:'exact_request_not_approved', hash, checks};
  if (approval.revoked) return fail('approval_revoked', checks);
  if (!Number.isFinite(approval.approvedAt) || !Number.isFinite(approval.expiresAt) || approval.approvedAt > context.now || approval.expiresAt <= context.now || approval.expiresAt <= approval.approvedAt || approval.expiresAt - approval.approvedAt > 300000) return fail('approval_expired', checks);
  if (!str(approval.approverId) || approval.approverId === actor.id) return fail('self_approval', checks);
  passed('Exact request, policy, reviewer and approval lifetime');
  return {decision:'allow', reason:'approved_write', hash, checks};
}
export async function decide(request, context) {
  return evaluatePrepared(await prepare(request, context), context);
}
// These functions model a trusted service. Do not accept approval receipts from a browser.
export async function approve(request, context, reviewer) {
  const prepared = await prepare(request, context);
  if (!reviewer || !str(reviewer.id) || reviewer.tenant !== context.actor.tenant || reviewer.id === context.actor.id || !Array.isArray(reviewer.roles) || !reviewer.roles.includes('manager')) throw new Error('Reviewer must be a different same-tenant manager');
  const result = evaluatePrepared(prepared, context);
  const renew = result.decision === 'deny' && ['approval_expired','approval_revoked'].includes(result.reason);
  if (result.decision !== 'approval_required' && !(result.decision === 'allow' && result.reason === 'approved_write') && !renew) throw new Error('Request is not an approvable write');
  const receipt = {hash:prepared.hash, tenant:context.actor.tenant, actorId:context.actor.id, approverId:reviewer.id, policy:context.policy, approvedAt:context.now, expiresAt:context.now + 300000, revoked:false};
  context.approvals = context.approvals.filter(a => a.hash !== prepared.hash);
  context.approvals.push(receipt);
  return receipt;
}
export async function execute(request, context) {
  const prepared = await prepare(request, context);
  const result = evaluatePrepared(prepared, context);
  if (result.decision !== 'allow') return result;
  request = prepared.request;
  // In production, reserve the key and enqueue the effect in one DB transaction.
  // Here the effect is only an in-memory synthetic outbox entry, with no await in this section.
  const key = context.actor.tenant + ':' + request.id;
  const prior = context.ledger.find(e => e.key === key);
  if (prior) return prior.hash === result.hash ? {...result, decision:'replay', reason:'already_executed', prior} : fail('idempotency_conflict', result.checks);
  const event = {key, hash:result.hash, tool:request.tool, at:context.now, result: request.tool === 'read_invoice' ? 'synthetic_record_read' : 'synthetic_reminder_queued'};
  context.ledger.push(event);
  return {...result, event};
}
