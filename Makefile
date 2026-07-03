# Thin aliases over package.json scripts (the source of truth).
# On Windows without make, call the pnpm scripts directly.

.PHONY: dev worker build start test test-integration lint typecheck \
        db-migrate db-rollback db-status openapi compose-up compose-down verify

dev:
	pnpm dev

worker:
	pnpm dev:worker

build:
	pnpm build

start:
	pnpm start

test:
	pnpm test

test-integration:
	pnpm test:integration

lint:
	pnpm lint

typecheck:
	pnpm typecheck

db-migrate:
	pnpm db:migrate

db-rollback:
	pnpm db:rollback

db-status:
	pnpm db:status

openapi:
	pnpm openapi:generate

compose-up:
	pnpm compose:up

compose-down:
	pnpm compose:down

verify: typecheck lint test
	pnpm check:todos
	pnpm check:ownership
	pnpm openapi:check
