# 24/7 hosting with a fixed Minecraft address

The short answer: run this on a small always-on VM with a **Reserved Public IP**
and expose TCP `25565`. The recommended free option in 2026 is **Oracle Cloud
Always Free** with an Ampere A1 instance. It is free for the life of the
account within the limits, runs 24/7, and gives you one stable address such as
`129.146.x.x:25565`.

Do **not** use the e4mc/`bun run share` public relay for this: its `*.e4mc.link`
address is deliberately a temporary session address. Use direct TCP instead.

## What free options actually work

| Option | 24/7 | Fixed address | Raw TCP for Minecraft | Catch |
| --- | --- | --- | --- | --- |
| **Oracle Cloud Always Free A1** | yes | yes, with a reserved IP | yes | card verification, ARM capacity, idle policy |
| Oracle Cloud Always Free AMD micro | yes | yes | yes | only 1 GB RAM; use swap |
| Playit.gg tunnel on a PC | only while the PC is on | yes, persistent `*.ply.gg` | yes | needs your PC 24/7 |
| e4mc / `bun run share` | only while running | no, address can change | yes | session relay |
| Freebuff Sites / Vercel / static host | n/a | n/a | **no** | HTTP/WebSocket only; cannot listen on TCP |
| Render/Railway/Koyeb free web services | usually spins down | no | no inbound TCP | not a Minecraft host |
| AWS/Azure free tiers | temporary | changes | yes | expire after 6–12 months, not always free |

Oracle changes its free limits occasionally. In 2026 the Always Free A1
allowance was reduced to roughly **2 OCPUs / 12 GB RAM**; check the console for
the current “Always Free” badge before creating anything. The setup below fits
inside the smaller allowance.

## Static site + first-party browser proxy on Vercel

The static client can be hosted on Vercel together with our own
WebSocket-to-TCP bridge, so visitors never touch `pproxy.rom1504.fr`. The
repository already contains both halves:

- `vercel.json` builds the Vite client to `dist/client` and deploys the
  `api/mc-proxy.ts` function.
- `api/mc-proxy.ts` wraps `createMcProxy({ direct: true })` in a Node HTTP
  server and exports it, which is the shape Vercel's WebSocket support expects.
- The browser probes `GET /api/mc-proxy` on its own origin, sees `direct: true`,
  and opens `wss://<site>/api/mc-proxy?host=…&port=…`. No token POST is needed,
  because Vercel may run the POST and the upgrade on different Fluid instances.

Deploy with `npx vercel --prod` from the repository root (or connect the
repository in the Vercel dashboard). WebSockets are a Vercel beta feature and
require Fluid Compute; on the Hobby plan a tunnel is closed after about five
minutes, so the client reconnects with backoff. That is fine for playing a
match in a tab, but it is not a 24/7 relay for other servers. The function opens
an outbound TCP connection per tunnel and caps concurrency at 64, so keep an eye
on usage.

## 1. Create the Oracle VM

1. Sign up at <https://www.oracle.com/cloud/free/>. A card is used for identity
   verification; stay inside Always Free resources and set a **$1 budget
   alert** before creating anything.
2. Choose a home region close to you (Frankfurt or Amsterdam for Germany). The
   home region cannot be changed later.
3. Create a **VCN** with the wizard: public subnet, internet gateway, and a
   public IPv4 address.
4. Create an instance:
   - **Shape:** `VM.Standard.A1.Flex` — **2 OCPUs, 12 GB RAM** (Always Free
     eligible). ARM capacity is sometimes “out of capacity”; retry at another
     time or fall back to `VM.Standard.E2.1.Micro` (1 GB).
   - **Image:** Ubuntu 24.04 (aarch64 on A1).
   - **Networking:** assign a public IPv4 address.
   - Add your SSH public key.
5. **Reserve the address** so it never changes:
   - Open the instance → **Attached VNICs** → the VNIC → **IPv4 Addresses** →
     the public IP → **Edit** → **Reserved public IP** → create one and attach.
   - Or use **Networking → Reserved IPs**, then attach it to the VNIC.
   - Keep it attached to the running instance. A reserved IP is free while it
     is attached.
6. Add ingress rules to the VCN’s security list / network security group:
   - TCP `22` from your own IP (SSH)
   - TCP `3000` from `0.0.0.0/0` (website)
   - TCP `25565` from `0.0.0.0/0` (Minecraft Java)

## 2. Install the server

SSH in:

```sh
ssh -i /path/to/key ubuntu@YOUR_RESERVED_IP
```

Then either clone the branch/commit you want to run and use the helper:

