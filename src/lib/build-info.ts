/**
 * Build metadata for the environment badge.
 *
 * `__GIT_SHA__` / `__GIT_BRANCH__` / `__BUILD_TIME__` are compile-time
 * constants injected via vite.define in astro.config.mjs. `PUBLIC_APP_ENV`
 * is set per deployment environment; unset means production.
 */

export const appEnv = import.meta.env.DEV ? 'local' : import.meta.env.PUBLIC_APP_ENV;

export const isNonProdEnv = Boolean(appEnv) && appEnv !== 'production';

export const gitSha = __GIT_SHA__;
export const gitBranch = __GIT_BRANCH__;
export const builtAtIso = __BUILD_TIME__;
