export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(initial: Date): Clock & { set(at: Date): void } {
  let current = initial;
  return {
    now: () => current,
    set(at: Date) {
      current = at;
    },
  };
}
