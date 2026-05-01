export function throttle(fn, waitMs) {
  let isScheduled = false;
  let lastArgs;

  return (...args) => {
    lastArgs = args;
    if (isScheduled) return;

    isScheduled = true;
    setTimeout(() => {
      isScheduled = false;
      fn(...lastArgs);
    }, waitMs);
  };
}
