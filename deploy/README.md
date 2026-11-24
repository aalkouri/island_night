# Deploying

Every push to `main` goes live automatically on **games-server** within about a minute.

How it works (all on games-server, as the `deploy` user):
- `~/island-night-cron.sh` runs every minute from the `deploy` user's crontab. It calls `~/island-night-pull.sh`.
- `island-night-pull.sh` asks GitHub for the commit on `main`. If it hasn't been deployed yet, it:
  1. downloads that exact commit and checks `server.js` and `auth.js` for syntax errors;
  2. backs up player data (`/usr/local/bin/island-night-backup`) and the running copy;
  3. installs it into `/opt/game` and restarts the `game` service;
  4. waits up to 40 s for the game to answer on its port (3000, from the systemd drop-in). If it doesn't, it restores the previous version.
- Real deploys and failures are logged to `~/island-night-deploy/deploy.log`. The last deployed commit is in `~/island-night-deploy/last-sha`.

Deploy right now instead of waiting for the minute:

    ssh games-server 'bash ~/island-night-pull.sh'

Redeploy the same commit again: add `--force`.

Note: a restart ends games in progress (game state lives in memory; saved games are kept).

## Login-code email (Resend)
`auth.js` sends the sign-in code through Resend's HTTPS API when the environment variable `RESEND_API_KEY` is set. With no key (or `MAIL_MODE=log`) the code is written to the server log (`journalctl -u game`).
Put the key in a root-only file, never in git or chat. Type it yourself in the droplet console so it isn't kept in shell history:

    read -rs K && printf 'RESEND_API_KEY=%s\n' "$K" > /etc/island-night.env && unset K && chmod 600 /etc/island-night.env

Then in `/etc/systemd/system/game.service.d/override.conf` add `EnvironmentFile=/etc/island-night.env`, **remove `MAIL_MODE=log`**, add `Environment="MAIL_FROM=Island Night <no-reply@alkouri.com>"`, remove any old `mailFrom`/`sesRegion`/`game.alkouri.com` from `/var/lib/island-night/config.json`, and run `systemctl daemon-reload && systemctl restart game`.
