// Execute the real route with isolated session/network dependencies. Synthetic
// users only; no environment files, external requests or Auth transactions.

import ts from "typescript";

import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  isSuperadmin: false,
};
const target = "33333333-3333-4333-8333-333333333333";
const calls = [];
const stubs = {
  "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
  "@/lib/supabase/session.server": { requireOrgAdmin: async () => ({ session: actor }) },
  "@/lib/careon-audit/audit.server": { scheduleAuditEvent: () => undefined },
  "@/lib/careon-demo-account": {
    CAREON_HOSTED_DEMO_EMAIL_DOMAIN: "careon-demo.nl",
    isCareonHostedDemoEmail: () => false,
  },
  "@/lib/careon-password": {
    normalizeCareonPassword: (s) => s,
    isStrongCareonPassword: () => true,
    CAREON_PASSWORD_HINT: "test",
  },
  "@/lib/http/read-json.server": {
    readJsonBodyLimited: (request) => request.json(),
    InvalidJsonBodyError: class extends Error {},
  },
};
const filename = path.resolve("src/app/api/org/members/route.ts");
const loaded = new Module(filename);
loaded.require = (name) => {
  assert.ok(name in stubs, `Unexpected dependency: ${name}`);
  return stubs[name];
};
loaded._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const route = loaded.exports;
const originalFetch = globalThis.fetch;
let checks = 0;
function request(method, body) {
  return new Request("https://offline.invalid/api/org/members", { method, body: JSON.stringify(body) });
}
try {
  // Exact audit scenario: target belongs to A and B, admin only to A. Reject
  // before any privileged I/O, so concurrent addition of B cannot race a count.
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error("Tenant admin must never reach the global Auth API");
  };
  for (const org of [actor.orgId, "44444444-4444-4444-8444-444444444444"]) {
    actor.orgId = org;
    for (const action of ["reset_password", "invite_link", "ban", "unban"]) {
      const response = await route.PATCH(request("PATCH", { action, userId: target, password: "synthetic" }));
      assert.equal(response.status, 403);
      assert.equal(calls.length, 0);
      checks++;
    }
  }
  // Initial creation must not hand a reusable global recovery credential to an
  // org admin either. Such a credential could outlive a later second membership.
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, "POST");
    if (url.endsWith("/auth/v1/admin/users")) return Response.json({ id: target });
    assert.ok(url.endsWith("/rest/v1/organization_members"));
    return new Response(null, { status: 201 });
  };
  const created = await route.POST(request("POST", { email: "synthetic@example.invalid" }));
  assert.equal(created.status, 200);
  assert.equal((await created.json()).inviteLink, null);
  assert.equal(calls.length, 2);
  checks++;
  // Membership failure cannot delete an identity another tenant just linked.
  calls.length = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, "POST");
    return url.endsWith("/users") ? Response.json({ id: target }) : new Response(null, { status: 409 });
  };
  assert.equal((await route.POST(request("POST", { email: "synthetic@example.invalid" }))).status, 502);
  assert.equal(calls.length, 2);
  checks++;
  // Platform-authorized administration remains available, with the existing
  // own-org and protected-platform-user checks still executed by the handler.
  actor.isSuperadmin = true;
  calls.length = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("organization_members?")) return Response.json([{ user_id: target }]);
    if (url.includes("platform_admins?")) return Response.json([]);
    if (!options.method) return Response.json({ id: target, email: "synthetic@example.invalid" });
    assert.equal(options.method, "PUT");
    assert.deepEqual(JSON.parse(options.body), { ban_duration: "876600h" });
    return Response.json({ id: target });
  };
  assert.equal((await route.PATCH(request("PATCH", { action: "ban", userId: target }))).status, 200);
  assert.equal(calls.filter((call) => call.options.method === "PUT").length, 1);
  checks++;
  console.log(`Organization identity boundary: ${checks} behavioral checks passed.`);
} finally {
  globalThis.fetch = originalFetch;
}
