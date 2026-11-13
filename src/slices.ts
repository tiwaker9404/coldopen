/**
 * Long loops that give the event loop a turn. The hosted app runs on 0.1 CPU, where a loop that
 * takes 200 ms on a laptop holds every other request (and /healthz) for 2 s. A loop run through
 * inSlices stops every `sliceMs` and lets I/O in before going on.
 */

export const SLICE_MS = 50

export async function inSlices<T>(
  items: Iterable<T>,
  fn: (item: T) => void,
  sliceMs = SLICE_MS,
  clock: () => number = () => performance.now(),
): Promise<void> {
  let since = clock()
  for (const item of items) {
    fn(item)
    if (clock() - since >= sliceMs) {
      await new Promise((r) => setImmediate(r))
      since = clock()
    }
  }
}
