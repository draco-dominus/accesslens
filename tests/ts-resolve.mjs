// Test-only module resolution for Node's built-in TypeScript support: resolves extensionless relative
// imports (as written for Next/TypeScript bundler resolution) to their .ts/.tsx files.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if ((specifier.startsWith(".") || specifier.startsWith("/")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return await next(`${specifier}.ts`, context);
      } catch {
        return next(`${specifier}.tsx`, context);
      }
    }
    throw err;
  }
}
