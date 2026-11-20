/**
 * Computes the person of light off the main thread while the room loads.
 * The arrays are transferred, not copied.
 */
import { humanPoints } from "./human-points.js";

const { points, layers } = humanPoints();
postMessage({ points, layers }, [points.buffer, layers.buffer]);
