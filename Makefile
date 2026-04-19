# All targets dispatch through docker compose. No host-installed Python, Node, pnpm, or Postgres.
# Host deps: Docker Desktop + Chrome (extension). Nothing else.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Load .env so POSTGRES_USER / POSTGRES_DB etc. are available in recipe lines.
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

COMPOSE       := docker compose
COMPOSE_DEV   := docker compose --profile dev

## help: List targets
help:
	@grep -E '^##' $(MAKEFILE_LIST) | sed -e 's/## //' | column -t -s ':'

## up: Start default-profile services (postgres, dbmate, scraper, classifier, dashboard, ofelia)
up:
	$(COMPOSE) up -d --build

## dev: Start default + dev profile (adds pgadmin + extension-build)
dev:
	$(COMPOSE_DEV) up -d --build

## down: Stop all services (keeps volumes/data)
down:
	$(COMPOSE) --profile dev --profile apply-v2 --profile hetzner down

## reset: Stop all services AND wipe volumes (destroys pgdata — confirm first)
reset:
	@read -r -p "This will DELETE pgdata. Type 'yes' to continue: " ans && [ "$$ans" = "yes" ]
	$(COMPOSE) --profile dev --profile apply-v2 --profile hetzner down -v

## build: Rebuild service images
build:
	$(COMPOSE) build

## ps: Show running services
ps:
	$(COMPOSE) ps

## logs: Tail logs across all services
logs:
	$(COMPOSE) logs -f --tail=100

## logs-%: Tail logs for one service (e.g. make logs-postgres)
logs-%:
	$(COMPOSE) logs -f --tail=200 $*

## psql: Open a psql shell against the running postgres
psql:
	$(COMPOSE) exec -it postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

## pgadmin: Start pgadmin (dev profile) at http://127.0.0.1:5050
pgadmin:
	$(COMPOSE_DEV) up -d pgadmin
	@echo "pgadmin → http://127.0.0.1:5050  (admin@local / admin)"

## migrate: Run pending dbmate migrations against the running postgres
migrate:
	$(COMPOSE) run --rm dbmate --wait up

## migrate-new: Generate a new migration file (usage: make migrate-new NAME=add_foo)
migrate-new:
	@[ -n "$(NAME)" ] || (echo "usage: make migrate-new NAME=short_description" && exit 1)
	$(COMPOSE) run --rm dbmate new $(NAME)

## migrate-status: List migrations and their applied state
migrate-status:
	$(COMPOSE) run --rm dbmate status

## scrape: Run a one-shot scrape (DRY=1 for dry-run). Wired up in M2.
scrape:
	$(COMPOSE) exec scraper python run.py $(if $(DRY),--dry-run,)

## classify: Run the classifier over any unclassified rows. ARGS="..." for flags (see classifier/run.py).
classify:
	$(COMPOSE) exec classifier python run.py $(ARGS)

## shell-%: Open a bash shell inside a running service (e.g. make shell-scraper)
shell-%:
	$(COMPOSE) exec -it $* bash

## run-%: Run a one-shot container for a service image (e.g. make run-scraper ARGS='python -V')
run-%:
	$(COMPOSE) run --rm $* $(ARGS)

.PHONY: help up dev down reset build ps logs psql pgadmin migrate migrate-new migrate-status scrape classify
