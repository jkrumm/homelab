VENV_PYTHON := uptime-kuma/.venv/bin/python
SYNC_CMD := op run --env-file=.env.tpl -- $(VENV_PYTHON) uptime-kuma/sync.py

.PHONY: uk-sync uk-dry-run uk-sync-all uk-dry-run-all uk-export

uk-sync: ## Apply public monitors to Uptime Kuma
	ssh homelab "cd ~/homelab && $(SYNC_CMD)"

uk-dry-run: ## Preview public monitor changes (no apply)
	ssh homelab "cd ~/homelab && $(SYNC_CMD) --dry-run"

uk-sync-all: ## Apply public + private monitors to Uptime Kuma
	ssh homelab "cd ~/homelab && $(SYNC_CMD) --extra-config ../homelab-private/uptime-kuma/monitors.yaml"

uk-dry-run-all: ## Preview public + private monitor changes (no apply)
	ssh homelab "cd ~/homelab && $(SYNC_CMD) --dry-run --extra-config ../homelab-private/uptime-kuma/monitors.yaml"

uk-export: ## Export current Uptime Kuma monitors to YAML
	ssh homelab "cd ~/homelab && $(SYNC_CMD) --export"
