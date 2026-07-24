import { isAllowedAppNavigation, isSafeExternalUrl } from '../src/main/windows/NavigationPolicy';

describe('main-window navigation policy', () => {
  it('allows only the configured development origin', () => {
    const applicationUrl = 'http://127.0.0.1:5173/';

    expect(isAllowedAppNavigation('http://127.0.0.1:5173/settings', applicationUrl)).toBe(true);
    expect(isAllowedAppNavigation('http://127.0.0.1:5174/', applicationUrl)).toBe(false);
    expect(isAllowedAppNavigation('https://example.com/', applicationUrl)).toBe(false);
    expect(isAllowedAppNavigation('http://127.0.0.1:5173@example.com/', applicationUrl)).toBe(
      false,
    );
  });

  it('allows only the packaged renderer file, including its query and fragment', () => {
    const applicationUrl = 'file:///Applications/Claude%20Command%20Deck/renderer/index.html';

    expect(isAllowedAppNavigation(`${applicationUrl}?mode=focus#session-1`, applicationUrl)).toBe(
      true,
    );
    expect(
      isAllowedAppNavigation(
        'file:///Applications/Claude%20Command%20Deck/renderer/other.html',
        applicationUrl,
      ),
    ).toBe(false);
  });

  it('opens only normal web links outside the application', () => {
    expect(isSafeExternalUrl('https://docs.anthropic.com/')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3000/')).toBe(true);
    expect(isSafeExternalUrl('file:///tmp/untrusted.html')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('custom-handler://run')).toBe(false);
  });
});
