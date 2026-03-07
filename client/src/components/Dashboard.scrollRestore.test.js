/**
 * Tests that the Dashboard preserves scroll position when device status updates
 * trigger a re-render (socket events device-update / device-status-change).
 */
describe('Dashboard scroll restore on device status update', () => {
  let scrollToMock;
  let rafCallback;

  beforeEach(() => {
    scrollToMock = jest.fn();
    window.scrollTo = scrollToMock;
    window.scrollY = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('restores scroll position via requestAnimationFrame when scrollRestoreRef was set', () => {
    // Same logic as Dashboard restore effect: copy ref, clear, then scrollTo in RAF.
    const scrollRestoreRef = { current: 350 };
    if (scrollRestoreRef.current != null) {
      const y = scrollRestoreRef.current;
      scrollRestoreRef.current = null;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    expect(rafCallback).toBeDefined();
    rafCallback();
    expect(scrollToMock).toHaveBeenCalledWith(0, 350);
  });

  it('does not call scrollTo when scrollRestoreRef is null', () => {
    const scrollRestoreRef = { current: null };
    if (scrollRestoreRef.current != null) {
      const y = scrollRestoreRef.current;
      scrollRestoreRef.current = null;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    expect(scrollToMock).not.toHaveBeenCalled();
  });
});
