// Pre-warms the TTS disk cache (server/routes/tts.js) for the doorbell/side-gate
// alert lines that don't depend on a person's name, so real triggers play
// instantly instead of waiting on live Kokoro synthesis.
//
// Run on the Pi after deploying: node scripts/pregenerate-tts-cache.js

const SERVER_URL = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const RATE = 0.92; // matches doorbellAlert.js's default speak() rate

const LINES = [
  // Front door, nobody identified
  "Someone's at the front door. Hope you've got friends.",
  "Doorbell's going. Statistically, it's a parcel, not a person you like.",
  "Knock knock at the front door. Probably not a joke.",
  "Someone's at the door. Bold of them to just show up unannounced.",
  "There's someone at the front door. Could be a neighbour. Could be a scam.",
  "Doorbell. Must be DoorDash, nobody else visits unannounced.",
  "Someone's knocking at the front door. Try not to look too surprised you have visitors.",
  "Someone's at the door. No, it's not your imagination.",
  "Doorbell's ringing. Fifty-fifty it's someone lovely or someone selling something.",
  "There's a knock at the front door. Miracles do happen, apparently.",
  // Side gate, nobody identified
  "Someone's at the side gate. Hope it's a tradie, not a burglar with poor planning.",
  "Unidentified person at the side gate. Could be trouble, could just be the meter reader.",
  "Someone's sneaking round the side gate. Bold or lost, hard to say.",
  "Movement at the side gate. Definitely not your average Tuesday visitor.",
  "Someone's at the side gate. Who's breaking in this time?"
];

for (const text of LINES) {
  const start = Date.now();
  try {
    const res = await fetch(`${SERVER_URL}/api/tts/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate: RATE })
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${res.ok ? "OK" : "FAIL " + res.status} (${elapsed}s) - ${text}`);
  } catch (err) {
    console.log(`ERROR - ${text}: ${err.message}`);
  }
}