```sh
sudo apt-get update && sudo apt-get install -y git
sudo git clone --branch arena/eecba1c8-bedwarsweb \
  https://github.com/Qynl/BedwarsWeb.git /opt/skyshard
sudo BRANCH=arena/eecba1c8-bedwarsweb bash /opt/skyshard/scripts/vm-setup.sh
```

Or, after the branch is merged into `main`:

```sh
sudo git clone https://github.com/Qynl/BedwarsWeb.git /opt/skyshard
sudo bash /opt/skyshard/scripts/vm-setup.sh
```

`scripts/vm-setup.sh` installs Docker, adds swap on 1 GB machines, builds the
image, starts `compose.yaml`, opens the OS firewall, and prints the addresses.
It does **not** open the cloud firewall; the security-list rules above do that.

## 3. Connect

```text
Website:   http://YOUR_RESERVED_IP:3000
Minecraft: YOUR_RESERVED_IP:25565   (Java 1.21.8)
```

Vanilla Java client: **Multiplayer → Direct Connection → the address above**.

Use the same address forever. Reboots and container restarts do not change a
reserved IP. If you accidentally terminate the instance, you can attach the
same reserved IP to a replacement instance.

### A nicer name (optional)

Two free ways to avoid sharing a bare IP:

- **nip.io / sslip.io**: no account. Use `YOUR_IP.nip.io` as the hostname:
  `YOUR_IP.nip.io:25565` for Minecraft and `http://YOUR_IP.nip.io:3000` for the
  site. It resolves from the embedded IP.
- **DuckDNS**: create a free subdomain and token, then run the included updater
  every few minutes:

  ```sh
  DUCKDNS_DOMAIN=myskyshard DUCKDNS_TOKEN=... \
    /opt/skyshard/deploy/duckdns-update.sh
  ```

  Add it to cron with `crontab -e`:

  ```cron
  */5 * * * * DUCKDNS_DOMAIN=myskyshard DUCKDNS_TOKEN=YOUR_TOKEN /opt/skyshard/deploy/duckdns-update.sh >/dev/null 2>&1
  ```

  Minecraft address: `myskyshard.duckdns.org:25565`; website:
  `http://myskyshard.duckdns.org:3000`.

## 4. Keep it up

```sh
cd /opt/skyshard
docker compose ps
docker compose logs -f --tail=100
docker compose restart          # restart both containers
git pull && docker compose up -d --build   # update
```

The container uses `restart: unless-stopped`, so it comes back after crashes
and reboots. The website answers `/healthz`; the game answers a normal server
list ping on `25565`.

Oracle may stop Always Free instances it considers idle:
CPU, network **and** memory all below about 20% over seven days. A quiet
Minecraft server can qualify. `compose.yaml` includes a small `keepalive`
container that holds about a quarter of the VM’s RAM, which keeps memory above
that threshold; it also makes a periodic outbound request. Remove the service
if you upgrade to Pay As You Go, or lower `KEEPALIVE_FRACTION` on a 1 GB AMD
micro instance. Upgrading to Pay As You Go while staying inside Always Free
limits is also worth doing if you care about capacity and reclamation, but
Oracle’s published policy still talks about idle Always Free resources, so keep
the keepalive regardless.

## 5. If you cannot use a VM

**Playit.gg** is the best free fallback for a home PC. It gives a persistent
`*.ply.gg` address and does not require port forwarding:

1. Create a free Playit account and agent key.
2. Install the agent and run it as a service (systemd/Windows service).
3. In the Playit dashboard create a **Minecraft Java** tunnel to
   `127.0.0.1:25565`.
4. Use the assigned `something.ply.gg` address in Minecraft.

It is still your PC doing the work; keep it powered and online for 24/7.

## Security and limits

- The Java listener is **offline-mode**: it does not check Mojang accounts.
  Anyone who can reach port `25565` can join with any name. Keep the address
  private, or set a Java username allowlist for a public server:

  ```sh
  echo 'MC_WHITELIST=Alice,Bob' | sudo tee /opt/skyshard/.env
  cd /opt/skyshard && sudo docker compose up -d
  ```

  Offline-mode names can still be spoofed by someone who knows a whitelisted
  name, so this is a convenience lock, not Mojang authentication.
- The website is also unauthenticated; use it with people you trust.
- Oracle Always Free has no SLA. Keep the setup reproducible (this repo +
  `compose.yaml`) and do not treat a single free VM as critical infrastructure.
- Do not expose Docker’s API or SSH to the whole internet.
- Check **Billing → Budgets** and **Limits, Quotas and Usage** after setup; a
  paid shape or extra boot volume is the usual way a “free” bill appears.
