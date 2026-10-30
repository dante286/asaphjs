# User guide

Asaph is a collection tracker: one place for everything you shelve and catalog, whether
that's games, books, manga, movies, records, LEGO, figures or board games. This guide is
for using an instance. To run one, see [Self-hosting](self-hosting.md).

## Getting an account

Sign up with an email address and password at `/auth`.

If there's no "Create account" option, **registration is closed on this instance**. Whoever
runs it set it up for themselves or a household. If it sends email, anyone with an account
can invite you to join: you'll get a link to `/join/…` that lets your address create an
account, once, within 14 days. Otherwise they'll have to open registration for you. An
invite to a *collection* doesn't get round this: it gives an existing account access to a
collection, not permission to register.

### Forgotten passwords

If the instance sends email, `/auth` has a **Forgot password?** link. Enter your address and,
if it has an account, a link arrives that lets you choose a new password. The link lasts an
hour and works once. You'll get at most one email a minute.

Setting a new password signs you out everywhere, on every device, in case someone else was
signed in. Then sign in again with the new password.

No "Forgot password?" link means the instance can't send the email. Ask whoever runs it.

## Collections

A **collection** is a shelf. It has its own set of fields, the columns, and holds **items**.

### Making one

From the dashboard, start a new collection in one of three ways:

