// Phone compass via DeviceOrientation. Gives the compass heading (degrees clockwise from north) of the
// direction the BACK CAMERA points, so hold the phone the way you held it for the photo.
//
// Browsers only allow this on secure pages: https://, or http://localhost. On a phone opening
// http://192.168.x.x it is blocked, so the README explains how to use HTTPS (npm run cert).
//   iPhone (Safari): needs HTTPS + a permission prompt (DeviceOrientationEvent.requestPermission),
//                    heading comes from event.webkitCompassHeading.
//   Android (Chrome): needs HTTPS, uses the 'deviceorientationabsolute' event.
import { norm360 } from '/shared/geo.js';

const rad = d => (d * Math.PI) / 180;

/** Compass heading of the device's back (−Z axis) from absolute alpha/beta/gamma (W3C Z-X'-Y'' angles). */
export function cameraHeading(alpha, beta, gamma) {
  const a = rad(alpha), b = rad(beta), g = rad(gamma);
  const east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const north = Math.cos(a) * Math.sin(b) * Math.cos(g) - Math.sin(a) * Math.sin(g);
  if (Math.hypot(east, north) < 0.35) return norm360(-alpha); // phone lying flat: use the top edge instead
  return norm360((Math.atan2(east, north) * 180) / Math.PI);
}

/** Why the compass can't work here, or null if it might. */
export function compassProblem() {
  if (!('DeviceOrientationEvent' in window)) return 'This browser has no compass access.';
  if (!window.isSecureContext) return 'The phone compass only works over HTTPS.';
  return null;
}

/**
 * Starts reading. Call directly from a tap handler (iPhone asks for permission).
 * onHeading(deg) is called with a smoothed heading. Resolves to a stop() function.
 */
export async function startCompass(onHeading) {
  const problem = compassProblem();
  if (problem) throw new Error(problem);
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const answer = await DeviceOrientationEvent.requestPermission(); // must run inside the tap, before any other await
    if (answer !== 'granted') throw new Error('Compass permission was denied. Allow Motion & Orientation access in Safari settings.');
  }

  let sx = 0, sy = 0, got = false;
  const emit = deg => {
    // smooth on the circle so 359° → 1° doesn't jump through 180°
    const k = got ? 0.25 : 1;
    sx = sx * (1 - k) + Math.sin(rad(deg)) * k;
    sy = sy * (1 - k) + Math.cos(rad(deg)) * k;
    got = true;
    onHeading(Math.round(norm360((Math.atan2(sx, sy) * 180) / Math.PI)));
  };
  const handler = e => {
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) return emit(e.webkitCompassHeading);
    if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) emit(cameraHeading(e.alpha, e.beta, e.gamma));
  };
  const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(type, handler);
  const stop = () => window.removeEventListener(type, handler);

  await new Promise(r => setTimeout(r, 1500));
  if (!got) {
    stop();
    throw new Error('No compass reading. This device may not have a compass (most laptops don’t).');
  }
  return stop;
}
