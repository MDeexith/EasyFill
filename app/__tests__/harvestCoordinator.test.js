import { createHarvestCoordinator } from '../src/webview/harvestCoordinator';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createHarvestCoordinator', () => {
  test('resolves with the harvested options when the message arrives first', async () => {
    const coord = createHarvestCoordinator();
    const inject = jest.fn();
    const promise = coord.startHarvest(inject, 8000);

    coord.deliver({ af_1: [{ value: 'us', label: 'United States' }] });

    await expect(promise).resolves.toEqual({ af_1: [{ value: 'us', label: 'United States' }] });
    expect(inject).toHaveBeenCalledTimes(1);
    // The timeout should not blow up even after the promise already settled.
    jest.advanceTimersByTime(8000);
  });

  test('resolves with {} when the timeout fires first', async () => {
    const coord = createHarvestCoordinator();
    const promise = coord.startHarvest(() => {}, 8000);

    jest.advanceTimersByTime(8000);

    await expect(promise).resolves.toEqual({});
  });

  test('settles exactly once when both the message and the timeout occur', async () => {
    const coord = createHarvestCoordinator();
    const promise = coord.startHarvest(() => {}, 8000);

    coord.deliver({ af_1: [{ value: 'a', label: 'A' }] });
    // A late timeout after delivery must not change the already-settled value
    // (it also must not throw).
    jest.advanceTimersByTime(8000);
    // A late, spurious second deliver (e.g. a duplicate message) must be a
    // no-op rather than erroring or resolving again.
    expect(() => coord.deliver({ af_1: [{ value: 'b', label: 'B' }] })).not.toThrow();

    await expect(promise).resolves.toEqual({ af_1: [{ value: 'a', label: 'A' }] });
  });

  test('a superseded run settles immediately (with {}) rather than hanging when a newer run starts', async () => {
    const coord = createHarvestCoordinator();
    const firstInject = jest.fn();
    const secondInject = jest.fn();

    const first = coord.startHarvest(firstInject, 8000);
    // Second run starts before the first's harvest ever answered or timed out.
    const second = coord.startHarvest(secondInject, 8000);

    // The first run must settle right away rather than waiting for its own
    // 8s timeout — it does not get to hang mid-doAutofill.
    await expect(first).resolves.toEqual({});

    // The second run is still the live one; delivering now resolves it, not
    // the (already-settled) first.
    coord.deliver({ af_2: [{ value: 'x', label: 'X' }] });
    await expect(second).resolves.toEqual({ af_2: [{ value: 'x', label: 'X' }] });

    // The first run's own timeout firing afterwards must be a no-op — it
    // must not, for instance, throw or resolve the second run's promise.
    expect(() => jest.advanceTimersByTime(8000)).not.toThrow();
  });

  test('a harvest with nothing pending when its timeout fires is a no-op (already delivered)', async () => {
    const coord = createHarvestCoordinator();
    const promise = coord.startHarvest(() => {}, 8000);
    coord.deliver({});
    await expect(promise).resolves.toEqual({});
    expect(() => jest.advanceTimersByTime(8000)).not.toThrow();
  });

  test('deliver with no harvest in flight is a no-op', () => {
    const coord = createHarvestCoordinator();
    expect(() => coord.deliver({ af_1: [] })).not.toThrow();
  });
});
