/**
 * Access Layer — Types
 *
 * Simple linked-partner model: one Pro user can link one partner.
 * Both get symmetric access to each other's finances.
 *
 * Firestore paths:
 *   users/{uid}/linkedPartner          ← set on both sides when invite accepted
 *   linkedPartnerInvites/{token}       ← top-level token lookup (pending invite)
 *   linkedPartnerInvitesByEmail/{enc}  ← email lookup so invitee sees it on login
 */

export interface LinkedPartner {
  partnerUid: string;
  partnerEmail: string;
  partnerName: string;
  linkedAt: string;
  initiatedBy: string; // uid of whoever sent the invite
}

export interface PendingPartnerInvite {
  token: string;
  initiatorUid: string;
  initiatorEmail: string;
  initiatorName: string;
  inviteeEmail: string;
  createdAt: string;
  status: "pending";
}
