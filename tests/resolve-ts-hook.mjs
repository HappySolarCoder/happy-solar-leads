function hasExplicitExtension(specifier) {
  return /\.[cm]?[jt]sx?$/.test(specifier) || specifier.endsWith('.json');
}

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative || hasExplicitExtension(specifier)) {
    return nextResolve(specifier, context);
  }

  try {
    return await nextResolve(`${specifier}.ts`, context);
  } catch (error) {
    try {
      return await nextResolve(`${specifier}/index.ts`, context);
    } catch {
      throw error;
    }
  }
}
