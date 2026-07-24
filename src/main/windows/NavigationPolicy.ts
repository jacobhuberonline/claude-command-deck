export function isAllowedAppNavigation(targetUrl: string, applicationUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const application = new URL(applicationUrl);

    if (application.protocol === 'http:' || application.protocol === 'https:') {
      return target.origin === application.origin;
    }

    return (
      application.protocol === 'file:' &&
      target.protocol === 'file:' &&
      target.host === application.host &&
      target.pathname === application.pathname
    );
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(targetUrl: string): boolean {
  try {
    const protocol = new URL(targetUrl).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
