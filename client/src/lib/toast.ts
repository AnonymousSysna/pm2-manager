import { normalizeApiError } from "./apiError";

export function getErrorMessage(error, fallback = "Operation failed") {
  const failure = normalizeApiError(error);
  // Prefer a specific server explanation, then our own phrasing for transport
  // failures ("Network Error", "timeout of 20000ms exceeded" mean nothing to users).
  if (failure.serverMessage) {
    return failure.serverMessage;
  }
  if (failure.kind === "unknown" && error?.message) {
    return String(error.message);
  }
  return failure.message || fallback;
}

// Loading goey-toast eagerly put the entire toast stack (the toaster, sonner,
// and framer-motion) in the chunk the browser preloads before anything paints:
// 263 kB minified, 72 kB gzipped, for notifications that cannot appear until
// the user does something. It is loaded on demand instead, and any call made
// while it is still arriving is queued and replayed once it lands, so a toast
// raised on the first click is not lost.
let api = null;
let loading = null;
const queued = [];

export function loadToaster() {
  if (!loading) {
    loading = import("goey-toast")
      .then((module) => {
        api = module.gooeyToast;
        const pending = queued.splice(0, queued.length);
        pending.forEach((run) => {
          try {
            run(api);
          } catch (_error) {
            // A notification failure must never break the operation itself.
          }
        });
        return api;
      })
      .catch(() => {
        queued.splice(0, queued.length);
        return null;
      });
  }
  return loading;
}

function withToast(run) {
  if (api) {
    try {
      run(api);
    } catch (_error) {
      // A notification failure must never break the operation itself.
    }
    return;
  }
  queued.push(run);
  loadToaster();
}

const toast = {
  // options stay optional so callers can pass just a message.
  success: (title, options = undefined) => withToast((gooeyToast) => gooeyToast.success(String(title), options)),
  error: (title, options = undefined) => withToast((gooeyToast) => gooeyToast.error(String(title), options)),
  info: (title, options = undefined) => withToast((gooeyToast) => gooeyToast.info(String(title), options)),
  warning: (title, options = undefined) => withToast((gooeyToast) => gooeyToast.warning(String(title), options)),
  show: (title, options = undefined) => withToast((gooeyToast) => gooeyToast(String(title), options)),
  dismiss: (idOrFilter) => withToast((gooeyToast) => gooeyToast.dismiss(idOrFilter)),
  update: (id, options) => withToast((gooeyToast) => gooeyToast.update(id, options)),
  promise: (promiseOrFactory, messages, options = undefined) => {
    const promise =
      typeof promiseOrFactory === "function"
        ? Promise.resolve().then(promiseOrFactory)
        : Promise.resolve(promiseOrFactory);

    // Goey returns a toast handle/id for some versions. Dashboard actions need the
    // actual async result so buttons stay busy until the server finishes.
    withToast((gooeyToast) => {
      gooeyToast.promise(promise, {
        loading: messages?.loading || "Working...",
        success: messages?.success || "Completed",
        error: messages?.error || ((error) => getErrorMessage(error)),
        ...(options || {})
      });
    });

    return promise;
  }
};

export default toast;
