// The module's whole surface. Callers import from `@/lib/email` and never from
// nodemailer; templates (one per caller) live beside this file.
export { emailConfigured } from "./config";
export { sendEmail, type EmailMessage, type SendOutcome } from "./send";
