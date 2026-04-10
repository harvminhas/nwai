/**
 * Access Layer — Linked Partner CRUD
 *
 * One Pro user can link one partner. The link is bidirectional:
 * both sides write a linkedPartner document on accept.
 *
 * No roles, no scopes, no expiry. Symmetric full access.
 */

import { randomBytes } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { LinkedPartner, PendingPartnerInvite } from "./types";

// ── createInvite ──────────────────────────────────────────────────────────────

export async function createInvite(
  initiatorUid: string,
  initiatorEmail: string,
  initiatorName: string,
  inviteeEmail: string,
  db: Firestore,
): Promise<PendingPartnerInvite> {
  // Only one active invite at a time — clean up any previous pending ones first
  await cancelPendingInvite(initiatorUid, db);

  const token = randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  const invite: PendingPartnerInvite = {
    token,
    initiatorUid,
    initiatorEmail,
    initiatorName,
    inviteeEmail: inviteeEmail.toLowerCase().trim(),
    createdAt: now,
    status: "pending",
  };

  const batch = db.batch();
  // Token lookup (for accept flow)
  batch.set(db.doc(`linkedPartnerInvites/${token}`), invite);
  // Email lookup (so invitee sees it on dashboard)
  batch.set(db.doc(`linkedPartnerInvitesByEmail/${encodeEmail(inviteeEmail)}`), {
    token,
    initiatorUid,
    initiatorName,
    initiatorEmail,
    createdAt: now,
  });
  // Store token on initiator's user doc for cleanup later
  batch.set(db.doc(`users/${initiatorUid}/meta/partnerInvite`), { token, inviteeEmail: inviteeEmail.toLowerCase().trim() });
  await batch.commit();

  return invite;
}

// ── acceptInvite ──────────────────────────────────────────────────────────────

export async function acceptInvite(
  token: string,
  inviteeUid: string,
  inviteeEmail: string,
  inviteeName: string,
  db: Firestore,
): Promise<{ initiatorUid: string } | null> {
  const snap = await db.doc(`linkedPartnerInvites/${token}`).get();
  if (!snap.exists) return null;

  const invite = snap.data() as PendingPartnerInvite;
  if (invite.status !== "pending") return null;

  const now = new Date().toISOString();
  const batch = db.batch();

  // Write linkedPartner on both sides (bidirectional)
  const initiatorPartner: LinkedPartner = {
    partnerUid: inviteeUid,
    partnerEmail: inviteeEmail,
    partnerName: inviteeName,
    linkedAt: now,
    initiatedBy: invite.initiatorUid,
  };
  const inviteePartner: LinkedPartner = {
    partnerUid: invite.initiatorUid,
    partnerEmail: invite.initiatorEmail,
    partnerName: invite.initiatorName,
    linkedAt: now,
    initiatedBy: invite.initiatorUid,
  };

  batch.set(db.doc(`users/${invite.initiatorUid}/linkedPartner/data`), initiatorPartner);
  batch.set(db.doc(`users/${inviteeUid}/linkedPartner/data`), inviteePartner);

  // Clean up invite tokens
  batch.delete(snap.ref);
  batch.delete(db.doc(`linkedPartnerInvitesByEmail/${encodeEmail(invite.inviteeEmail)}`));
  batch.delete(db.doc(`users/${invite.initiatorUid}/meta/partnerInvite`));

  await batch.commit();
  return { initiatorUid: invite.initiatorUid };
}

// ── unlinkPartner ─────────────────────────────────────────────────────────────

export async function unlinkPartner(uid: string, db: Firestore): Promise<void> {
  const myDoc = await db.doc(`users/${uid}/linkedPartner/data`).get();
  if (!myDoc.exists) return;

  const partner = myDoc.data() as LinkedPartner;
  const batch = db.batch();
  batch.delete(myDoc.ref);
  batch.delete(db.doc(`users/${partner.partnerUid}/linkedPartner/data`));
  await batch.commit();
}

// ── getLinkedPartner ──────────────────────────────────────────────────────────

export async function getLinkedPartner(uid: string, db: Firestore): Promise<LinkedPartner | null> {
  const snap = await db.doc(`users/${uid}/linkedPartner/data`).get();
  return snap.exists ? (snap.data() as LinkedPartner) : null;
}

// ── getPendingInviteSent ──────────────────────────────────────────────────────

export async function getPendingInviteSent(uid: string, db: Firestore): Promise<PendingPartnerInvite | null> {
  const metaSnap = await db.doc(`users/${uid}/meta/partnerInvite`).get();
  if (!metaSnap.exists) return null;
  const { token } = metaSnap.data() as { token: string };
  const inviteSnap = await db.doc(`linkedPartnerInvites/${token}`).get();
  if (!inviteSnap.exists) return null;
  return inviteSnap.data() as PendingPartnerInvite;
}

// ── getPendingInviteByEmail ───────────────────────────────────────────────────

export async function getPendingInviteByEmail(email: string, db: Firestore): Promise<PendingPartnerInvite | null> {
  const snap = await db.doc(`linkedPartnerInvitesByEmail/${encodeEmail(email)}`).get();
  if (!snap.exists) return null;
  const { token } = snap.data() as { token: string };
  const inviteSnap = await db.doc(`linkedPartnerInvites/${token}`).get();
  if (!inviteSnap.exists) return null;
  return inviteSnap.data() as PendingPartnerInvite;
}

// ── cancelPendingInvite ───────────────────────────────────────────────────────

async function cancelPendingInvite(uid: string, db: Firestore): Promise<void> {
  const existing = await getPendingInviteSent(uid, db);
  if (!existing) return;
  const batch = db.batch();
  batch.delete(db.doc(`linkedPartnerInvites/${existing.token}`));
  batch.delete(db.doc(`linkedPartnerInvitesByEmail/${encodeEmail(existing.inviteeEmail)}`));
  batch.delete(db.doc(`users/${uid}/meta/partnerInvite`));
  await batch.commit();
}

// ── helpers ───────────────────────────────────────────────────────────────────

function encodeEmail(email: string): string {
  return email.toLowerCase().trim().replace(/\./g, ",").replace(/@/g, "_at_");
}
