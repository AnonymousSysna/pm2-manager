import { gooeyToast } from "goey-toast";
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

const toast = {
  // options stay optional so callers can pass just a message.
  success: (title, options = undefined) => gooeyToast.success(String(title), options),
  error: (title, options = undefined) => gooeyToast.error(String(title), options),
  info: (title, options = undefined) => gooeyToast.info(String(title), options),
  warning: (title, options = undefined) => gooeyToast.warning(String(title), options),
  show: (title, options = undefined) => gooeyToast(String(title), options),
  dismiss: (idOrFilter) => gooeyToast.dismiss(idOrFilter),
  update: (id, options) => gooeyToast.update(id, options),
  promise: (promiseOrFactory, messages, options = undefined) => {
    const promise =
      typeof promiseOrFactory === "function"
        ? Promise.resolve().then(promiseOrFactory)
        : Promise.resolve(promiseOrFactory);

    // Goey returns a toast handle/id for some versions. Dashboard actions need the
    // actual async result so buttons stay busy until the server finishes.
    try {
      gooeyToast.promise(promise, {
        loading: messages?.loading || "Working...",
        success: messages?.success || "Completed",
        error: messages?.error || ((error) => getErrorMessage(error)),
        ...(options || {})
      });
    } catch (_error) {
      // Never let a notification failure break the operation itself.
    }

    return promise;
  }
};

export default toast;
