// Coordinates a single "harvest combobox options from the live page and wait
// for the answer" round trip.
//
// Why this exists: doAutofill is re-entrant by design — multi-step forms
// re-invoke it (FIELDS_SCANNED / FIELDS_UPDATED, on a 600ms setTimeout)
// without waiting for a prior run to finish. If a second run starts its own
// combobox harvest while a first run's harvest is still awaiting the page's
// COMBOBOX_OPTIONS reply, a single shared "resolve" slot would let the
// second run's harvest silently steal the first run's wakeup, stranding the
// first run's `await` forever (it would never reach saved-correction
// application, buildCorrectionListenerScript, setMultiStepActive, or
// doAiDraft for that step).
//
// A generation counter fixes this: starting a new harvest immediately
// settles (with {}) whatever harvest was previously in flight, and each
// harvest's own timeout only fires if it is still the current generation.
// The same counter is handed to the injected script and echoed back in its
// reply, so a late COMBOBOX_OPTIONS message from a superseded run is
// discarded rather than resolving a newer run with the wrong page's options.
// Every harvest that is started is guaranteed to settle exactly once, on
// exactly one of three paths: the page answers, the timeout elapses, or a
// later harvest supersedes it.
//
// This module is intentionally free of React/React Native imports so it can
// be unit-tested directly with Jest fake timers; BrowserScreen.jsx is a thin
// caller that owns one instance per WebView (one per mounted screen) and
// supplies the actual `injectJavaScript` side effect.

export function createHarvestCoordinator() {
  let generation = 0;
  let pending = null; // { generation, resolve }

  function settlePending(value) {
    if (!pending) return;
    const { resolve } = pending;
    pending = null;
    resolve(value);
  }

  // Starts a new harvest wait.
  //   inject     — side-effecting function that asks the page for options
  //                (e.g. injectJavaScript(buildComboboxHarvestScript(ids, gen))).
  //                Called synchronously, after any prior harvest has been
  //                superseded, and handed this harvest's generation so the
  //                page can echo it back in its reply.
  //   timeoutMs  — how long to wait for a COMBOBOX_OPTIONS reply before
  //                giving up and resolving with {} (default 8000).
  // Returns a Promise<Record<string, Array<{value,label}>>> that always
  // settles — never rejects, never hangs.
  function startHarvest(inject, timeoutMs = 8000) {
    // A harvest still in flight when a new one starts is superseded: resolve
    // it right away rather than leaving it to hang until its own timeout.
    settlePending({});

    generation += 1;
    const myGeneration = generation;

    return new Promise(resolve => {
      pending = { generation: myGeneration, resolve };
      inject(myGeneration);
      setTimeout(() => {
        if (pending && pending.generation === myGeneration) {
          pending = null;
          resolve({});
        }
      }, timeoutMs);
    });
  }

  // Called when a COMBOBOX_OPTIONS message arrives from the WebView.
  //
  // `generation` is the value the harvest script was built with and echoes
  // back. Without it, a reply produced by run 1's harvest script — still in
  // flight in the page when run 2 started — would resolve run 2's promise
  // with run 1's options, i.e. options read from a page state run 2 knows
  // nothing about. A stale reply is dropped instead; run 2 then settles on
  // its own reply or its own timeout, exactly as if the page had said nothing.
  //
  // A message carrying no generation at all is accepted, so a harvest script
  // injected before an app update (or by any caller that omits it) still
  // works as it did.
  function deliver(options, generation) {
    if (!pending) return;
    if (generation !== undefined && generation !== null && generation !== pending.generation) {
      return;
    }
    settlePending(options || {});
  }

  return { startHarvest, deliver };
}
