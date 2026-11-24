# Workflow Gate Lab

[Try the live experiment](https://xavierfan0413.github.io/demos/workflow-gate/)

A small, original engineering exercise: an AI agent proposes a reminder for a fictional overdue invoice. A deterministic policy gate decides whether the proposed tool call is scoped, current and explicitly approved. No model or email service is called. All records, people and destinations are synthetic.

Implementation prepared with AI assistance in November 2026. This is a separate public exercise, not code from my internship or a demonstration of any employer's implementation. It makes no claim of protocol compatibility or security certification.

## Try it in 60 seconds

1. Open **Approved write**. The exact synthetic request is allowed.
2. Change the message and click **Evaluate**. The old approval no longer applies.
3. Click **Simulate reviewer approval**, then **Simulate execution** twice. One synthetic effect is recorded; the retry is reported as already executed.
4. Try **Another tenant's record**, **Expired approval** and **Record changed**. Inspect the decision trace.
5. **Download current trace** exports the request, synthetic context, receipts and result as JSON. There is no analytics or external API integration.

## Run locally

Use Node.js 22+ for tests and Python 3 for an optional static server. No packages or API keys are needed. Verified with Node.js 24.22.1.

```sh
node --test gate.test.mjs
python -m http.server 8765
```

Then open `http://localhost:8765/`. Browser modules and Web Crypto need HTTP localhost or HTTPS; opening the HTML directly as a file is not supported.

## What is actually implemented

`gate.mjs` is shared between the browser and Node tests. It checks an explicit tool/argument schema, actor and record tenant, role, authoritative recipient, record version and overdue status. A SHA-256 digest binds the request ID, tenant, tool and all arguments to the actor ID and policy version. A different same-tenant manager must explicitly approve writes. Approval expires after five minutes and can be revoked or renewed by a new review.

Reads require scoped access but not write approval. Reusing an idempotency key with changed content is rejected. A successful retry with the same digest returns the existing synthetic effect. Requests are snapshotted before asynchronous hashing, and policy/record/approval state is checked again after hashing before the in-memory effect is appended. The tests include mutations during hashing and overlapping identical requests.

`fixtures.mjs` supplies ten scenarios. `gate.test.mjs` contains 33 tests covering the fixtures, argument validation, approval binding, expiry boundaries, revocation, actor switches, concurrent retries and state changes during hashing. These are development cases, not a held-out benchmark or evidence of resistance to arbitrary attacks.

## Trust boundary and integration plan

The browser simulates both the agent and the reviewer. It is **not an authorization service**. Users can modify its code and memory. Production must derive actor identity and tenant from authenticated server context, resolve roles and invoices from authoritative storage, and protect approval receipts from client modification. SHA-256 identifies content; it does not authenticate reviewers or sign evidence.

The in-memory ledger prevents duplicate effects only within one shared runtime. It is not durable and does not coordinate processes. A real integration should reserve a unique `(tenant, request_id)` and persist an outbox entry in one database transaction. A worker needs downstream idempotency support or reconciliation for uncertain delivery; this exercise does not guarantee exactly-once email delivery.

Record changes, role revocation and policy updates need server-side transaction/version checks at the execution boundary. Approval revocation across services, reviewer identity lifecycle, tamper-evident storage and audit retention are outside this fixture. Message content is treated as an opaque approved string: there is no model-output quality assessment, prompt-injection detector, recipient ownership verification or payment logic.

A useful next experiment is to put this gate behind a FastAPI service with authenticated tenant context, PostgreSQL approvals/outbox and a fake delivery adapter, then test crash recovery and two-worker retries. That integration has not been built here.

## Why this experiment

My existing work includes Python/FastAPI, Next.js, multi-tenant application delivery, RAG and AWS deployment through a team capstone followed by an AI engineering internship. This independent exercise makes one narrow reliability question easy to inspect without disclosing private project code or customer data.
