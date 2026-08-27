import { nanoid } from "nanoid";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { collectionMembers } from "@/db/schema";
import { user, account } from "@/db/schema/auth";
import { createCollection, updateCollectionSettings } from "@/db/queries/collections";
import { createItem, patchItem } from "@/db/queries/items";
import { templateStringsToFieldDefs } from "./templates";

const DEMO_EMAIL = "demo@example.com";
const DEMO2_EMAIL = "demo2@example.com";
const DEMO_PASSWORD = "demopassword123";

/**
 * Fixed rather than `nanoid()` so the URLs they appear in survive a reseed and
 * can be pasted from the README: an invite link is otherwise only recoverable
 * from the `[dev email stub]` line the server logs once, and a rotating share
 * token can't be bookmarked.
 *
 * They look nothing like real tokens on purpose — nobody should mistake a
 * seeded fixture for something a running app minted.
 */
const PENDING_INVITE_TOKEN = "demo-invite-pending-manga";
const EXPIRED_INVITE_TOKEN = "demo-invite-expired-board-games";
const BOOKS_SHARE_TOKEN = "demo-share-books";

/** `acceptInvite` expires an invite 14 days after `invitedAt`, so this is past it. */
const EXPIRED_INVITE_AGE_DAYS = 15;

async function ensureUser(params: {
  email: string;
  name: string;
  timeZone: string;
  currency: string;
}) {
  const existing = await db.query.user.findFirst({ where: eq(user.email, params.email) });
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(user)
    .values({
      id: nanoid(),
      name: params.name,
      email: params.email,
      emailVerified: true,
      timeZone: params.timeZone,
      currency: params.currency,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(account).values({
    id: nanoid(),
    accountId: created.id,
    providerId: "credential",
    userId: created.id,
    password: await hashPassword(DEMO_PASSWORD),
    createdAt: now,
    updatedAt: now,
  });

  return created;
}

/**
 * Inserted directly rather than through `inviteMember()`, which mints a random
 * token, and left alone on conflict: re-running the seed must not un-accept an
 * invite a tester just accepted, or reset a role they changed to see what
 * happens.
 */
async function ensureMembership(params: {
  collectionId: string;
  invitedEmail: string;
  role: "viewer" | "editor";
  invitedBy: string;
  /** Set for an already-accepted membership; null leaves it pending. */
  acceptedUserId?: string | null;
  inviteToken?: string | null;
  invitedAt?: Date;
}) {
  const accepted = Boolean(params.acceptedUserId);
  await db
    .insert(collectionMembers)
    .values({
      collectionId: params.collectionId,
      invitedEmail: params.invitedEmail.toLowerCase(),
      role: params.role,
      invitedBy: params.invitedBy,
      invitedAt: params.invitedAt ?? new Date(),
      // An accepted row carries the user and no token; `acceptInvite` clears the
      // token as it accepts, so a fixture that kept both wouldn't be a real state.
      userId: params.acceptedUserId ?? null,
      inviteToken: accepted ? null : (params.inviteToken ?? nanoid(24)),
      acceptedAt: accepted ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [collectionMembers.collectionId, collectionMembers.invitedEmail],
    });
}

type DemoItem = { title: string; values?: Record<string, unknown>; verified?: boolean; borrower?: string };

const GAMES: DemoItem[] = [
  { title: "Final Fantasy VII Rebirth", values: { console: "PS5" }, verified: true },
  { title: "Elden Ring", values: { console: "PS5" }, verified: true },
  { title: "Xenoblade Chronicles 3", values: { console: "Nintendo Switch" }, verified: true },
  { title: "Baldur's Gate 3", values: { console: "PS5" }, verified: true },
  { title: "Hollow Knight: Silksong", values: { console: "Nintendo Switch" }, verified: true },
  { title: "Persona 3 Reload", values: { console: "PS5" }, verified: false, borrower: "Dan R." },
  { title: "Zelda: Echoes of Wisdom", values: { console: "Nintendo Switch" }, verified: true },
  { title: "Astro Bot", values: { console: "PS5" }, verified: false },
  { title: "Hades II", values: { console: "Nintendo Switch" }, verified: true },
  { title: "Pikmin 4", values: { console: "Nintendo Switch" }, verified: true },
];

const BOOKS: DemoItem[] = [
  { title: "Blindsight", values: { author: "Peter Watts", genre: ["Sci-fi"] }, verified: true },
  { title: "The Dispossessed", values: { author: "Ursula K. Le Guin", genre: ["Sci-fi"] }, verified: true },
  { title: "Piranesi", values: { author: "Susanna Clarke", genre: ["Fantasy"] }, verified: true },
  { title: "Shogun", values: { author: "James Clavell", genre: ["History"] }, verified: true },
  { title: "Dune Messiah", values: { author: "Frank Herbert", genre: ["Sci-fi"] }, verified: true },
  { title: "A Memory Called Empire", values: { author: "Arkady Martine", genre: ["Sci-fi"] }, verified: true },
  { title: "The Fifth Season", values: { author: "N. K. Jemisin", genre: ["Fantasy"] }, verified: true, borrower: "Kate M." },
  { title: "Gideon the Ninth", values: { author: "Tamsyn Muir", genre: ["Fantasy"] }, verified: false },
  { title: "Snow Crash", values: { author: "Neal Stephenson", genre: ["Sci-fi"] }, verified: true },
];

const MANGA: DemoItem[] = [
  { title: "Vinland Saga 27", values: { author: "Makoto Yukimura" }, verified: true },
  { title: "Berserk 23", values: { author: "Kentaro Miura" }, verified: true },
  { title: "Chainsaw Man 16", values: { author: "Tatsuki Fujimoto" }, verified: false },
  { title: "Frieren 12", values: { author: "Kanehito Yamada" }, verified: true },
  { title: "Monster 9", values: { author: "Naoki Urasawa" }, verified: true },
  { title: "Pluto 8", values: { author: "Naoki Urasawa" }, verified: true, borrower: "Ryan T." },
];

/** demo2's own shelf, so the dashboard shows "yours" next to "shared with you". */
const BOARD_GAMES: DemoItem[] = [
  { title: "Gloomhaven", values: { series: "Gloomhaven" }, verified: true },
  { title: "Spirit Island", verified: true, borrower: "Demo User" },
  { title: "Ark Nova", verified: false },
  { title: "Brass: Birmingham", values: { series: "Brass" }, verified: true },
];

type CollectionSpec = {
  name: string;
  templateKey: string;
  templateFields: string[];
  items: DemoItem[];
};

/**
 * Resolve-or-create, rather than the earlier skip-and-move-on: the membership
 * fixtures below need the collection ids on every run, not just the first.
 */
async function ensureCollection(ownerId: string, spec: CollectionSpec) {
  const existing = await db.query.collections.findFirst({
    where: (c, { eq: eqOp, and: andOp }) => andOp(eqOp(c.ownerId, ownerId), eqOp(c.name, spec.name)),
  });
  if (existing) {
    console.log(`Skipping "${spec.name}" — already there.`);
    return existing;
  }

  const collection = await createCollection({
    ownerId,
    name: spec.name,
    templateKey: spec.templateKey,
    fields: templateStringsToFieldDefs(spec.templateFields),
  });

  for (const demoItem of spec.items) {
    const item = await createItem({
      collectionId: collection.id,
      title: demoItem.title,
      values: demoItem.values ?? {},
    });
    if (demoItem.verified || demoItem.borrower) {
      await patchItem(
        item.id,
        { verified: Boolean(demoItem.verified), borrower: demoItem.borrower ?? null },
        item.updatedAt.toISOString(),
      );
    }
  }
  console.log(`Seeded "${spec.name}" with ${spec.items.length} items.`);

  return collection;
}

export async function seedDemo() {
  const demoUser = await ensureUser({
    email: DEMO_EMAIL,
    name: "Demo User",
    timeZone: "America/New_York",
    currency: "USD",
  });
  // Deliberately a different time zone and currency: the two accounts side by
  // side are the only way to see per-user formatting actually being per-user.
  const demo2User = await ensureUser({
    email: DEMO2_EMAIL,
    name: "Demo Two",
    timeZone: "Europe/Berlin",
    currency: "EUR",
  });

  const specs: CollectionSpec[] = [
    {
      name: "Video Games",
      templateKey: "video_games",
      templateFields: [
        "Title:Text", "Console:Select", "Publisher:Text", "Series:Text", "Region:Select",
        "Collector’s Edition:Checkbox", "Steel Book:Checkbox", "Soundtrack:Checkbox",
        "Booklet Insert:Checkbox", "Case:Checkbox", "Multiple Disks:Number",
        "Multiple Copies:Number", "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
      ],
      items: GAMES,
    },
    {
      name: "Books",
      templateKey: "books",
      templateFields: [
        "Title:Text", "Author:Text", "Publisher:Text", "Genre:Tags", "Series:Text",
        "Read:Checkbox", "Progress:Number", "Multiple Copies:Number", "Verified:Checkbox",
        "Borrower:Text", "Comments:Long text",
      ],
      items: BOOKS,
    },
    {
      name: "Manga",
      templateKey: "manga",
      templateFields: [
        "Title:Text", "Author:Text", "Publisher:Text", "Genre:Tags", "Series:Text",
        "Volumes:Text", "Completed:Checkbox", "Read:Checkbox", "Progress:Number",
        "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
      ],
      items: MANGA,
    },
  ];

  const owned = new Map<string, Awaited<ReturnType<typeof ensureCollection>>>();
  for (const spec of specs) {
    owned.set(spec.name, await ensureCollection(demoUser.id, spec));
  }

  const boardGames = await ensureCollection(demo2User.id, {
    name: "Board Games",
    templateKey: "board_games",
    templateFields: [
      "Title:Text", "Series:Text", "Verified:Checkbox", "Borrower:Text", "Comments:Long text",
    ],
    items: BOARD_GAMES,
  });

  const videoGames = owned.get("Video Games")!;
  const books = owned.get("Books")!;
  const manga = owned.get("Manga")!;

  // One membership per state worth testing, so none of them has to be clicked
  // into existence first:
  //
  //   editor  — the fixture for concurrent edits. Two sessions on the same item
  //             is what patchItem's updatedAt check and ConflictError exist for.
  //   viewer  — role enforcement has a subject: editor-only controls should be
  //             absent for this account, not merely disabled.
  //   pending — /invite/:token reachable directly. Opening it as demo instead of
  //             demo2 exercises the email-mismatch branch on the same token.
  //   expired — the third branch of acceptInviteAction, backdated past the
  //             14-day cutoff. Pointed the other way (demo2 inviting demo) so it
  //             can live on its own collection rather than fighting the pending
  //             invite for Manga's (collection, email) primary key.
  await ensureMembership({
    collectionId: videoGames.id,
    invitedEmail: DEMO2_EMAIL,
    role: "editor",
    invitedBy: demoUser.id,
    acceptedUserId: demo2User.id,
  });
  await ensureMembership({
    collectionId: books.id,
    invitedEmail: DEMO2_EMAIL,
    role: "viewer",
    invitedBy: demoUser.id,
    acceptedUserId: demo2User.id,
  });
  await ensureMembership({
    collectionId: manga.id,
    invitedEmail: DEMO2_EMAIL,
    role: "viewer",
    invitedBy: demoUser.id,
    inviteToken: PENDING_INVITE_TOKEN,
  });
  await ensureMembership({
    collectionId: boardGames.id,
    invitedEmail: DEMO_EMAIL,
    role: "editor",
    invitedBy: demo2User.id,
    inviteToken: EXPIRED_INVITE_TOKEN,
    invitedAt: new Date(Date.now() - EXPIRED_INVITE_AGE_DAYS * 24 * 60 * 60 * 1000),
  });

  // Books carries a borrower ("The Fifth Season"), which is what makes it the
  // useful collection to expose publicly: borrower and notes are the two things
  // stripItemsForPublic is supposed to withhold. Only set when the collection
  // has never had a token, so a rotated or disabled link stays that way.
  if (!books.shareToken) {
    await updateCollectionSettings(books.id, {
      shareEnabled: true,
      shareToken: BOOKS_SHARE_TOKEN,
    });
  }

  console.log(`Demo user:  ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Second user: ${DEMO2_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("");
  console.log(`  editor on "Video Games", viewer on "Books" — both accepted`);
  console.log(`  pending invite to "Manga":       /invite/${PENDING_INVITE_TOKEN}`);
  console.log(`  expired invite to "Board Games": /invite/${EXPIRED_INVITE_TOKEN}`);
  console.log(`  public link for "Books":         /s/${BOOKS_SHARE_TOKEN}`);
}
