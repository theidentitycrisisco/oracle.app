// Vercel Edge Function — proxies all Anthropic calls with auth + rate limiting
// Environment variables needed (server-side, no VITE_ prefix):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

export const config = { runtime: "edge" };

const FREE_LIMITS = {
  readings: 10,   // oracle readings per month
  chat: 100,      // chat messages per month
};

export default async function handler(req) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL     = process.env.SUPABASE_URL;
  const SUPABASE_ANON    = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;

  // ── Parse body ────────────────────────────────────────────────────────────
  let anthropicBody, callType;
  try {
    ({ anthropicBody, callType = "chat" } = await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: cors() });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  let userId = null;
  let userTier = "free";

  if (token) {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
    });
    if (userRes.ok) {
      const user = await userRes.json();
      userId = user.id || null;
    }
  }

  if (userId) {
    // Check subscription tier
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=tier`,
      { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON } }
    );
    if (subRes.ok) {
      const subs = await subRes.json();
      userTier = subs[0]?.tier || "free";
    }
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  // Only count readings and chat messages — not poems (background feature)
  if (userId && userTier === "free" && callType !== "poem") {
    const month = new Date().toISOString().slice(0, 7); // "2026-03"

    const usageRes = await fetch(
      `${SUPABASE_URL}/rest/v1/usage?user_id=eq.${userId}&month=eq.${month}&select=readings,chat_messages`,
      { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON } }
    );
    const usageRows = usageRes.ok ? await usageRes.json() : [];
    const usage = usageRows[0] || { readings: 0, chat_messages: 0 };

    const field = callType === "reading" ? "readings" : "chat_messages";
    const used  = usage[field] || 0;
    const limit = FREE_LIMITS[callType === "reading" ? "readings" : "chat"];

    if (used >= limit) {
      return new Response(
        JSON.stringify({ error: "rate_limit", callType, used, limit, tier: userTier }),
        { status: 429, headers: { "Content-Type": "application/json", ...cors() } }
      );
    }
  }

  // ── Call Anthropic ────────────────────────────────────────────────────────
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(anthropicBody),
  });

  const responseData = await anthropicRes.json();

  // ── Track usage (service role bypasses RLS) ───────────────────────────────
  if (userId && callType !== "poem" && anthropicRes.ok) {
    const month = new Date().toISOString().slice(0, 7);
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE,
        Authorization: `Bearer ${SUPABASE_SERVICE}`,
      },
      body: JSON.stringify({ p_user_id: userId, p_month: month, p_type: callType }),
    });
  }

  return new Response(JSON.stringify(responseData), {
    status: anthropicRes.status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
