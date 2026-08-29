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

// I4: doAutofill's critical path (pass-2 /match 13-20s + harvest up to 8s +
// /select-option ~3s) now exceeds the old 25s watchdog, so a user can start a
// second run while the first is still going. Run 1's harvest script is still
// live in the page at that point; its reply must not be handed to run 2.
describe('createHarvestCoordinator - generation-tagged deliver', () => {
  test('the generation is handed to inject so the page can echo it back', () => {
    const coord = createHarvestCoordinator();
    const inject = jest.fn();
    coord.startHarvest(inject, 8000);
    expect(inject).toHaveBeenCalledTimes(1);
    expect(typeof inject.mock.calls[0][0]).toBe('number');
  });

  test('generations increase, so two runs never share one', () => {
    const coord = createHarvestCoordinator();
    const first = jest.fn();
    const second = jest.fn();
    coord.startHarvest(first, 8000);
    coord.startHarvest(second, 8000);
    expect(second.mock.calls[0][0]).toBeGreaterThan(first.mock.calls[0][0]);
  });

  test('a reply matching the pending generation resolves it', async () => {
    const coord = createHarvestCoordinator();
    let gen = null;
    const promise = coord.startHarvest(g => { gen = g; }, 8000);

    coord.deliver({ af_1: [{ value: 'a', label: 'A' }] }, gen);

    await expect(promise).resolves.toEqual({ af_1: [{ value: 'a', label: 'A' }] });
  });

  test('a late reply from a SUPERSEDED run does not resolve the newer run', async () => {
    const coord = createHarvestCoordinator();
    let firstGen = null;
    let secondGen = null;

    const first = coord.startHarvest(g => { firstGen = g; }, 8000);
    // Run 1 is superseded the moment run 2 starts, and settles with {}.
    const second = coord.startHarvest(g => { secondGen = g; }, 8000);
    await expect(first).resolves.toEqual({});

    // Run 1's harvest script, still live in the page, finally answers.
    coord.deliver({ af_1: [{ value: 'stale', label: 'Stale' }] }, firstGen);

    // Run 2 must still be waiting — it must NOT have taken run 1's options.
    jest.advanceTimersByTime(8000);
    await expect(second).resolves.toEqual({});

    // And run 2's own reply, had it arrived in time, would have been taken.
    expect(secondGen).not.toBe(firstGen);
  });

  test('run 2 still resolves normally from its own reply after a stale one was dropped', async () => {
    const coord = createHarvestCoordinator();
    let firstGen = null;
    let secondGen = null;

    const first = coord.startHarvest(g => { firstGen = g; }, 8000);
    const second = coord.startHarvest(g => { secondGen = g; }, 8000);
    await expect(first).resolves.toEqual({});

    coord.deliver({ af_1: [{ value: 'stale', label: 'Stale' }] }, firstGen);
    coord.deliver({ af_2: [{ value: 'fresh', label: 'Fresh' }] }, secondGen);

    await expect(second).resolves.toEqual({ af_2: [{ value: 'fresh', label: 'Fresh' }] });
  });

  test('a reply with no generation is still accepted (back-compat)', async () => {
    const coord = createHarvestCoordinator();
    const promise = coord.startHarvest(() => {}, 8000);
    coord.deliver({ af_1: [] });
    await expect(promise).resolves.toEqual({ af_1: [] });
  });

  test('a stale-generation reply with nothing pending is a no-op', () => {
    const coord = createHarvestCoordinator();
    expect(() => coord.deliver({ af_1: [] }, 99)).not.toThrow();
  });
});
