/** A transformer function that modifies data. */
export type Transformer<T> = (data: T) => T;

/** Creates a pipeline that applies transformers in sequence. */
export const pipe = <T>(...fns: Transformer<T>[]): Transformer<T> =>
  (data: T) => fns.reduce((acc, fn) => fn(acc), data);

/** Conditional transformer - only applies if condition is true. */
export const when = <T>(cond: boolean, fn: Transformer<T>): Transformer<T> =>
  cond ? fn : (x) => x;
