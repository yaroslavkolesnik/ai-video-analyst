/** `ffprobe-static` ships no types and has no `@types` package. */
declare module 'ffprobe-static' {
  /** Absolute path to the bundled ffprobe binary for the current platform. */
  export const path: string;
}
