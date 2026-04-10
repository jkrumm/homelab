VENV_PYTHON := uptime-kuma/.venv/bin/python
SYNC_BASE := op run --env-file=.env.tpl -- $(VENV_PYTHON) uptime-kuma/sync.py
EXTRA_CONFIG := --extra-config ../homelab-private/uptime-kuma/monitors.yaml
OP_RUN := op run --env-file=.env.tpl --

.PHONY: uk-sync uk-dry-run uk-export caddy-reload

uk-sync: ## Apply all monitors (public + private) to Uptime Kuma
	ssh homelab "cd ~/homelab && $(SYNC_BASE) $(EXTRA_CONFIG)"

uk-dry-run: ## Preview all monitor changes (no apply)
	ssh homelab "cd ~/homelab && $(SYNC_BASE) --dry-run $(EXTRA_CONFIG)"

uk-export: ## Export current Uptime Kuma monitors to YAML
	ssh homelab "cd ~/homelab && $(SYNC_BASE) --export"

caddy-reload: ## Force-recreate Caddy (picks up Caddyfile changes after git pull)
	ssh homelab "cd ~/homelab && $(OP_RUN) docker compose up -d --force-recreate caddy"
