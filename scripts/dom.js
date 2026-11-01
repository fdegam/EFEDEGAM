/** Shared DOM queries and visitor preferences. */
export const one = (selector) => document.querySelector(selector);
export const many = (selector) =>
  Array.from(document.querySelectorAll(selector));
export const reduced = matchMedia("(prefers-reduced-motion: reduce)");
export const finePointer = matchMedia("(pointer: fine)");
