// How every journey names where you are.

export interface LapLabelOptions {

  /** 'LAP' for circuits, 'LOOP' for the walks that repeat. */
  word?: 'LAP' | 'LOOP';

  /** Leave the count off the first lap: it says nothing until there is a second. */
  bareFirst?: boolean;
}

/**
 * "LAP 2 · THE VIADUCT". Laps count from one, the way a person counts them,
 * though every simulation counts from zero.
 */
export function lapLabel (lap: number, name: string, { word = 'LAP', bareFirst = false }: LapLabelOptions = {}): string {
  return bareFirst && lap === 0 ? name : `${word} ${lap + 1} · ${name}`
}
