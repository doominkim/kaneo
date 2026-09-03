/*
 * picomatch@4 ships no types and `@types/picomatch` is not in the workspace.
 * Only the surface `agent-project/core-paths.ts` uses is declared here.
 */
declare module "picomatch" {
  export type PicomatchOptions = {
    /** Match dotfiles and dot-directories with `*` and `**`. */
    dot?: boolean;
    nocase?: boolean;
    ignore?: string | string[];
  };
  export type Matcher = (input: string) => boolean;
  const picomatch: {
    (glob: string | string[], options?: PicomatchOptions): Matcher;
    isMatch(
      input: string,
      glob: string | string[],
      options?: PicomatchOptions,
    ): boolean;
  };
  export default picomatch;
}
