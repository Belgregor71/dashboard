/* ═══════════════════════════════════════════════════════════════════════════
   THE ROBOT ON THE PLATE — its trail and where it is now (features.v3RobotPlan).

   Drawn by the diorama's moments (core/diorama.js) and by the asked-for view
   (subjects/robot-plan.js). The run comes from /api/robot/track in the robot's
   own millimetres; `robot.affine` in the private plan data lays it on the plate.
   No calibration on the box, or no robot: nothing is drawn.
   ═══════════════════════════════════════════════════════════════════════════ */

const SVG = "http://www.w3.org/2000/svg";

/** Robot millimetres to plate pixels: `[a, b, c, d, e, f]` is X = ax + by + c, Y = dx + ey + f. Pure. */
export const toPlate = ([x, y], [a, b, c, d, e, f]) => [a * x + b * y + c, d * x + e * y + f];

/** The run so far, or null. Never throws: no track is simply no robot on the wall. */
export async function robotTrack() {
  try {
    const res = await fetch("/api/robot/track");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** An SVG the size of the plate, or null with nothing to place. */
export function robotLayer(track, plate) {
  const affine = plate?.robot?.affine;
  if (!Array.isArray(affine) || affine.length !== 6 || !track?.robot) return null;

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "robot");
  svg.setAttribute("viewBox", `0 0 ${plate.width} ${plate.height}`);
  svg.dataset.state = track.state ?? "";

  const size = plate.width * 0.011;   // the robot is about this big on the plate, and has to be seen from the couch
  const at = (point) => toPlate(point, affine).map((n) => n.toFixed(1)).join(",");

  if (track.trail?.length > 1) {
    const trail = document.createElementNS(SVG, "polyline");
    trail.setAttribute("class", "robot__trail");
    trail.setAttribute("points", track.trail.map(at).join(" "));
    trail.setAttribute("stroke-width", String(size * 0.55));
    svg.append(trail);
  }

  const [cx, cy] = toPlate(track.robot, affine);
  const dot = document.createElementNS(SVG, "circle");
  dot.setAttribute("class", "robot__dot");
  dot.setAttribute("cx", cx.toFixed(1));
  dot.setAttribute("cy", cy.toFixed(1));
  dot.setAttribute("r", String(size));
  dot.setAttribute("stroke-width", String(size * 0.35));
  svg.append(dot);
  return svg;
}
