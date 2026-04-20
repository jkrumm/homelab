# Homelab — Stack Operations (run from local machine, executes via SSH)
#
# All docker compose commands that need secrets are wrapped with:
#   op run --env-file=.env.tpl -- docker compose ...
#
# The homelab server has OP_SERVICE_ACCOUNT_TOKEN in ~/.bashrc,
# so op CLI authenticates automatically via 1Password service account.
#
# Usage:
#   make help              Show all targets
#   make api-deploy        Full API deploy (git pull + rebuild + restart)
#   make deploy            Full stack deploy (git pull + recreate all)
#   make logs svc=api      Follow logs for any service

SSH := ssh homelab
CD := cd ~/homelab
OP := op run --env-file=.env.tpl --
DC := $(OP) docker compose

.DEFAULT_GOAL := help
.PHONY: help api-deploy api-rebuild api-restart api-logs dash-deploy dash-rebuild deploy up restart down ps logs caddy-reload uk-sync uk-dry-run uk-export garmin-deploy garmin-rebuild garmin-restart garmin-logs

# ── Help ─────────────────────────────────────────────────────────────────────

help: ## Show all targets
	@echo ""
	@echo "  API Operations"
	@echo "    make api-deploy          Full deploy: git pull + rebuild (no cache) + restart"
	@echo "    make api-rebuild         Rebuild image (no cache) + restart (no git pull)"
	@echo "    make api-restart         Restart container only (picks up new env vars, no rebuild)"
	@echo "    make api-logs            Follow API logs"
	@echo ""
	@echo "  Dashboard Operations"
	@echo "    make dash-deploy         Full deploy: git pull + rebuild (no cache) + restart"
	@echo "    make dash-rebuild        Rebuild image (no cache) + restart (no git pull)"
	@echo ""
	@echo "  Stack Operations"
	@echo "    make deploy              Full deploy: git pull + recreate all services"
	@echo "    make up                  Start/recreate all services"
	@echo "    make restart svc=<name>  Force-recreate a single service"
	@echo "    make down                Stop all services"
	@echo "    make ps                  Show running containers"
	@echo "    make logs svc=<name>     Follow logs for a service"
	@echo ""
	@echo "  Garmin Sync Operations"
	@echo "    make garmin-deploy       Full deploy: git pull + rebuild (no cache) + restart"
	@echo "    make garmin-rebuild      Rebuild image (no cache) + restart (no git pull)"
	@echo "    make garmin-restart      Restart container only"
	@echo "    make garmin-logs         Follow garmin-sync logs"
	@echo ""
	@echo "  Infrastructure"
	@echo "    make caddy-reload        Force-recreate Caddy (picks up Caddyfile changes)"
	@echo "    make uk-sync             Apply all Uptime Kuma monitors (public + private)"
	@echo "    make uk-dry-run          Preview Uptime Kuma monitor changes"
	@echo "    make uk-export           Export current Uptime Kuma monitors to YAML"
	@echo ""

# ── API Operations ───────────────────────────────────────────────────────────

api-deploy: ## Full deploy: git pull + rebuild API (no cache) + restart with secrets
	$(SSH) "$(CD) && git pull && $(DC) build --no-cache api && $(DC) up -d api"

api-rebuild: ## Rebuild API image (no cache) and restart with secrets
	$(SSH) "$(CD) && $(DC) build --no-cache api && $(DC) up -d api"

api-restart: ## Restart API container (no rebuild, picks up new env vars)
	$(SSH) "$(CD) && $(DC) up -d --force-recreate api"

api-logs: ## Follow API logs
	$(SSH) "docker logs -f --tail=100 api"

# ── Dashboard Operations ─────────────────────────────────────────────────────

dash-deploy: ## Full deploy: git pull + rebuild dashboard (no cache) + restart with secrets
	$(SSH) "$(CD) && git pull && $(DC) build --no-cache dashboard && $(DC) up -d dashboard"

dash-rebuild: ## Rebuild dashboard image (no cache) and restart with secrets
	$(SSH) "$(CD) && $(DC) build --no-cache dashboard && $(DC) up -d dashboard"

# ── Stack Operations ─────────────────────────────────────────────────────────

deploy: ## Full deploy: git pull + recreate all services with secrets
	$(SSH) "$(CD) && git pull && $(DC) up -d"

up: ## Start or recreate all services with secrets
	$(SSH) "$(CD) && $(DC) up -d"

restart: ## Force-recreate a single service: make restart svc=<name>
	@[ -n "$(svc)" ] || { echo "ERROR: Specify service — make restart svc=<name>"; exit 1; }
	$(SSH) "$(CD) && $(DC) up -d --force-recreate $(svc)"

down: ## Stop all services
	$(SSH) "$(CD) && $(DC) down"

ps: ## Show running containers
	$(SSH) "$(CD) && $(DC) ps"

logs: ## Follow logs for a service: make logs svc=<name>
	@[ -n "$(svc)" ] || { echo "ERROR: Specify service — make logs svc=<name>"; exit 1; }
	$(SSH) "docker logs -f --tail=100 $(svc)"

# ── Garmin Sync Operations ───────────────────────────────────────────────────

garmin-deploy: ## Full deploy: git pull + rebuild garmin-sync (no cache) + restart
	$(SSH) "$(CD) && git pull && $(DC) build --no-cache garmin-sync && $(DC) up -d garmin-sync"

garmin-rebuild: ## Rebuild garmin-sync image (no cache) and restart with secrets
	$(SSH) "$(CD) && $(DC) build --no-cache garmin-sync && $(DC) up -d garmin-sync"

garmin-restart: ## Restart garmin-sync container (no rebuild)
	$(SSH) "$(CD) && $(DC) up -d --force-recreate garmin-sync"

garmin-logs: ## Follow garmin-sync logs
	$(SSH) "docker logs -f --tail=100 garmin-sync"

# ── Infrastructure ───────────────────────────────────────────────────────────

caddy-reload: ## Force-recreate Caddy (picks up Caddyfile changes after git pull)
	$(SSH) "$(CD) && $(DC) up -d --force-recreate caddy"

VENV_PYTHON := uptime-kuma/.venv/bin/python
SYNC_BASE := $(OP) $(VENV_PYTHON) uptime-kuma/sync.py
EXTRA_CONFIG := --extra-config ../homelab-private/uptime-kuma/monitors.yaml

uk-sync: ## Apply all monitors (public + private) to Uptime Kuma
	$(SSH) "$(CD) && $(SYNC_BASE) $(EXTRA_CONFIG)"

uk-dry-run: ## Preview all monitor changes (no apply)
	$(SSH) "$(CD) && $(SYNC_BASE) --dry-run $(EXTRA_CONFIG)"

uk-export: ## Export current Uptime Kuma monitors to YAML
	$(SSH) "$(CD) && $(SYNC_BASE) --export"