- **From a template.** Fourteen built-in types with their fields already set up: Video Games,
  Books, Comics, Manga, Movies, TV Shows, Anime, Music, Board Games, Legos, Figures, Amiibos,
  Strategy Guides and Preorders. Where a [metadata provider](#looking-up-an-item) exists for
  the type, lookups are already wired up.
- **Blank.** Just a Title field; add the rest yourself.
- **From a CSV.** Drop in a spreadsheet export and Asaph builds the fields from its columns.
  See [Importing a CSV](#importing-a-csv).

The name follows the template you pick, and you can change it. You can also choose whether
the collection opens in table view, and whether it tracks lending (who has borrowed an item)
and whether a copy is verified.

**A collection keeps its own copy of the fields.** Changing your fields later never touches
another collection, and a later change to a built-in template never reshapes a collection you
already made.

### Fields

Add and remove fields, and choose which ones appear as table columns, on the collection's
Fields page. A field can be
text, long text, a number, a checkbox, a date, a select from a list of options, tags, a
currency amount, a URL, a rating, or an image.

### Its address

A collection lives at `/collections/<its-name>`. Two things to know about that address:

- **Renaming a collection moves it.** "TV Shows" renamed to "Movies" moves from
  `/collections/tv-shows` to `/collections/movies`, and the old address stops working. Public
  links aren't affected; they don't use the name.
- **Names are unique across the whole instance**, not just among your own collections. If
  someone else already has a "Movies", yours becomes `/collections/movies-2`. That's what lets
  a collection shared with you always be reachable at one address.

## Items

An item is one thing on the shelf: a title, whatever fields the collection has, an optional
cover, and a **Comments** field for your own notes. No lookup ever writes to Comments.

### Covers and table views

- **Covers** is a grid of cover art, for browsing.
- **Table** is the spreadsheet view. Drag a column edge to resize it, and hide the columns
  you don't need. Widths and hidden columns are remembered per person, so changing them
  doesn't change anyone else's view.

Switch between them at any time. Use **Filter this collection** to narrow either one.

### Editing saves as you go

Change a field and it saves by itself. There's no Save button.

If two people edit the same item at the same moment, the second save is caught instead of
silently overwriting the first, and Asaph shows the conflict so nobody's edit is lost. That
only comes up on a collection shared with an editor.

### Cover photos

Upload a photo on the item's page: JPEG, PNG, WebP, GIF or AVIF, up to 10MB. Asaph doesn't
keep the file as you sent it:

- it's turned the right way up
- it's scaled down to at most 1600px on its longest side and saved as WebP
- **the photo's metadata is removed, including GPS location**, which matters if you
  photograph your shelves at home
- an animated GIF keeps only its first frame

Deleting an item, or its collection, deletes its photo too.

## Looking up an item

On an item's page, collections of these types have a **Metadata** panel that fills in fields
from an online catalog:

| Collection type | Looked up against |
| --- | --- |
| Video Games | IGDB |
| Books, Comics, Manga, Strategy Guides | Open Library |
| Movies, TV Shows, Anime | TMDB |

No panel means there's no catalog for that type, or the instance hasn't been given a key for
it. A button that could only fail would be worse than no button.

### How it works

1. The search box starts with the item's title. Nothing is searched until you click.
2. Pick the right result. Games show their platform and year, and TV results are marked
   "TV", so you can tell releases apart: "cowboy bebop" finds the 1998 series, the 2021
   live-action series and the 2001 film.
3. Applying the match **fills empty fields only**. Anything you typed yourself stays. The
   cover art is copied onto the instance, so it loads quickly and doesn't break if the
   catalog's image host does.

To replace values you already have, tick **Overwrite fields that already have a value**. To
refresh a match, use **Re-run lookup**.

### What it won't do

- Fill fields it can't be sure about. Every checkbox on a Video Games collection is left
  alone: IGDB can't know whether *your* copy still has its booklet.
- Put a value in a select field that isn't one of its options.
- Guess a console for a game released on several. "Satellaview · SNES · Wii" isn't an answer
  to which console your copy is for.

### Things that look odd but aren't

- **A book's Publisher often stays empty.** Open Library lists every edition's publisher at
  once (Eragon has 56, across a dozen languages), so Asaph only fills it when there's one
  clear answer.
- **Series fills for a film but not a TV series.** TMDB groups films into franchises and has
  no equivalent for TV, so an anime film gets a Series and an anime series doesn't.
- **Genres come in two styles.** TMDB uses different genre names for films and TV, so Dune is
  "Science Fiction" and Cowboy Bebop is "Sci-Fi & Fantasy". They're TMDB's own words, left as
  they are.
- **No season or episode data.** Seasons, Completed and Watched are about your copy, so
  they're yours to fill.

## Importing a CSV

Bring in a spreadsheet as a new collection, or add its rows to an existing one from that
collection's Import page. Asaph guesses what kind of field each column is. For each column,
you choose an existing field, create a new one, or skip the column.

Rows that can't be imported are skipped and listed afterwards, with the reason for each.
If the result isn't what you wanted, **Undo this import** removes everything that import
added.

## Sharing a collection

There are two ways to share, and they're independent. Both are on the collection's Sharing
card in `/account`, and only the collection's owner can use them.

### Invite someone

Enter an email address and choose a role:

- **Viewer** can look but not change anything.
- **Editor** can add, edit and delete items, upload photos, change the fields, import, and
  use lookups. Only the owner can rename or delete the collection, or change who it's shared
  with.

If the instance sends email, the invite is emailed to them. Whether or not it does, every
pending invite has a **Copy invite link** button, so you can send the link yourself. The card
says whether the email went out.

An invite lasts **14 days** and works only for the address it was sent to. That person needs
an account on this instance first. Once they accept, the collection shows up on their
dashboard. Inviting the same address again sends a fresh link and the old one stops working.
Inviting someone who already accepted changes nothing.

### Public link

Tick **Public link** to get a `/s/<token>` address that anyone can open without signing in.
It's read-only, and it **leaves out who an item is lent to, and your Comments**.

Two controls, and the difference matters:

- **Unticking the box hides the link but keeps its address.** Tick it again and the same
  address works again. That's so a link pinned in a group chat survives the collection going
  quiet for a while. It is **not** how to retire a link that got out.
- **Rotate link** gives the collection a new address. The old one stops working at once, for
  everyone, including people you meant to share it with. Use this if a link leaked.

Rotate link is there even while the link is switched off, so you never have to republish a
leaked address to replace it. Renaming a collection doesn't change its public link.

## Your account

`/account` has:

- **Profile:** display name, time zone and currency. Your email address can't be changed.
- **Security:** change your password, see your active sessions, **Sign out everywhere**, and
  delete your account.
- **Export:** download your collections as CSV or JSON.
- **Collections:** rename or delete each collection you own, and its sharing settings.
- **Invite someone:** on an instance closed to registration that sends email, invite people
  to create an account. See below.

### Inviting someone to join

When registration is closed and the instance sends email, `/account` has an **Invite
someone** card. Enter an address and Asaph emails it a link that lets that address create an
account, once, within **14 days**. The card lists your invites that are still waiting; one
drops off once it's used or expires.

- **Resend** sends a fresh link, and the old one stops working. You can send to an address
  at most once a minute.
- **Revoke** stops the link working straight away.
- **Not sent** means the email failed. Try Resend; there's no link to copy instead, because
  the link only proves who owns the inbox if it arrived there.

You can have up to **five** invites waiting at once. You can't invite an address that already
has an account, or one someone else here has already invited (until theirs expires or they
revoke it).

### Deleting your account

Deleting asks for your password every time. That way a session left open on someone else's
laptop can't delete your account. The confirmation links to the CSV and JSON exports; take
them first if you want your data.

Deleting your account removes your collections, their items and their photos. Photos you
added to *someone else's* collection as an editor stay, because those items aren't yours.
