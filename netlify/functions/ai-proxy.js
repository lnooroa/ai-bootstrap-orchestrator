// netlify/functions/ai-proxy.js
// Node 18+ (Netlify Functions). No external packages needed.
//
// POST /.netlify/functions/ai-proxy
// Body: {
//   provider: "openai" | "gemini" | "deepseek",
//   model?: string,
//   apiKey?: string,        // optional override of env key
//   system?: string,        // optional system prompt
//   message: string         // required user message
// }
//
// Response: { text, provider, model, raw }

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: CORS_HEADERS, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed. Use POST." });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const provider = (payload.provider || "openai").toLowerCase();
    const message = (payload.message || "").trim();
    const model   = payload.model || defaultModel(provider);
    const system  = payload.system || null;

    if (!message) {
      return json(400, { error: "Missing 'message'." });
    }

    // Determine API key (request override > env)
    const keyFromBody = (payload.apiKey || "").trim();
    const apiKey = keyFromBody || envKeyFor(provider);
    if (!apiKey) {
      return json(400, { error: `Missing API key for provider '${provider}'.` });
    }

    // Route to provider
    let result;
    switch (provider) {
      case "openai":
        result = await callOpenAI({ apiKey, model, system, message });
        break;
      case "gemini":
      case "google":
        result = await callGemini({ apiKey, model, system, message });
        break;
      case "deepseek":
        result = await callDeepSeek({ apiKey, model, system, message });
        break;
      default:
        return json(400, { error: `Unsupported provider '${provider}'.` });
    }

    return json(200, result);
  } catch (err) {
    console.error("ai-proxy error:", err);
    return json(500, { error: "Internal error", detail: String(err?.message || err) });
  }
};

/* ---------- Helpers ---------- */

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(body)
  };
}

function defaultModel(provider) {
  switch (provider) {
    case "openai":  return "gpt-4o-mini";         // fast/cheap general model
    case "gemini":  return "gemini-1.5-pro";      // text reasoning
    case "deepseek":return "deepseek-chat";       // general chat
    default:        return "gpt-4o-mini";
  }
}

function envKeyFor(provider) {
  switch (provider) {
    case "openai":  return process.env.OPENAI_API_KEY || "";
    case "gemini":  return process.env.GEMINI_API_KEY || "";
    case "deepseek":return process.env.DEEPSEEK_API_KEY || "";
    default:        return "";
  }
}

/* ---------- Provider Calls ---------- */

async function callOpenAI({ apiKey, model, system, message }) {
  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: message }
    ],
    temperature: 0.7
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const raw = await safeJson(res);
  if (!res.ok) throw new Error(`OpenAI: ${res.status} ${JSON.stringify(raw)}`);

  const text = raw?.choices?.[0]?.message?.content?.trim?.() || "";
  return { text, provider: "openai", model, raw };
}

async function callGemini({ apiKey, model, system, message }) {
  // Text endpoint (non-streaming)
  // Docs: https://ai.google.dev/gemini-api/docs
  const sysPart = system ? [{ role: "system", parts: [{ text: system }] }] : [];
  const body = {
    contents: [
      ...sysPart,
      { role: "user", parts: [{ text: message }] }
    ]
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const raw = await safeJson(res);
  if (!res.ok) throw new Error(`Gemini: ${res.status} ${JSON.stringify(raw)}`);

  const text =
    raw?.candidates?.[0]?.content?.parts?.map(p => p?.text || "").join("")?.trim() || "";
  return { text, provider: "gemini", model, raw };
}

async function callDeepSeek({ apiKey, model, system, message }) {
  // API: https://api.deepseek.com/chat/completions
  const url = "https://api.deepseek.com/chat/completions";
  const body = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: message }
    ],
    temperature: 0.7
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const raw = await safeJson(res);
  if (!res.ok) throw new Error(`DeepSeek: ${res.status} ${JSON.stringify(raw)}`);

  const text = raw?.choices?.[0]?.message?.content?.trim?.() || "";
  return { text, provider: "deepseek", model, raw };
}

/* ---------- Utils ---------- */

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}
