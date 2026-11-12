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
