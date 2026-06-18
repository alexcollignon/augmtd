// Tiny classNames joiner — filters falsy values and joins with spaces.
// Dependency-free (no clsx/tailwind-merge). Compose component base classes
// with conditional + caller-provided classes; caller classes go last.
export type ClassValue = string | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
