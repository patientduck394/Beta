# Beta

Runs on Cloudflare Workers with a D1 database. Address: https://beta.radii-office.com

## Put it online (about 10 minutes)

Run these in the `beta` folder:

```
npm install
npx wrangler login
npx wrangler d1 create beta-db
```

The last command prints a `database_id`. Paste it into `wrangler.toml` where it says REPLACE-WITH-YOUR-DATABASE-ID. Then:

```
npm run db:remote
npm run deploy
```

`deploy` also makes the address beta.radii-office.com for you. The radii-office.com site has to be in the same Cloudflare account, and there must be no DNS record already named `beta`.

## Try it on your computer first

```
npm run db:local
npm run dev
```

Then open the address it prints (usually http://localhost:8787).

## Good to know

- Passwords are hashed with PBKDF2 (100,000 rounds). If logins ever fail with "exceeded CPU time limit" on the free Workers plan, the paid Workers plan ( a month) fixes it.
- Posting, logging in and signing up are rate limited.
- Keydown: posts can use Keydown formatting (bold, chips, quotes...). `public/Keydown.js` is loaded only when a post needs it, and `public/kd.js` cleans the result before it reaches the page. #topics and @names still turn into links.

## What Beta can do

- Posts up to 300 characters with #Topics, @mentions and Keydown formatting; edit a post for 15 minutes; delete; pin one to your profile
- Pictures and files (up to 4 per post, pictures shrink in the browser first, 2 MB per picture, 4 MB per file, 40 MB per person), with picture descriptions and a full-size viewer
- Polls (2 to 4 choices, 1 hour to 7 days), replies, likes, reposts, quote posts and saved posts (bookmarks)
- Notifications (likes, replies, reposts, quotes, mentions, follows) with a count on the bell
- Follow people and Topics; mute or block people; mute Topics; Latest and Top in each Topic; who to follow
- Profiles with display name, bio, website, avatar color, and tabs for Posts, Replies, Media and Likes; follower lists
- Search posts, people and Topics; RSS for every Topic (/rss/topic/NAME) and person (/rss/user/NAME)
- Report a post, change password, delete account, keyboard shortcuts (press ?)

The new database tables are made by the Worker itself the first time it runs after a deploy, so no database command is needed. Files are kept in the D1 database (cut into pieces); for a lot of traffic, move them to R2 later.

## Version 3 additions

- Direct messages (with a count on the envelope), and a setting for who may message you (everyone, people you follow, nobody)
- Lists of people, each with its own feed, public to everyone; add someone from their profile or any post menu
- Content warnings that hide a post until you press Show; threads (up to 5 posts written at once); emoji picker; links in posts turn into links
- Profile pictures (cropped square in the browser); light or dark theme and compact spacing in Settings
- Explore: top posts and pictures from this week, Topics and people
- Search filters: `from:name`, `#topic`, `has:image`, `has:file`, `has:poll`, together with words
- See who liked a post; Share button (uses the phone's share sheet when there is one); download all your data
- Admin page for reports, removing posts and suspending people. To make yourself an admin, put your username in `wrangler.toml` where it says `ADMINS = ""` (several names can be separated by commas), then deploy

## Outlets (version 4)

Outlets are forums. Each has Subjects inside it (like channels) to sort the talk. Open them with the forum button in the top bar or from the side menu, which lists the Outlets you joined with their Subjects.
- Anyone can make an Outlet (up to 5 each) and join, post in and read Outlets. A new Outlet starts with a Subject called General
- Owners and moderators add, rename and delete Subjects, pin posts, lock a thread, move a post to another Subject, remove posts and replies, and ban people
- Posts in an Outlet stay inside it: they do not show in Everyone, Explore, Topics or search. People who joined an Outlet see its posts in their Following feed

Profile pictures can be changed from Settings or straight from your profile page (Change picture).

- Light and dark mode: a sun/moon button in the top bar flips between them (it is remembered in this browser), and Settings also has "Match my device". public/theme.js sets the theme before the page is drawn so nothing flashes.

## Instances: a decentralized Beta (version 9)

Beta is made of **instances**: communities that each have their own people, house rules, sign-up policy, Outlets and Local timeline. The main instance is `beta.radii-office.com` (the original Beta, nothing about it changed). Anyone can start another one at **`name.beta.radii-office.com`** from the front page (Start your own instance), and every instance is part of one network:

* **Local** shows only the people on this instance. **Federated** shows every instance together, with a small tag on people from elsewhere. You can follow, like and reply across instances.
* Usernames are unique across all of Beta. An account lives on the instance where it was made and logs in there.
* The instance admin (the person who made it) edits the name, description, house rules and sign-up (open, invite-only with a code, or closed) in **Instance settings**, and can unlist it from the directory. Site admins can unlist or delete any instance on the Admin page, Instances tab.
* The front page of the main instance (before you log in) is a picker: the main instance plus a searchable directory of every listed instance.
* Instances share one D1 database: `users.inst` and `outlets.inst` say where they belong, and the Worker adds those columns and the main instance by itself the first time it runs.

### Cloudflare setup for the name.beta.radii-office.com addresses (one time)

1. **DNS:** in the radii-office.com zone add a record of type `AAAA`, name `*.beta`, value `100::`, proxied (orange cloud). (`beta` itself already works.)
2. **Certificate:** Universal SSL only covers one level (`*.radii-office.com`), so `*.beta.radii-office.com` needs its own certificate: SSL/TLS > Edge Certificates > Order Advanced Certificate, hostnames `beta.radii-office.com` and `*.beta.radii-office.com` (or turn on Total TLS). This is a paid Cloudflare feature.
3. **Route:** `wrangler.toml` already lists the route `*.beta.radii-office.com/*`, so the next deploy adds it. (If a deploy ever complains about the route, add it by hand: Workers > beta > Settings > Domains & Routes > Add route.)

Until the wildcard DNS record and certificate exist, the main instance keeps working as before, and new instances are created fine but their addresses will not open yet.

Testing on your computer: `wrangler dev` always rewrites the host, so put `ALLOW_INSTANCE_HEADER=1` in a file called `.dev.vars` (it is not committed) and send a header `x-beta-instance: name` to act as an instance. Never set it in production.
