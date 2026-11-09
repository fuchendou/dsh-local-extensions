import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** Services required by this host half. */
declare const inject: string[];
/** Cordis plugin identity used in loader diagnostics. */
declare const name = "dsh-office-kit";
/** Register the four skills and a status tool, and expose the runtime paths in skill bodies. */
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };