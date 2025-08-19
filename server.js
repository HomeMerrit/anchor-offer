import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASSISTANT_ID = process.env.ASSISTANT_ID;         // asst_5j5f6fd1DThI6U7nfsS9hBvx
const ZAPIER_CATCH_URL = process.env.ZAPIER_CATCH_URL; // Zap 2 Catch Hook

async function runAssistantWithTools(inputJson) {
  const thread = await openai.beta.threads.create();
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: JSON.stringify(inputJson)
  });
  let run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: ASSISTANT_ID
  });

  while (true) {
    const status = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    if (status.status === "requires_action") {
      const toolCalls = status.required_action.submit_tool_outputs.tool_calls;
      const tool_outputs = [];
      for (const tc of toolCalls) {
        const name = tc.function.name;
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

        if (name === "getPropertyDetails") {
          const res = await fetch(
            `https://rentcast-proxy-mrk7.onrender.com/property-details?address=${encodeURIComponent(args.address)}`
          );
          const data = await res.json();
          tool_outputs.push({ tool_call_id: tc.id, output: JSON.stringify(data) });
        }

        if (name === "sendToZap") {
          const res = await fetch(ZAPIER_CATCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template: args.template, data: args.data })
          });
          const text = await res.text();
          tool_outputs.push({ tool_call_id: tc.id, output: JSON.stringify({ ok: true, zapier: text }) });
        }
      }
      await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, { tool_outputs });
    } else if (status.status === "completed") {
      return { ok: true, status: status.status };
    } else if (["failed", "cancelled", "expired"].includes(status.status)) {
      throw new Error(`Run ${status.status}`);
    } else {
      await new Promise(r => setTimeout(r, 800));
    }
  }
}

app.post("/start-offer", async (req, res) => {
  try {
    const result = await runAssistantWithTools(req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Worker up on :${PORT}`));
