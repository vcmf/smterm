# smterm — task runner
# Run `make` or `make help` to see available targets.

# Ensure cargo is on PATH even if the shell profile didn't source it.
export PATH := $(HOME)/.cargo/bin:$(PATH)

# Run recipes in a single shell so `cd` persists within a target.
.ONESHELL:
SHELL := /bin/bash

TAURI_DIR := src-tauri

.DEFAULT_GOAL := help

## ─────────────────────────────── Setup ───────────────────────────────

.PHONY: install
install: ## Install JS deps and activate git hooks
	npm install
	npx lefthook install || echo "lefthook not installed; run 'npm i -D lefthook' to enable git hooks"

## ─────────────────────────────── Run ─────────────────────────────────

.PHONY: run
run: ## Run the app in dev mode (opens a window)
	npm run dev

.PHONY: dev
dev: run ## Alias for `run`

.PHONY: build
build: ## Build the app (electron-vite; packaging via electron-builder in P8)
	npm run build

.PHONY: build-web
build-web: ## Build only the frontend (type-check + bundle)
	npm run build

## ─────────────────────────────── Lint ────────────────────────────────

.PHONY: lint
lint: lint-rust lint-web ## Lint everything (Rust + web), no changes

.PHONY: lint-rust
lint-rust: ## Rust: rustfmt check + clippy (warnings are errors)
	cd $(TAURI_DIR) && cargo fmt --check
	cd $(TAURI_DIR) && cargo clippy --all-targets -- -D warnings

.PHONY: lint-web
lint-web: ## Web: tsc + eslint + prettier check
	npm run typecheck
	npm run lint
	npm run format:check

## ─────────────────────────────── Format ──────────────────────────────

.PHONY: fmt
fmt: ## Auto-format Rust + web (writes changes)
	cd $(TAURI_DIR) && cargo fmt
	npm run lint:fix
	npm run format

## ─────────────────────────────── Test ────────────────────────────────

.PHONY: test
test: test-rust test-web ## Run all tests (Rust + web)

.PHONY: test-rust
test-rust: ## Run Rust unit + PTY integration tests
	cd $(TAURI_DIR) && cargo test

.PHONY: test-web
test-web: ## Run frontend tests (Vitest)
	npm run test

.PHONY: coverage
coverage: ## Frontend coverage report
	npm run test:coverage

## ─────────────────────────────── Gates ───────────────────────────────

.PHONY: check
check: lint test ## Do all: lint + test (the pre-merge gate)

.PHONY: ci
ci: check build-web ## Full local CI: lint + test + build frontend

.PHONY: audit
audit: ## Security audit of dependencies
	npm audit --omit=dev || true
	cd $(TAURI_DIR) && cargo audit || echo "cargo-audit not installed; run 'cargo install cargo-audit'"

## ─────────────────────────────── Misc ────────────────────────────────

.PHONY: hooks
hooks: ## Install/refresh git hooks (lefthook)
	npx lefthook install

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf dist coverage
	cd $(TAURI_DIR) && cargo clean

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
