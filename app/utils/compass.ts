export type CompassReading = { heading: number | null; status: 'ready' | 'calibrate' | 'flat'; reference: 'magnetic' | 'sensor'; timestamp: number };
export const normalizeHeading = (degrees: number) => ((degrees % 360) + 360) % 360;
export function compassDirection(degrees: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(normalizeHeading(degrees) / 45) % 8];
}
export function smoothHeading(previous: number | null, next: number): number {
  if (previous === null) return normalizeHeading(next);
  const delta = normalizeHeading(next - previous + 180) - 180;
  return normalizeHeading(previous + delta * .35);
}

export type OrientationSample = {
  alpha: number | null; beta: number | null; gamma: number | null;
  absolute?: boolean; webkitCompassHeading?: number; webkitCompassAccuracy?: number;
};
/** Screen-top projection of the W3C Z-X-Y rotation matrix, in the earth plane. */
export function orientationReading(event: OrientationSample, screenAngle = 0): CompassReading | null {
  const apple = typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading);
  if (!apple && !event.absolute) return null; // Relative gyro yaw is not a compass.
  if (event.beta === null || event.gamma === null || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return null;
  const rad=Math.PI/180, b=event.beta*rad, g=event.gamma*rad;
  const reference=apple?'magnetic':'sensor';
  if (Math.cos(b)*Math.cos(g) < .57) return {heading:null,status:'flat',reference,timestamp:Date.now()};
  if (apple) {
    if (typeof event.webkitCompassAccuracy==='number' && (event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 30)) return {heading:null,status:'calibrate',reference,timestamp:Date.now()};
    return {heading:normalizeHeading(event.webkitCompassHeading!+screenAngle),status:'ready',reference,timestamp:Date.now()};
  }
  if (event.alpha === null || !Number.isFinite(event.alpha)) return null;
  const a=event.alpha*rad, s=screenAngle*rad;
  // Current screen top is [sin(screenAngle), cos(screenAngle), 0] in portrait coordinates.
  const x=(Math.cos(a)*Math.cos(g)-Math.sin(a)*Math.sin(b)*Math.sin(g))*Math.sin(s)-Math.cos(b)*Math.sin(a)*Math.cos(s);
  const y=(Math.sin(a)*Math.cos(g)+Math.cos(a)*Math.sin(b)*Math.sin(g))*Math.sin(s)+Math.cos(a)*Math.cos(b)*Math.cos(s);
  return {heading:normalizeHeading(Math.atan2(x,y)/rad),status:'ready',reference,timestamp:Date.now()};
}
