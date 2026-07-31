import { nanoid } from "nanoid";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user, account } from "@/db/schema/auth";
import { createCollection } from "@/db/queries/collections";
import { createItem, patchItem } from "@/db/queries/items";
import { templateStringsToFieldDefs } from "./templates";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demopassword123";

async function ensureDemoUser() {
  const existing = await db.query.user.findFirst({ where: eq(user.email, DEMO_EMAIL) });
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(user)
    .values({
      id: nanoid(),
      name: "Demo User",
      email: DEMO_EMAIL,
      emailVerified: true,
      timeZone: "America/New_York",
      currency: "USD",
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

export async function seedDemo() {
  const demoUser = await ensureDemoUser();
  console.log(`Demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

  const specs: { name: string; templateKey: string; templateFields: string[]; items: DemoItem[] }[] = [
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

  for (const spec of specs) {
    const fields = templateStringsToFieldDefs(spec.templateFields);
    const existing = await db.query.collections.findFirst({
      where: (c, { eq: eqOp, and: andOp }) => andOp(eqOp(c.ownerId, demoUser.id), eqOp(c.name, spec.name)),
    });
    if (existing) {
      console.log(`Skipping "${spec.name}" — demo user already has it.`);
      continue;
    }

    const collection = await createCollection({
      ownerId: demoUser.id,
      name: spec.name,
      templateKey: spec.templateKey,
      fields,
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
  }
}
