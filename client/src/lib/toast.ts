// @ts-nocheck
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
  promise: (promiseOrFactory, messages, options) => {
    const promise =
      typeof promiseOrFactory === "function"
        ? Promise.resolve().then(promiseOrFactory)
        : promiseOrFactory;

    return gooeyToast.promise(promise, {
      loading: messages?.loading || "Working...",
      success: messages?.success || "Completed",
      error: messages?.error || ((error) => getErrorMessage(error)),
      ...(options || {})
    });
  }
};

export default toast;

