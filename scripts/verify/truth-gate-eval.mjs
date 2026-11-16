#!/usr/bin/env node
/* The truth gate's replay eval: real briefing prompts, the production model, and
   the claim check run over what comes back. Prints every sentence the gate would
   drop (with its reason) and every sentence it would keep, so a person can label
   them; the counts alone cannot tell a caught invention from a dropped truth.

   ⚠ SPENDS API MONEY. Run on the box (the key and the prompt flags live in its
   .env), with the owner's yes and a budget:

     node scripts/verify/truth-gate-eval.mjs [samplesPerSet=4] [budgetUsd=0.45]

   Fact sets are invented: this file is public. Output goes to stdout only. */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { systemPromptFor, __buildPrompt } from "../../server/routes/ai.js";
import { claimFault } from "../../server/services/castLines.js";

const SAMPLES = Number(process.argv[2] ?? 4);
const BUDGET = Number(process.argv[3] ?? 0.45);
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
// shortcut: Haiku prices only (USD per token), refuse anything else rather than guess a cost.
if (!/haiku/.test(MODEL)) throw new Error(`no price known for ${MODEL}; add it before spending`);
const PRICE = { in: 1 / 1e6, out: 5 / 1e6 };

const WX = "24°, partly cloudy. 17° to 27°. 20% chance of rain. UV 9";
const SETS = [
  { name: "evening, timed meal tonight + meal tomorrow, bins", type: "evening", time: "Monday evening, 6:00 pm, spring in Brisbane",
    weather: `${WX}. Tomorrow: 18° to 29°, sunny, 5% rain chance`, events: "Tonight: Meal: Laksa at 6:00 pm. Tomorrow: Dentist at 9:30 am; Meal: Dumplings at 6:00 pm",
    bins: "tonight: Red + Yellow", chores: "Sam feeds the dogs tonight, the bins are Alex's turn" },
  { name: "evening, all-day meal, no bins", type: "evening", time: "Thursday evening, 6:02 pm, summer in Brisbane",
    weather: `${WX}. Tomorrow: 21° to 33°, storms, 70% rain chance`, events: "Tonight: Meal: Roast chicken. Tomorrow: School concert at 5:00 pm" },
  { name: "evening, no meal, nothing on", type: "evening", time: "Sunday evening, 6:10 pm, winter in Brisbane",
    weather: "14°, clear. 9° to 21°", events: "Nothing on tonight or tomorrow", news: "Council opens new bridge | Rates to rise" },
  { name: "evening, no weather at all", type: "evening", time: "Wednesday evening, 6:00 pm, autumn in Brisbane",
    events: "Tonight: Meal: Tacos at 6:00 pm. Tomorrow: Meal: Fish and chips at 6:00 pm", bins: "tonight: Red + Green" },
  { name: "morning, busy day, commute + fuel", type: "morning", time: "Tuesday morning, 5:35 am, spring in Brisbane",
    weather: WX, events: "Vet at 8:15 am; Swimming at 4:00 pm; Meal: Curry at 6:00 pm", commute: "Sam's drive 34 min, traffic adding ~8 min",
    fuel: "Unleaded 171.9 at the bottom of the cycle" },
  { name: "morning, last-chance bins, nothing else", type: "morning", time: "Friday morning, 5:35 am, summer in Brisbane",
    weather: "22°, humid. 22° to 34°. 60% chance of rain. UV 12", events: "Nothing scheduled today", bins: "out now, truck's due this morning: Red + Yellow" },
  { name: "morning weekend, empty payload but time", type: "morning", time: "Saturday morning, 7:30 am, winter in Brisbane" },
];

// shortcut: a copy of castLines' sentence split; export that one if the two ever need to agree exactly.
const sentencesOf = (text) => text.replace(/\s*\n\s*/g, " ").match(/.+?[.!?]+["')]*(?=\s|$)/g)?.map((s) => s.trim()) ?? [];

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000 });
let spent = 0; let kept = 0; let dropped = 0; let blank = 0; let briefs = 0;
const reasons = {};

console.log(`model ${MODEL} · ${SAMPLES} per set · budget $${BUDGET} · character=${process.env.HOUSE_CHARACTER_BRIEFINGS ?? "-"} lock=${process.env.BRIEFING_TOPIC_LOCK ?? "-"}`);
run: for (const set of SETS) {
  const { name, ...facts } = set;
  const prompt = __buildPrompt(facts);
  console.log(`\n══ ${name}\n${prompt}`);
  for (let i = 0; i < SAMPLES; i++) {
    if (spent >= BUDGET) { console.log("\nBUDGET REACHED, stopping"); break run; }
    const msg = await client.messages.create({
      model: MODEL, max_tokens: 300, system: systemPromptFor(facts.type),
      messages: [{ role: "user", content: prompt }],
    });
    spent += msg.usage.input_tokens * PRICE.in + msg.usage.output_tokens * PRICE.out;
    const text = msg.content.find((b) => b.type === "text")?.text ?? "";
    const marks = sentencesOf(text).map((s) => ({ s, fault: claimFault(s, prompt) }));
    briefs++;
    if (marks.every((m) => m.fault)) blank++;
    console.log(`  ── sample ${i + 1}`);
    for (const { s, fault } of marks) {
      if (fault) { dropped++; reasons[fault.split(" ")[0]] = (reasons[fault.split(" ")[0]] ?? 0) + 1; } else kept++;
      console.log(`     ${fault ? `DROP [${fault}]` : "keep"}  ${s}`);
    }
  }
}
console.log(`\n${briefs} briefings · ${kept} sentences kept · ${dropped} dropped ${JSON.stringify(reasons)} · ${blank} wholly blanked · spent $${spent.toFixed(3)}`);
