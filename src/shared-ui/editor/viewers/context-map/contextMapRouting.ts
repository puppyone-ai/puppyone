export type RelationshipRouteRect = Readonly<{
  height: number;
  left: number;
  top: number;
  width: number;
}>;

export type RelationshipRoutingInput = Readonly<{
  id: string;
  source: RelationshipRouteRect;
  sourceId: string;
  target: RelationshipRouteRect;
  targetId: string;
}>;

export type StraightRelationshipRoute = Readonly<{
  id: string;
  path: string;
}>;

export type RadialRelationshipRoutePoint = Readonly<{
  angle: number;
  radius: number;
}>;

export type RadialRelationshipRoutingInput = Readonly<{
  center: Readonly<{ x: number; y: number }>;
  id: string;
  source: RadialRelationshipRoutePoint;
  target: RadialRelationshipRoutePoint;
}>;

export type LayeredRelationshipRoutePoint = Readonly<{
  inset: number;
  x: number;
  y: number;
}>;

export type LayeredRelationshipRoutingInput = Readonly<{
  id: string;
  source: LayeredRelationshipRoutePoint;
  target: LayeredRelationshipRoutePoint;
}>;

/**
 * Keeps relationship rendering linear in the number of visible edges. The
 * segment begins and ends on the glyph bounds, so there is no visual gap.
 */
export function routeStraightRelationships(
  inputs: readonly RelationshipRoutingInput[],
): readonly StraightRelationshipRoute[] {
  return inputs.map((input) => {
    const sourceCenter = getRectCenter(input.source);
    const targetCenter = getRectCenter(input.target);
    const source = getRectEdgePoint(input.source, targetCenter);
    const target = getRectEdgePoint(input.target, sourceCenter);
    return {
      id: input.id,
      path: `M ${formatCoordinate(source.x)} ${formatCoordinate(source.y)} L ${formatCoordinate(target.x)} ${formatCoordinate(target.y)}`,
    };
  });
}

/**
 * Routes a hierarchy edge in three polar segments: out on the parent's
 * radius, around a circle centered on the root, then out on the child's
 * radius. Root edges have no meaningful parent angle and remain radial.
 */
export function routeRadialHierarchyRelationships(
  inputs: readonly RadialRelationshipRoutingInput[],
): readonly StraightRelationshipRoute[] {
  return inputs.map((input) => {
    const sourceAngle = input.source.radius === 0
      ? input.target.angle
      : input.source.angle;
    const targetAngle = input.target.angle;
    const sourceRadius = Math.min(
      input.target.radius,
      input.source.radius + getRadialNodeInset(input.source.radius),
    );
    const targetRadius = Math.max(
      sourceRadius,
      input.target.radius - getRadialNodeInset(input.target.radius),
    );
    const middleRadius = (input.source.radius + input.target.radius) / 2;
    const source = getPolarPoint(input.center, sourceRadius, sourceAngle);
    const target = getPolarPoint(input.center, targetRadius, targetAngle);
    const delta = normalizeSignedAngle(targetAngle - sourceAngle);

    if (input.source.radius === 0 || Math.abs(delta) < 0.0001) {
      return {
        id: input.id,
        path: `M ${formatCoordinate(source.x)} ${formatCoordinate(source.y)} L ${formatCoordinate(target.x)} ${formatCoordinate(target.y)}`,
      };
    }

    const arcStart = getPolarPoint(input.center, middleRadius, sourceAngle);
    const arcEnd = getPolarPoint(input.center, middleRadius, sourceAngle + delta);
    return {
      id: input.id,
      path: [
        `M ${formatCoordinate(source.x)} ${formatCoordinate(source.y)}`,
        `L ${formatCoordinate(arcStart.x)} ${formatCoordinate(arcStart.y)}`,
        `A ${formatCoordinate(middleRadius)} ${formatCoordinate(middleRadius)} 0 0 ${delta >= 0 ? 1 : 0} ${formatCoordinate(arcEnd.x)} ${formatCoordinate(arcEnd.y)}`,
        `L ${formatCoordinate(target.x)} ${formatCoordinate(target.y)}`,
      ].join(" "),
    };
  });
}

