import {POLICY, approve, execute} from './gate.mjs';
export function fixture() {
  return {
    request:{id:'run-1042', tenant:'orchid', tool:'send_reminder', args:{invoiceId:'INV-1042',version:3,recipient:'accounts@orchid.example',message:'A reminder that invoice INV-1042 is overdue. Please contact our billing team if you need help.'}},
    context:{actor:{id:'agent-billing-7',tenant:'orchid',roles:['viewer','billing']},policy:POLICY,now:1795478400000,records:[
      {id:'INV-1042',tenant:'orchid',version:3,recipient:'accounts@orchid.example',status:'overdue'},
      {id:'INV-2048',tenant:'cedar',version:1,recipient:'accounts@cedar.example',status:'overdue'}
    ],approvals:[],ledger:[]},
    reviewer:{id:'reviewer-maya',tenant:'orchid',roles:['manager']}
  };
}
export const scenarios = [
  {id:'unapproved',name:'Write awaiting review',expected:'approval_required',why:'A plausible tool call is still a proposed write. It needs a separate reviewer.', setup:async()=>{}},
  {id:'approved',name:'Approved write',expected:'allow',why:'The reviewer approved this exact request, actor and policy version.',setup:async f=>{await approve(f.request,f.context,f.reviewer);}},
  {id:'changed',name:'Changed after approval',expected:'approval_required',why:'Editing the message changes the request digest. Previous approval no longer covers it.',setup:async f=>{await approve(f.request,f.context,f.reviewer);f.request.args.message='Please use our new payment instructions instead.';}},
  {id:'expired',name:'Expired approval',expected:'deny',why:'The five-minute approval window has ended, even though the payload is unchanged.',setup:async f=>{await approve(f.request,f.context,f.reviewer);f.context.now+=300001;}},
  {id:'tenant',name:'Another tenant’s record',expected:'deny',why:'The actor’s tenant comes from trusted context. A requested invoice cannot switch it.',setup:async f=>{f.request.args.invoiceId='INV-2048';f.request.args.version=1;}},
  {id:'destination',name:'Changed destination',expected:'deny',why:'The proposed recipient must match the current authoritative invoice record.',setup:async f=>{f.request.args.recipient='other@cedar.example';}},
  {id:'stale',name:'Record changed',expected:'deny',why:'The invoice version advanced after review. Reload and request a new approval.',setup:async f=>{await approve(f.request,f.context,f.reviewer);f.context.records[0].version=4;}},
  {id:'replay',name:'Retry after execution',expected:'replay',why:'The idempotency key already has a completed synthetic effect. No second effect is added.',setup:async f=>{await approve(f.request,f.context,f.reviewer);await execute(f.request,f.context);}},
  {id:'policy',name:'Policy changed',expected:'approval_required',why:'Approval is bound to a policy version. A policy change requires a fresh review.',setup:async f=>{await approve(f.request,f.context,f.reviewer);f.context.policy='gate-v2';}},
  {id:'read',name:'Read-only request',expected:'allow',why:'A scoped read needs the viewer role, but does not require write approval.',setup:async f=>{f.request.tool='read_invoice';delete f.request.args.recipient;delete f.request.args.message;}}
];
export async function loadScenario(id) {
  const scenario=scenarios.find(s=>s.id===id);
  if (!scenario) throw new Error('Unknown scenario');
  const f=fixture();await scenario.setup(f);return {...f,scenario};
}
