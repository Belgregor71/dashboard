/* ═══════════════════════════════════════════════════════════════════════════
   WHERE'S THE VACUUM — the plan with the robot on it (features.v3RobotPlan).

   Asked for, so it stays as long as the subject does and follows the robot while
   it is open. The spoken answer is the answerer's; this adds no words.

   Plan and calibration are private: see server/routes/housePlan.js. With no
   plan, no calibration or no robot this declines and only the words are said.
   ═══════════════════════════════════════════════════════════════════════════ */

import { containBox } from "./camera-plan.js";
import { robotLayer, robotTrack } from "../core/robot-layer.js";

const REFRESH_MS = 10_000;

export async function showRobot() {
  const [res, track] = await Promise.all([fetch("/api/house-plan"), robotTrack()]);
  const plan = res.ok ? await res.json() : null;
  if (!plan?.width || !plan.height) return null;

  const plate = { width: plan.width, height: plan.height, robot: plan.diorama?.robot };
  let layer = robotLayer(track, plate);
  if (!layer) return null;

  const image = new Image();
  image.className = "plan__image";
  image.alt = "";
  image.src = "/api/house-plan/layer/plan-empty";
  await image.decode();

  const wrap = document.createElement("div");
  wrap.className = "lapse robot-plan";
  wrap.style.setProperty("--plan-up", `${plan.upBearing ?? 0}deg`);

  const box = containBox(window.innerWidth, window.innerHeight, plan.width / plan.height);
  const world = document.createElement("div");
  world.className = "lapse__world";
  Object.assign(world.style, {
    width: `${box.width}px`,
    height: `${box.height}px`,
    left: `${box.left}px`,
    top: `${box.top}px`
  });
  const light = document.createElement("div");
  light.className = "plan__light";
  world.append(image, light, layer);
  wrap.append(world);

  const timer = setInterval(async () => {
    const fresh = robotLayer(await robotTrack(), plate);
    if (!fresh) return;   // a missed reading keeps the last picture
    layer.replaceWith(fresh);
    layer = fresh;
  }, REFRESH_MS);

  return {
    node: wrap,
    teardown: () => {
      clearInterval(timer);
      image.src = "";
    }
  };
}