export function routeRadialReferenceRelationship(
  source: Readonly<{ x: number; y: number }>,
  target: Readonly<{ x: number; y: number }>,
  center: Readonly<{ x: number; y: number }>,
): string {
  const midpoint = {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2,
  };
  const control = {
    x: midpoint.x + (center.x - midpoint.x) * 0.28,
    y: midpoint.y + (center.y - midpoint.y) * 0.28,
  };
  const visibleSource = movePointToward(source, control, target, 20);
  const visibleTarget = movePointToward(target, control, source, 20);
  return [
    `M ${formatCoordinate(visibleSource.x)} ${formatCoordinate(visibleSource.y)}`,
    `Q ${formatCoordinate(control.x)} ${formatCoordinate(control.y)} ${formatCoordinate(visibleTarget.x)} ${formatCoordinate(visibleTarget.y)}`,
  ].join(" ");
}

/** Routes a top-down hierarchy in three orthogonal segments: vertical from
 * the parent, horizontal at the midpoint between layers, then vertical into
 * the child. */
export function routeLayeredHierarchyRelationships(
  inputs: readonly LayeredRelationshipRoutingInput[],
): readonly StraightRelationshipRoute[] {
  return inputs.map((input) => {
    const source = {
      x: input.source.x,
      y: input.source.y + input.source.inset,
    };
    const target = {
      x: input.target.x,
      y: input.target.y - input.target.inset,
    };
    if (Math.abs(source.x - target.x) < 0.001) {
      return {
        id: input.id,
        path: `M ${formatCoordinate(source.x)} ${formatCoordinate(source.y)} L ${formatCoordinate(target.x)} ${formatCoordinate(target.y)}`,
      };
    }
    const middleY = (source.y + target.y) / 2;
    return {
      id: input.id,
      path: [
        `M ${formatCoordinate(source.x)} ${formatCoordinate(source.y)}`,
        `L ${formatCoordinate(source.x)} ${formatCoordinate(middleY)}`,
        `L ${formatCoordinate(target.x)} ${formatCoordinate(middleY)}`,
        `L ${formatCoordinate(target.x)} ${formatCoordinate(target.y)}`,
      ].join(" "),
    };
  });
}

export function routeLayeredReferenceRelationship(
  source: Readonly<{ x: number; y: number }>,
  target: Readonly<{ x: number; y: number }>,
): string {
  const middleY = (source.y + target.y) / 2;
  const sourceControl = { x: source.x, y: middleY };
  const targetControl = { x: target.x, y: middleY };
  const visibleSource = movePointToward(source, sourceControl, target, 20);
  const visibleTarget = movePointToward(target, targetControl, source, 20);
  return [
    `M ${formatCoordinate(visibleSource.x)} ${formatCoordinate(visibleSource.y)}`,
    `C ${formatCoordinate(sourceControl.x)} ${formatCoordinate(sourceControl.y)} ${formatCoordinate(targetControl.x)} ${formatCoordinate(targetControl.y)} ${formatCoordinate(visibleTarget.x)} ${formatCoordinate(visibleTarget.y)}`,
  ].join(" ");
}

function movePointToward(
  point: Readonly<{ x: number; y: number }>,
  preferredDestination: Readonly<{ x: number; y: number }>,
  fallbackDestination: Readonly<{ x: number; y: number }>,
  maximumDistance: number,
): Readonly<{ x: number; y: number }> {
  const preferredDistance = Math.hypot(
    preferredDestination.x - point.x,
    preferredDestination.y - point.y,
  );
  const destination = preferredDistance > 0.001 ? preferredDestination : fallbackDestination;
  const dx = destination.x - point.x;
  const dy = destination.y - point.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return point;
  const inset = Math.min(maximumDistance, distance / 2);
  return {
    x: point.x + dx / distance * inset,
    y: point.y + dy / distance * inset,
  };
}

function getPolarPoint(
  center: Readonly<{ x: number; y: number }>,
  radius: number,
  angle: number,
): Readonly<{ x: number; y: number }> {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function getRadialNodeInset(radius: number): number {
  return radius === 0 ? 38 : 18;
}

function normalizeSignedAngle(angle: number): number {
  let normalized = angle;
  while (normalized <= -Math.PI) normalized += Math.PI * 2;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
}

function getRectEdgePoint(
  rect: RelationshipRouteRect,
  destination: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  const center = getRectCenter(rect);
  const dx = destination.x - center.x;
  const dy = destination.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy),
  );
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function getRectCenter(rect: RelationshipRouteRect): Readonly<{ x: number; y: number }> {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function formatCoordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}
