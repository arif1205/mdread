/* Magic-link delivery via Resend — https://resend.com/docs/api-reference/emails/send-email
 *
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer <RESEND_API_KEY>
 *   { from: "Name <addr>", to: [addr], subject, text, html }
 *   -> 200 { id } | 4xx { statusCode, name, message } (an unverified domain is 403)
 *
 * Set RESEND_API_KEY (and optionally MAIL_FROM) as secrets and mail goes out for
 * real; leave them unset and the link is written to the Worker log instead, which
 * is how local development works.
 *
 * The link is NEVER returned in an HTTP response. Echoing it would turn the dev
 * convenience into a total authentication bypass the moment it shipped, so the
 * only way to read it without mail configured is to have log access.
 */

const ENDPOINT = "https://api.resend.com/emails";
// Resend's shared test sender needs no verified domain, but only delivers to the
// Resend account owner's own address. Set MAIL_FROM on a verified domain for anyone else.
const DEFAULT_FROM = "mdread <onboarding@resend.dev>";

/* MAIL_FROM accepts either "Name <addr>" or a bare address; a bare one gets the
   mdread display name so the inbox doesn't show just the address. */
function formatFrom(raw) {
  if (!raw) return DEFAULT_FROM;
  const v = String(raw).trim();
  return v.includes("<") ? v : `mdread <${v}>`;
}

const bodyText = (link) =>
  [
    "Open this link to sign in to mdread:",
    "",
    link,
    "",
    "It expires in 15 minutes and can only be used once.",
    "",
    "Signing in gets you back to your vault — the documents you saved and the",
    "share links you created. You'll still need your master password to decrypt",
    "it. mdread does not have that password and cannot reset it.",
    "",
    "If you didn't ask for this, you can ignore this email.",
  ].join("\n");

const bodyHtml = (link) => `<!doctype html>
<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:34rem;margin:0 auto;padding:2rem 1.5rem;color:#2c2620;line-height:1.55">
  <h1 style="font-size:1.25rem;font-weight:600;margin:0 0 1rem">Sign in to mdread</h1>
  <p style="margin:0 0 1.5rem">Open this link to sign in. It expires in 15 minutes and can only be used once.</p>
  <p style="margin:0 0 1.75rem">
    <a href="${link}" style="display:inline-block;background:#b6502f;color:#faf6ee;text-decoration:none;padding:.7rem 1.3rem;border-radius:9px;font-size:.95rem">Sign in</a>
  </p>
  <p style="margin:0 0 1.5rem;font-size:.85rem;color:#5b5347">
    Signing in gets you back to your vault — the documents you saved and the share links you
    created. You'll still need your <strong>master password</strong> to decrypt it, and mdread
    does not have that password and cannot reset it.
  </p>
  <p style="margin:0;font-size:.8rem;color:#8c8474">
    If you didn't ask for this, you can ignore this email. The link below is the same as the button above.<br>
    <span style="word-break:break-all">${link}</span>
  </p>
</div>`;

export async function sendMagicLink(env, email, link) {
  if (!env.RESEND_API_KEY) {
    console.log(JSON.stringify({ msg: "auth.magic_link.dev", link }));
    return { delivered: false, reason: "no-mail-provider" };
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: formatFrom(env.MAIL_FROM),
        to: [email],
        subject: "Your mdread sign-in link",
        text: bodyText(link),
        html: bodyHtml(link),
      }),
    });
  } catch (err) {
    console.error(JSON.stringify({ msg: "auth.mail_unreachable", error: String(err) }));
    throw new Error("Could not send the sign-in email");
  }

  if (!res.ok) {
    // Resend returns { statusCode, name, message }. Log enough to diagnose (an
    // unverified sending domain is the usual 403) but never the recipient address
    // or the link.
    const detail = await res.json().catch(() => ({}));
    console.error(
      JSON.stringify({
        msg: "auth.mail_failed",
        status: res.status,
        error_type: detail.name,
        detail: String(detail.message || "").slice(0, 300),
      })
    );
    throw new Error("Could not send the sign-in email");
  }

  const { id } = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ msg: "auth.mail_sent", message_id: id }));
  return { delivered: true, messageId: id };
}
