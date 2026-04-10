/**
 * Email utility — uses Resend (https://resend.com)
 * Requires RESEND_API_KEY and RESEND_FROM_EMAIL in environment.
 *
 * Sign up at resend.com, verify your sending domain, then add:
 *   RESEND_API_KEY=re_xxxxxxxxxxxx
 *   RESEND_FROM_EMAIL=noreply@networth.online
 */

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM_EMAIL ?? "noreply@networth.online";
const APP_NAME = "networth.online";

/** Returns true if email is configured, false if RESEND_API_KEY is missing. */
function isConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

// ── Partner invite ─────────────────────────────────────────────────────────────

export async function sendPartnerInviteEmail({
  to,
  inviterName,
  inviteUrl,
}: {
  to: string;
  inviterName: string;
  inviteUrl: string;
}): Promise<void> {
  if (!isConfigured()) {
    console.warn("[email] RESEND_API_KEY not set — skipping invite email to", to);
    return;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 0;text-align:center;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#7c3aed;">${APP_NAME}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px;">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111827;">
                ${inviterName} shared their finances with you
              </h1>
              <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">
                <strong>${inviterName}</strong> has invited you to view their financial data on ${APP_NAME}.
                Accept the invite to see their income, spending, net worth, and more.
              </p>

              <!-- What happens -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;">By accepting</p>
                    <p style="margin:0 0 6px;font-size:13px;color:#374151;">✓ You will see <strong>${inviterName}</strong>'s full financial data</p>
                    <p style="margin:0 0 6px;font-size:13px;color:#374151;">✓ They will <em>not</em> see your data unless you invite them back</p>
                    <p style="margin:0;font-size:13px;color:#374151;">✓ Either of you can unlink at any time</p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}"
                       style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:10px;">
                      Accept &amp; View Finances →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
                Or copy this link into your browser:<br />
                <a href="${inviteUrl}" style="color:#7c3aed;word-break:break-all;">${inviteUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid #f3f4f6;text-align:center;">
              <p style="margin:0;font-size:11px;color:#d1d5db;">
                This invite was sent via ${APP_NAME}. If you didn't expect this, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: `${APP_NAME} <${FROM}>`,
    to,
    subject: `${inviterName} shared their finances with you on ${APP_NAME}`,
    html,
  });
}
