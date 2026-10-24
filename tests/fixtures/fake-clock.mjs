export function fakeClock() {
  let now = 0, serial = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    get pending() { return timers.size; },
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due; timers.delete(id); timer.callback();
      }
      now = end;
    },
  };
}
