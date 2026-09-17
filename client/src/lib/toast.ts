import { gooeyToast } from "goey-toast";

export function getErrorMessage(error, fallback = "Operation failed") {
  return error?.response?.data?.error || error?.message || fallback;
}

const toast = {
  success: (title, options) => gooeyToast.success(String(title), options),
  error: (title, options) => gooeyToast.error(String(title), options),
  info: (title, options) => gooeyToast.info(String(title), options),
  warning: (title, options) => gooeyToast.warning(String(title), options),
  show: (title, options) => gooeyToast(String(title), options),
  dismiss: (idOrFilter) => gooeyToast.dismiss(idOrFilter),
  update: (id, options) => gooeyToast.update(id, options),
  promise: (promiseOrFactory, messages, options) => {
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

