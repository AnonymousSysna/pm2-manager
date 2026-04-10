// @ts-nocheck
const MIN_PASSWORD_LENGTH = 10;
const DISALLOWED_PASSWORDS = new Set([
  "admin",
  "changeme",
  "change-this-secret",
  "dev-secret-key",
  "password",
  "your-secret-key-here"
]);

function validateNewPassword(value) {
  if (typeof value !== "string") {
    return "New password is required";
  }

  if (value !== value.trim()) {
    return "New password cannot start or end with whitespace";
  }

  if (!value) {
    return "New password is required";
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  if (DISALLOWED_PASSWORDS.has(value.toLowerCase())) {
    return "New password is too weak";
  }

  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/[0-9]/.test(value)) classes += 1;
  if (/[^A-Za-z0-9]/.test(value)) classes += 1;

  if (classes < 3) {
    return "New password must include at least 3 of: lowercase, uppercase, number, symbol";
  }

  return null;
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  validateNewPassword
};
