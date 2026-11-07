/**
 * An Agent with no brand of its own, drawn as a small creature: a body of its
 * own shape and colour, and two eyes. The same name always makes the same
 * creature, so an Agent looks like itself in the Header, its list and Manage
 * agents, and across reconnecting. It is awake, eyes open, only while it
 * works; at rest it sleeps.
 *
 * Drawn in the language of the Grok Bot mark, the eyes doing the work a face
 * would. Nothing here is the Agent's own picture: the product knows only the
 * name it gave itself.
 */

type Point = readonly [number, number];
type Body = readonly ({ circle: readonly [cx: number, cy: number, r: number] } | { path: string })[];

/** Clear, mid-light colours that stay apart from each other and readable on light and dark Headers. */
const COLORS = ["#4DB6A4", "#E5484D", "#3D7FF5", "#57B96A", "#E8489A", "#8A5CF6", "#F2994A", "#D9B23A"] as const;

/** The point `distance` along the edge from `from` toward `to`, never past its middle. */
function toward([fx, fy]: Point, [tx, ty]: Point, distance: number): Point {
  const length = Math.hypot(tx - fx, ty - fy);
  const step = Math.min(distance, length / 2) / length;
  return [fx + (tx - fx) * step, fy + (ty - fy) * step];
}

/** A polygon whose corners are rounded, so every body reads as soft. */
function roundedPolygon(points: readonly Point[], radius: number) {
  const format = ([x, y]: Point) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return points.map((corner, index) => {
    const before = toward(corner, points[(index + points.length - 1) % points.length], radius);
    const after = toward(corner, points[(index + 1) % points.length], radius);
    return `${index === 0 ? "M" : "L"}${format(before)} Q${format(corner)} ${format(after)}`;
  }).join(" ") + " Z";
}

/** Corners around the middle, alternating between the given radii, starting straight up when `turn` is 0. */
function ring(count: number, radii: readonly number[], turn = 0, centre: Point = [50, 52]): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2 + turn;
    const radius = radii[index % radii.length];
    return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius] as const;
  });
}

/** Bodies, each kept 6 units inside the frame so the edge drawn around it is never cut. */
const BODIES: readonly Body[] = [
  [{ circle: [50, 52, 43] }],
  [{ path: roundedPolygon(ring(6, [45], Math.PI / 6), 13) }],
  [{ path: roundedPolygon(ring(8, [46, 31], 0, [50, 50]), 15) }],
  [{ circle: [33, 34, 22] }, { circle: [67, 34, 22] }, { circle: [33, 67, 22] }, { circle: [67, 67, 22] },
    { circle: [50, 50, 24] }],
  [{ circle: [31, 60, 25] }, { circle: [69, 60, 25] }, { circle: [52, 37, 27] }, { circle: [50, 64, 28] }],
  [...ring(5, [24], 0, [50, 51]).map(([cx, cy]) => ({ circle: [cx, cy, 20] as const })), { circle: [50, 51, 26] }],
  [{ path: "M24 9 H76 Q91 9 91 24 V76 Q91 91 76 91 H24 Q9 91 9 76 V24 Q9 9 24 9 Z" }],
  [{ path: roundedPolygon(ring(5, [46]), 14) }],
];

/**
 * FNV-1a, then a full avalanche, so the creature is a stable function of the
 * name in every process and names that differ by one character still land on
 * different bodies and colours.
 */
function hash(text: string) {
  let value = 0x811c9dc5;
  for (const character of text) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

export function agentCreatureFor(seed: string) {
  const value = hash(seed.trim().toLocaleLowerCase());
  return { body: value % BODIES.length, color: COLORS[(value >>> 16) % COLORS.length] };
}

const EYES: readonly Point[] = [[44, 47], [60, 47]];

export function AgentCreature({ seed, awake }: { seed: string; awake: boolean }) {
  const { body, color } = agentCreatureFor(seed);
  const parts = BODIES[body];
  const draw = (key: string) => parts.map((part, index) => "circle" in part
    ? <circle key={`${key}${index}`} cx={part.circle[0]} cy={part.circle[1]} r={part.circle[2]} />
    : <path key={`${key}${index}`} d={part.path} />);
  return (
    <svg className="desktop-agent-creature" viewBox="0 0 100 100" aria-hidden="true"
      data-creature-body={body} data-creature-eyes={awake ? "open" : "closed"}>
      {/* The host's own ground around the body, so stacked creatures stay apart. */}
      <g className="desktop-agent-creature-edge">{draw("edge")}</g>
      <g fill={color}>{draw("body")}</g>
      <g className="desktop-agent-creature-eyes">
        {EYES.map(([cx, cy]) => awake
          ? <ellipse key={cx} cx={cx} cy={cy} rx={4.6} ry={10} transform={`rotate(-12 ${cx} ${cy})`} />
          : <path key={cx} d={`M${cx - 6} ${cy + 1} q6 6.5 12 0`} />)}
      </g>
    </svg>
  );
}
